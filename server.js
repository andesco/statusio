// ============================================================================
// Statusio • Node.js Server Entry Point
// ============================================================================

import sdk from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = sdk;

import {
  manifest,
  fetchStatusData,
  formatProviderStatusWithBreaks,
} from "./index.js";

const builder = new addonBuilder(manifest);

// ---------------------------- Stream Handler (TV) --------------------------
builder.defineStreamHandler(async (args) => {
  const reqId = String(args?.id || "");
  if (!reqId || !reqId.startsWith("tt")) return { streams: [] };

  // Parse config (object or JSON string)
  const rawCfg = args?.config ?? {};
  let cfg = {};
  if (typeof rawCfg === "string") {
    try {
      cfg = JSON.parse(rawCfg);
    } catch {
      cfg = {};
    }
  } else if (typeof rawCfg === "object" && rawCfg !== null) {
    cfg = rawCfg;
  }

  const statusData = await fetchStatusData(cfg);

  // TVs filter out setup/instructional streams; if no tokens, return empty.
  if (!Object.values(statusData.enabled).some((v) => v)) return { streams: [] };

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

  // TV safety: cap number of streams returned (avoid UI overload)
  const MAX_TV_STREAMS = 3;
  const finalStreams = streams.slice(0, MAX_TV_STREAMS);

  return { streams: finalStreams };
});

// ------------------------------ Server -------------------------------------
const PORT = Number(process.env.PORT || 7042);
serveHTTP(builder.getInterface(), { port: PORT, hostname: "0.0.0.0" });

console.log(
  `✅ Statusio v1.1.26 at http://127.0.0.1:${PORT}/manifest.json`
);
console.log(`↩️  Description now STRICTLY the six lines (no footer).`);
