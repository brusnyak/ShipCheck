# ShipCheck — Pre-Launch & Deploy QA Scanner

ShipCheck audits web applications before launch or after every CI/CD deployment—catching uncaught console crashes, failing `4xx`/`5xx` API requests, broken images, `390×844` mobile horizontal overflow, missing SEO/OpenGraph metadata, and missing security headers.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         React + Vite Client SPA                         │
│   / (Scanner + Feed)   /reports/:slug (SSE + Scorecard)   /projects     │
└────────────┬───────────────────────────┬──────────────────────┬─────────┘
             │ REST                      │ SSE (/stream)        │ Auth Bearer
             ▼                           ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Express API & Security Layer                       │
│   Helmet · CORS · Rate Limiter · Zod Validation · Firebase Token Guard  │
│                                                                         │
│   [SSRF Guard] ──▶ [Sequential Queue (MAX=1)] ──▶ [Dual-Mode Engine]    │
│     (DNS + CIDR)      (Playwright Chromium primary + Cheerio fallback)  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             PostgreSQL (Prisma) / Cloud Firestore Persistence           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Backend:** Node.js, Express, TypeScript (`tsx`), Zod, Helmet, CORS, `express-rate-limit`
- **Scanner Engines:** Playwright (headless Chromium, media/font abort) + automatic `fetch` / Cheerio HTTP fallback
- **Persistence & Auth:** PostgreSQL via Prisma (`backend/prisma/schema.prisma`), Firebase Auth (Google Sign-In) & Firestore
- **Testing & CI:** Vitest, Supertest, Playwright E2E, GitHub Actions, Docker

---

## Local Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **(Optional) Start local PostgreSQL via Docker & push Prisma schema:**
   ```bash
   docker compose up -d postgres
   npm run prisma:generate
   npm run prisma:push
   ```

4. **Start the full-stack development server (port 3000):**
   ```bash
   npm run dev
   ```

---

## Testing Commands

- **TypeScript check:**
  ```bash
  npm run lint
  ```
- **Vitest unit & Supertest integration tests (SSRF guard, scoring math, API & webhooks):**
  ```bash
  npm test
  ```
- **Playwright E2E tests (audits the built-in `/api/demo/broken-target` fixture):**
  ```bash
  npx playwright install chromium
  npm run test:e2e
  ```

---

## Plug-and-Play Hosting (Vercel + Neon Postgres)

Repository: `https://github.com/brusnyak/shipcheck.git`

ShipCheck includes `api/index.ts` and `vercel.json` so **both the React frontend and Express API deploy on Vercel** with zero manual credential copying:

1. Import `brusnyak/shipcheck` into [vercel.com](https://vercel.com) (Framework Preset: **Vite**).
2. Under **Storage → Marketplace → Neon**, attach a free **Neon Postgres** database (`DATABASE_URL` is injected automatically).
3. Deploy! Vercel runs `prisma generate`, pushes the Prisma schema automatically when `DATABASE_URL` is present, and builds the bundle.
4. *(Optional for live viewport screenshots on serverless)* Add `BROWSER_WS_ENDPOINT` (e.g., Browserless) in Vercel Environment Variables, or run `Dockerfile.backend` on Koyeb / Render for built-in Chromium.

---

## AI Coding Agent Integration (1-Command Setup)

Configure **Claude Code, OMP, Pi, Cursor, Windsurf, and Codex** with one command—no manual JSON editing required:

```bash
curl -fsSL https://<your-shipcheck-domain>/api/setup | sh
```

- **Remote HTTP MCP Endpoint:** `POST https://<your-shipcheck-domain>/api/mcp`
- **Drop-in Agent Skill:** `https://<your-shipcheck-domain>/SKILL.md`
- **Local Stdio Bridge:** `npm run mcp` (`mcp/shipcheck-mcp.ts`)

Tools exposed:
- `shipcheck_audit_url`
- `shipcheck_get_report`
- `shipcheck_trigger_deploy_check`

---

## GitHub PR Gate Action

Gate pull requests automatically and post a scorecard comment directly on PRs:

```yaml
- name: ShipCheck Pre-Launch PR Gate
  uses: brusnyak/shipcheck/.github/actions/shipcheck@main
  with:
    target_url: ${{ env.DEPLOY_URL }}
    shipcheck_url: https://<your-shipcheck-domain>
    webhook_token: ${{ secrets.SHIPCHECK_WEBHOOK_TOKEN }}
    min_score: 80
```


