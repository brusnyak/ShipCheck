---
name: shipcheck-prelaunch-qa
description: Audit any staging, Vercel preview, or production URL with ShipCheck to catch console errors, 4xx/5xx API failures, broken images, mobile horizontal overflow, SEO gaps, and missing security headers before shipping.
---

# ShipCheck Pre-Launch QA Skill

Use this skill whenever you deploy a preview URL or finish building a web feature and need an automated launch readiness audit.

## Tools Available

### Option A: Via MCP (Claude Code, Cursor, Windsurf, OMP MCP)
1. `shipcheck_audit_url` — Audits a public `http://` or `https://` URL, returns a deterministic `0–100` score, `A–F` grade, and itemized Critical/Warning/Info findings with fixes.
2. `shipcheck_get_report` — Retrieves the full scorecard and findings by `shareSlug`.
3. `shipcheck_trigger_deploy_check` — Triggers an automated audit for a tracked project webhook token (`sc_wh_...`).

### Option B: Direct HTTP Fallback (Bash / Pi / OMP without MCP)
If your agent runtime does not have MCP enabled, call the ShipCheck MCP JSON-RPC endpoint directly over HTTP:

```bash
curl -sS -X POST "${SHIPCHECK_URL:-https://shipcheck.vercel.app}/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"shipcheck_audit_url","arguments":{"url":"https://your-preview-url.vercel.app"}}}'
```

## Workflow
1. After starting or deploying a preview URL, run `shipcheck_audit_url` against it.
2. Resolve all `CRITICAL` issues first (`CONSOLE`, `NETWORK`, `BROKEN_ASSET`, `MOBILE`, `SECURITY`).
3. Re-deploy and re-run `shipcheck_audit_url` until Grade `A` or `B` (`score >= 80`) with zero `CRITICAL` issues.
4. Include the shareable `/reports/<shareSlug>` scorecard link in your PR description.
