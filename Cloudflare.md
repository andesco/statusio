# Deploy as Cloudflare Worker

## Overview

Statusio can be deployed as a Cloudflare Worker.

Why deploy Statusio as a standalone Cloudflare Worker?

1. **custom domain name**
2. **token security**: server-side secrets only (no tokens exposed in URL)

   token exposed in URL: `https://statusio.elfhosted.com/{"rd_token":"`<b>`RD_TOKEN`</b>`"}/manifest.json`
  
   access secret in URL with token kept server-side: `https://statusio.user.workers.dev/`<b>`ACCESS_SECRET`</b>`/manifest.json`
   
## Deploy Cloudflare Worker

### option A: Deploy to Cloudflare

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/andesco/statusio)
   
1. Workers → Create an application → [Clone a repository](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers) \
Git repository URL:
    ```
    https://github.com/andesco/statusio
    ```

2. Change the default `ACCESS_SECRET` and set secrets for your providers:\
[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/) ⇢ {worker name} ⇢ Settings: Variables and Secrets:\

      **Text**:\
      `ACCESS_SECRET`
        
      **Secrets**:\
      `RD_TOKEN`
      `AD_KEY`
      `PM_KEY`
      `TB_TOKEN`
      `DL_KEY`
   

### option B: Wrangler CLI

1. generate `ACCESS_SECRET`, save it to `wrangler.toml` as a variable:

   ```bash
   npm run secret
   ```
   
   ```toml
   [vars]
   ACCESS_SECRET = "CHANGE-ME-AFTER-DEPLOY"
   ```

2. save provider tokens as secrets and then deploy:

   ```
   wrangler secret put RD_TOKEN    # Real-Debrid
   wrangler secret put AD_KEY      # AllDebrid
   wrangler secret put PM_KEY      # Premiumize
   wrangler secret put TB_TOKEN    # TorBox
   wrangler secret put DL_KEY      # Debrid-Link
   
   npm run deploy:worker
   ```

> [!WARNING]
> If `ACCESS_SECRET` is not set, all endpoints are publicly accessible:
> ```
> https://statusio.user.workers.dev/manifest.json
> ```

#### Available Commands

| Command | Purpose |
|---------|---------|
| `npm run secret` |  generate random secure secret |
| `npm run dev:worker` | local development (production config.) |
| `npm run deploy:worker` |  deploy to production Worker |
| `npm run tail:worker` | view production logs |


## Troubleshooting

### Common Issues

#### 1. Namespace not found:

**Problem:** KV namespace IDs not configured.

**Solution:**
```bash
npx wrangler kv:namespace create STATUSIO_CACHE
npx wrangler kv:namespace create STATUSIO_CACHE --preview
```
Update wrangler.toml with the IDs.

#### 2. Unauthorized:

**Problem:** Access secret required but not provided or incorrect/

**Solutions:**
- Check if `ACCESS_SECRET` is set: `wrangler secret list`
- verify URL includes correct secret: `/ACCESS_SECRET/manifest.json`
- set secret: `wrangler secret put ACCESS_SECRET`

#### 3. No Data:

**Problem:** Debrid tokens not configured.

**Solution:** Set your provider tokens:
```bash
wrangler secret put RD_TOKEN
wrangler secret put AD_KEY
# etc.
```