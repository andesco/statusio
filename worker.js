// ============================================================================
// Statusio • Cloudflare Workers Entry Point
// Adapts the Node.js Stremio addon to run on Cloudflare Workers
// ============================================================================

import {
  manifest,
  fetchStatusData,
  formatProviderStatusWithBreaks,
  getStatusInfo,
  redact,
  isoDate,
  pick,
  QUOTES_OK,
  QUOTES_WARN,
  QUOTES_CRIT,
  QUOTES_EXPIRED,
} from "./index.js";

// ----------------------------- KV Cache Helpers ----------------------------
// Cloudflare Workers version of cache using KV
async function getKVCache(kv, key) {
  if (!kv) return null;
  try {
    const data = await kv.get(key, { type: "json" });
    if (!data) return null;
    if (Date.now() > data.exp) {
      await kv.delete(key); // Clean up expired
      return null;
    }
    return data.value;
  } catch (e) {
    console.error("[Statusio] KV get error:", e);
    return null;
  }
}

async function setKVCache(kv, key, value, ttlMs) {
  if (!kv) return;
  try {
    const ttlSeconds = Math.floor(ttlMs / 1000);
    await kv.put(
      key,
      JSON.stringify({ value, exp: Date.now() + ttlMs }),
      { expirationTtl: ttlSeconds }
    );
  } catch (e) {
    console.error("[Statusio] KV set error:", e);
  }
}

// ----------------------------- Secret Validation ---------------------------
function validateSecret(pathname, env) {
  const accessSecret = env.ACCESS_SECRET;

  // If no secret is configured, allow all requests
  if (!accessSecret) {
    return { valid: true, cleanPath: pathname };
  }

  // Extract potential secret from path (first segment after /)
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (!match) {
    return { valid: false, cleanPath: pathname };
  }

  const [, firstSegment, restOfPath] = match;

  // Check if first segment matches the secret
  if (firstSegment === accessSecret) {
    return { valid: true, cleanPath: restOfPath || "/" };
  }

  // Secret required but not provided or incorrect
  return { valid: false, cleanPath: pathname };
}

// ----------------------------- Request Router ------------------------------
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Validate secret and get clean path
  const { valid, cleanPath } = validateSecret(pathname, env);

  if (!valid) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // Use cleanPath (with secret stripped) for routing
  const routePath = cleanPath;

  // Route 1: /manifest.json
  if (routePath === "/manifest.json" || routePath === "/manifest") {
    return new Response(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Route 2: /stream/:type/:id.json (where :id includes config)
  const streamMatch = routePath.match(/^\/stream\/([^/]+)\/(.+)\.json$/);
  if (streamMatch) {
    const [, type, id] = streamMatch;

    // Parse config from ID (Stremio format: "tt12345:config-base64" or just "tt12345")
    let imdbId = id;
    let cfg = {};

    if (id.includes(":")) {
      const parts = id.split(":");
      imdbId = parts[0];
      try {
        const configStr = Buffer.from(parts[1], "base64").toString("utf-8");
        cfg = JSON.parse(configStr);
      } catch (e) {
        console.error("[Statusio] Config parse error:", e);
      }
    }

    // Call the stream handler
    const args = {
      type,
      id: imdbId,
      config: cfg,
    };

    const statusData = await fetchStatusDataWorker(cfg, env);

    // Same logic as index.js stream handler
    if (!Object.values(statusData.enabled).some((v) => v)) {
      return new Response(JSON.stringify({ streams: [] }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const streams = [];
    if (statusData.hasData) {
      for (const r of statusData.results) {
        if (r.premium !== null || r.username) {
          streams.push({
            name: "🔐 Statusio",
            description: formatProviderStatusWithBreaks(r),
            url: "https://real-debrid.com/",
            externalUrl: "https://real-debrid.com/",
            behaviorHints: { notWebReady: true },
          });
        }
      }
    }

    const MAX_TV_STREAMS = 3;
    const finalStreams = streams.slice(0, MAX_TV_STREAMS);

    return new Response(JSON.stringify({ streams: finalStreams }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Route 3: Root / health check
  if (routePath === "/" || routePath === "") {
    // Build manifest URL with secret if configured
    const manifestPath = env.ACCESS_SECRET
      ? `/${env.ACCESS_SECRET}/manifest.json`
      : "/manifest.json";

    return new Response(
      JSON.stringify({
        name: "Statusio",
        version: "1.1.26",
        manifest: `${url.origin}${manifestPath}`,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // 404 for unknown routes
  return new Response("Not Found", { status: 404 });
}

// ----------------------------- Workers Fetch Handler -----------------------
async function fetchStatusDataWorker(cfg, env) {
  const MIN = 60 * 1000;
  const cacheMin = Number.isFinite(Number(cfg.cache_minutes))
    ? Math.max(1, Number(cfg.cache_minutes))
    : 45;

  // Use env bindings instead of process.env
  const tokens = {
    rd: String(cfg.rd_token || env.RD_TOKEN || "").trim(),
    ad: String(cfg.ad_key || env.AD_KEY || "").trim(),
    pm: String(cfg.pm_key || env.PM_KEY || "").trim(),
    tb: String(cfg.tb_token || env.TB_TOKEN || "").trim(),
    dl: String(cfg.dl_key || env.DL_KEY || "").trim(),
  };

  const enabled = {
    realdebrid: !!tokens.rd,
    alldebrid: !!tokens.ad,
    premiumize: !!tokens.pm,
    torbox: !!tokens.tb,
    debridlink: !!tokens.dl,
  };

  const cacheKey = [
    Object.entries(enabled)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(","),
    `rd:${redact(tokens.rd)}`,
    `ad:${redact(tokens.ad)}`,
    `pm:${redact(tokens.pm)}`,
    `tb:${redact(tokens.tb)}`,
    `dl:${redact(tokens.dl)}:${cfg.dl_auth || "Bearer"}:${
      cfg.dl_endpoint || ""
    }`,
  ].join("|");

  // Try KV cache first
  let results = await getKVCache(env.STATUSIO_CACHE, cacheKey);

  if (!results) {
    try {
      // Import provider functions dynamically
      const {
        pRealDebrid,
        pAllDebrid,
        pPremiumize,
        pTorBox,
        pDebridLink,
      } = await import("./index.js");

      const jobs = [];
      if (enabled.realdebrid) jobs.push(pRealDebrid({ token: tokens.rd }));
      if (enabled.alldebrid) jobs.push(pAllDebrid({ key: tokens.ad }));
      if (enabled.premiumize) jobs.push(pPremiumize({ key: tokens.pm }));
      if (enabled.torbox) jobs.push(pTorBox({ token: tokens.tb }));
      if (enabled.debridlink)
        jobs.push(
          pDebridLink({
            key: tokens.dl,
            authScheme: cfg.dl_auth || "Bearer",
            endpoint: (
              cfg.dl_endpoint || "https://debrid-link.com/api/account/infos"
            ).trim(),
          })
        );

      results = jobs.length ? await Promise.all(jobs) : [];

      // Store in KV cache
      await setKVCache(env.STATUSIO_CACHE, cacheKey, results, cacheMin * MIN);
    } catch (e) {
      console.error("[Statusio] Error fetching provider data:", e);
      return { error: e.message, results: [], enabled, hasData: false };
    }
  }

  return {
    results,
    enabled,
    hasData: results.some((r) => r.premium !== null || r.username),
  };
}

// ----------------------------- Export for Workers --------------------------
export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("[Statusio] Unhandled error:", error);
      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};
