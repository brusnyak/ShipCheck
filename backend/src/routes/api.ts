import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { store } from '../db/store.ts';
import { optionalAuth, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { scanQueue } from '../scanner/queue.ts';
import { normalizeAndValidateUrl, SsrfGuardError } from '../security/ssrf.ts';
import { ScanStatus, TriggerType } from '../types.ts';

const createScanSchema = z.object({
  url: z.string().trim().min(1, 'Target URL is required').max(512),
  projectId: z.string().trim().max(128).optional(),
  isDemo: z.boolean().optional(),
});

const createProjectSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1, 'Project name is required').max(100),
  targetUrl: z.string().trim().min(1, 'Target URL is required').max(512),
});

const syncProjectsSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string().trim().min(1).max(128),
      name: z.string().trim().min(1).max(100),
      targetUrl: z.string().trim().min(1).max(512),
      webhookToken: z.string().trim().min(16).max(128),
    })
  ).max(50),
});

const webhookBodySchema = z.object({
  deployUrl: z.string().trim().max(512).optional(),
}).optional();

function isDemoFixtureEnabled(): boolean {
  return process.env.ENABLE_DEMO_FIXTURE !== 'false';
}

function isLocalDemoFixtureUrl(rawUrl: string, req: Request): boolean {
  if (!isDemoFixtureEnabled()) return false;
  try {
    const parsed = new URL(rawUrl);
    const reqHost = req.get('host') || '127.0.0.1:3000';
    const isLocalHost =
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.host === reqHost;
    return isLocalHost && parsed.pathname === '/api/demo/broken-target';
  } catch {
    return false;
  }
}

export function createApiRouter(): Router {
  const router = Router();
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  const scanLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Rate limit exceeded for launch scans. Please try again in a few minutes.' },
  });

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'shipcheck',
      timestamp: new Date().toISOString(),
    });
  });

  // Zero-config single-command installer for Claude Code, OMP, Pi, Cursor, Windsurf, and Codex
  router.get('/setup', (req: Request, res: Response) => {
    const rawHost = String(req.get('x-forwarded-host') || req.get('host') || 'shipcheck.vercel.app')
      .replace(/[^a-zA-Z0-9.:_-]/g, '');
    const protoHeader = String(req.get('x-forwarded-proto') || req.protocol || 'https')
      .split(',')[0]
      .trim();
    const isLocal = rawHost.startsWith('localhost') || rawHost.startsWith('127.0.0.1');
    const proto = protoHeader === 'http' && isLocal ? 'http' : 'https';
    const origin = `${proto}://${rawHost || 'shipcheck.vercel.app'}`;
    const mcpUrl = `${origin}/api/mcp`;
    const skillUrl = `${origin}/SKILL.md`;

    const script = `#!/usr/bin/env sh
set -eu

SHIPCHECK_ORIGIN="${origin}"
MCP_URL="${mcpUrl}"
SKILL_URL="${skillUrl}"

echo "Configuring ShipCheck MCP & Skill from $SHIPCHECK_ORIGIN..."

TMP_SKILL="$(mktemp)"
trap 'rm -f "$TMP_SKILL"' EXIT
curl -fsSL "$SKILL_URL" -o "$TMP_SKILL"

# Install SKILL.md across Claude Code, OMP, Pi, and universal .agents paths
for dir in \\
  "$HOME/.claude/skills/shipcheck" \\
  "$HOME/.omp/agent/skills/shipcheck" \\
  "$HOME/.pi/agent/skills/shipcheck" \\
  "$HOME/.agents/skills/shipcheck" \\
  "./.claude/skills/shipcheck" \\
  "./.agents/skills/shipcheck"
do
  mkdir -p "$dir"
  cp "$TMP_SKILL" "$dir/SKILL.md"
done

# Configure Claude Code CLI directly if installed
if command -v claude >/dev/null 2>&1; then
  claude mcp add --transport http shipcheck "$MCP_URL" >/dev/null 2>&1 || true
fi

# Safely merge MCP server config without overwriting existing servers
if command -v node >/dev/null 2>&1; then
  MCP_URL="$MCP_URL" node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const url = process.env.MCP_URL;

    function mergeJson(filePath, entry) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        let data = {};
        if (fs.existsSync(filePath)) {
          data = JSON.parse(fs.readFileSync(filePath, "utf8") || "{}");
        }
        data.mcpServers = data.mcpServers || {};
        data.mcpServers.shipcheck = entry;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\\n");
        console.log("  updated " + filePath);
      } catch (e) {
        console.warn("  skipped " + filePath + ": " + e.message);
      }
    }

    const httpEntry = { type: "http", url };
    mergeJson(path.join(process.cwd(), ".mcp.json"), httpEntry);
    mergeJson(path.join(os.homedir(), ".cursor", "mcp.json"), httpEntry);
    mergeJson(path.join(os.homedir(), ".omp", "agent", "mcp.json"), httpEntry);
    mergeJson(path.join(os.homedir(), ".pi", "agent", "mcp.json"), httpEntry);
    mergeJson(path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"), { serverUrl: url });

    const codexConfig = path.join(os.homedir(), ".codex", "config.toml");
    try {
      fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
      const existing = fs.existsSync(codexConfig) ? fs.readFileSync(codexConfig, "utf8") : "";
      if (!existing.includes("[mcp_servers.shipcheck]")) {
        const block = "\\n[mcp_servers.shipcheck]\\nurl = \\"" + url + "\\"\\n";
        fs.writeFileSync(codexConfig, existing + block);
        console.log("  updated " + codexConfig);
      }
    } catch (e) {
      console.warn("  skipped " + codexConfig + ": " + e.message);
    }
  '
fi

echo "Done! ShipCheck is ready in Claude Code, OMP, Pi, Cursor, Windsurf, and Codex."
echo "Ask your agent: \\"Audit https://your-app.com with ShipCheck\\""
`;

    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  });

  // Built-in intentionally broken target fixture for preview demo and E2E tests
  router.get('/demo/broken-target', (_req: Request, res: Response) => {
    if (!isDemoFixtureEnabled()) {
      res.status(404).json({ error: 'Demo fixture is disabled.' });
      return;
    }
    res.removeHeader('X-Content-Type-Options');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Broken Demo SaaS — Pre-Launch Test Fixture</title>
  </head>
  <body style="font-family: sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #e2e8f0;">
    <div style="width: 1280px; min-width: 1280px; border: 1px solid #334155; padding: 24px;">
      <h1>Demo Staging App</h1>
      <p>This intentional test page demonstrates failing API calls, console errors, broken images, and mobile overflow.</p>
      <img src="/api/demo/missing-hero.png" alt="Missing hero graphic" width="400" height="200" />
      <div id="api-status">Loading metrics...</div>
    </div>
    <script>
      fetch('/api/demo/failing-endpoint').then(function (r) {
        if (!r.ok) {
          console.error('Failed to hydrate billing metrics: HTTP ' + r.status);
        }
      });
      setTimeout(function () {
        throw new Error('Uncaught checkout widget initialization failure');
      }, 40);
    </script>
  </body>
</html>`);
  });

  router.get('/demo/failing-endpoint', (_req: Request, res: Response) => {
    if (!isDemoFixtureEnabled()) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(500).json({ error: 'Internal Server Error: upstream billing service unavailable' });
  });

  router.get('/demo/missing-hero.png', (_req: Request, res: Response) => {
    if (!isDemoFixtureEnabled()) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(404).send('Asset not found');
  });

  router.post('/scans', scanLimiter, optionalAuth, async (req: AuthRequest, res: Response) => {
    const parsed = createScanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid scan request payload.',
      });
      return;
    }

    const { url, projectId } = parsed.data;
    const allowLocalForDemo = isLocalDemoFixtureUrl(url, req);
    const allowLocalScans = process.env.ALLOW_LOCAL_SCANS === 'true' || allowLocalForDemo;

    let validated;
    try {
      validated = await normalizeAndValidateUrl(url, { allowLocalScans });
    } catch (err) {
      if (err instanceof SsrfGuardError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      res.status(400).json({ error: 'Invalid target URL.' });
      return;
    }

    if (projectId) {
      const project = await store.getProjectById(projectId);
      if (!project || (req.user && project.ownerId !== req.user.uid)) {
        res.status(404).json({ error: 'Tracked project not found.' });
        return;
      }
    }

    const scan = await store.createScanRun({
      targetUrl: validated.normalizedUrl,
      triggerType: TriggerType.MANUAL,
      projectId: projectId ?? null,
      ownerId: req.user?.uid ?? null,
    });

    const job = {
      scanId: scan.id,
      shareSlug: scan.shareSlug,
      targetUrl: validated.normalizedUrl,
      allowLocalScans,
    };

    if (process.env.VERCEL === '1') {
      await scanQueue.enqueueAndWait(job);
      const completed = await store.getScanByIdOrSlug(scan.id);
      res.status(202).json({
        id: scan.id,
        shareSlug: scan.shareSlug,
        status: completed?.status ?? scan.status,
        targetUrl: scan.targetUrl,
      });
      return;
    }

    scanQueue.enqueue(job);

    res.status(202).json({
      id: scan.id,
      shareSlug: scan.shareSlug,
      status: scan.status,
      targetUrl: scan.targetUrl,
    });
  });

  router.get('/scans/recent', async (req: Request, res: Response) => {
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 12));
    const scans = await store.listRecentScans(limit);
    res.json({ scans });
  });

  router.get('/scans/:idOrSlug', async (req: Request, res: Response) => {
    const idOrSlug = String(req.params.idOrSlug || '');
    const scan = await store.getScanByIdOrSlug(idOrSlug);
    if (!scan) {
      res.status(404).json({ error: 'Scan report not found.' });
      return;
    }
    res.json({ scan });
  });

  router.get('/scans/:idOrSlug/stream', async (req: Request, res: Response) => {
    const idOrSlug = String(req.params.idOrSlug || '');
    const scan = await store.getScanByIdOrSlug(idOrSlug);
    if (!scan) {
      res.status(404).json({ error: 'Scan report not found.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (eventName: string, payload: unknown) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    if (scan.status === ScanStatus.COMPLETED || scan.status === ScanStatus.FAILED) {
      sendEvent('progress', {
        scanId: scan.id,
        shareSlug: scan.shareSlug,
        status: scan.status,
        step: scan.status === ScanStatus.COMPLETED ? 'completed' : 'failed',
        label:
          scan.status === ScanStatus.COMPLETED
            ? `Audit complete — Score ${scan.score}/100 (Grade ${scan.grade})`
            : scan.errorMessage || 'Audit failed',
        progressPct: 100,
        scanMode: scan.scanMode,
        pagesScanned: scan.pagesScanned,
        score: scan.score,
        grade: scan.grade,
        errorMessage: scan.errorMessage,
        timestamp: scan.completedAt || scan.createdAt,
      });
      res.end();
      return;
    }

    const latest = scanQueue.getLatestEvent(scan.id) ?? scanQueue.getLatestEvent(scan.shareSlug);
    if (latest) {
      sendEvent('progress', latest);
    } else {
      sendEvent('progress', {
        scanId: scan.id,
        shareSlug: scan.shareSlug,
        status: scan.status,
        step: 'queued',
        label: 'Queued for launch audit...',
        progressPct: 5,
        timestamp: scan.createdAt,
      });
    }

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    const unsubscribe = scanQueue.subscribe(scan.id, (event) => {
      sendEvent('progress', event);
      if (event.status === ScanStatus.COMPLETED || event.status === ScanStatus.FAILED) {
        clearInterval(keepAlive);
        unsubscribe();
        res.end();
      }
    });

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Authenticated project & webhook management routes
  router.get('/projects', requireAuth, async (req: AuthRequest, res: Response) => {
    const projects = await store.listProjectsByOwner(req.user!.uid);
    res.json({ projects });
  });

  router.post('/projects', requireAuth, async (req: AuthRequest, res: Response) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid project payload.',
      });
      return;
    }

    const allowLocalScans =
      process.env.ALLOW_LOCAL_SCANS === 'true' || isLocalDemoFixtureUrl(parsed.data.targetUrl, req);

    let validated;
    try {
      validated = await normalizeAndValidateUrl(parsed.data.targetUrl, { allowLocalScans });
    } catch (err) {
      if (err instanceof SsrfGuardError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      res.status(400).json({ error: 'Invalid target URL.' });
      return;
    }

    const project = await store.createProject({
      id: parsed.data.id,
      ownerId: req.user!.uid,
      name: parsed.data.name,
      targetUrl: validated.normalizedUrl,
    });

    res.status(201).json({ project });
  });

  router.post('/projects/sync', requireAuth, async (req: AuthRequest, res: Response) => {
    const parsed = syncProjectsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid project sync payload.' });
      return;
    }

    const validProjects: Array<{ id: string; ownerId: string; name: string; targetUrl: string; webhookToken: string }> = [];
    for (const p of parsed.data.projects) {
      try {
        const allowLocalScans =
          process.env.ALLOW_LOCAL_SCANS === 'true' || isLocalDemoFixtureUrl(p.targetUrl, req);
        const validated = await normalizeAndValidateUrl(p.targetUrl, { allowLocalScans });
        validProjects.push({
          id: p.id,
          ownerId: req.user!.uid,
          name: p.name,
          targetUrl: validated.normalizedUrl,
          webhookToken: p.webhookToken,
        });
      } catch {
        // Skip invalid URLs during sync
      }
    }

    const projects = await store.syncProjects(req.user!.uid, validProjects);
    res.json({ projects });
  });

  router.post('/projects/:id/rotate-token', requireAuth, async (req: AuthRequest, res: Response) => {
    const updated = await store.rotateProjectWebhookToken(String(req.params.id), req.user!.uid);
    if (!updated) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project: updated });
  });

  router.delete('/projects/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const deleted = await store.deleteProject(String(req.params.id), req.user!.uid);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  router.post('/webhooks/deploy/:token', async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    const project = await store.getProjectByWebhookToken(token);
    if (!project) {
      res.status(404).json({ error: 'Invalid deploy webhook token.' });
      return;
    }

    const parsedBody = webhookBodySchema.safeParse(req.body);
    const targetCandidate = parsedBody.success && parsedBody.data?.deployUrl
      ? parsedBody.data.deployUrl
      : project.targetUrl;

    const allowLocalScans =
      process.env.ALLOW_LOCAL_SCANS === 'true' || isLocalDemoFixtureUrl(targetCandidate, req);

    let validated;
    try {
      validated = await normalizeAndValidateUrl(targetCandidate, { allowLocalScans });
    } catch (err) {
      if (err instanceof SsrfGuardError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      res.status(400).json({ error: 'Invalid deploy target URL.' });
      return;
    }

    const scan = await store.createScanRun({
      targetUrl: validated.normalizedUrl,
      triggerType: TriggerType.WEBHOOK,
      projectId: project.id,
      ownerId: project.ownerId,
    });

    const job = {
      scanId: scan.id,
      shareSlug: scan.shareSlug,
      targetUrl: validated.normalizedUrl,
      allowLocalScans,
    };

    if (process.env.VERCEL === '1') {
      await scanQueue.enqueueAndWait(job);
      const completed = await store.getScanByIdOrSlug(scan.id);
      res.status(202).json({
        scanId: scan.id,
        shareSlug: scan.shareSlug,
        reportPath: `/reports/${scan.shareSlug}`,
        status: completed?.status ?? scan.status,
        score: completed?.score ?? null,
        grade: completed?.grade ?? null,
        targetUrl: scan.targetUrl,
      });
      return;
    }

    scanQueue.enqueue(job);

    res.status(202).json({
      scanId: scan.id,
      shareSlug: scan.shareSlug,
      reportPath: `/reports/${scan.shareSlug}`,
      status: scan.status,
      targetUrl: scan.targetUrl,
    });
  });

  // Remote HTTP MCP (Model Context Protocol) JSON-RPC 2.0 endpoint for AI coding agents
  router.post('/mcp', async (req: Request, res: Response) => {
    const body = req.body as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, any>;
    };

    const rpcId = body?.id ?? null;
    const reply = (result: unknown) => res.json({ jsonrpc: '2.0', id: rpcId, result });
    const replyError = (code: number, message: string) =>
      res.status(200).json({ jsonrpc: '2.0', id: rpcId, error: { code, message } });

    if (!body || body.jsonrpc !== '2.0' || !body.method) {
      replyError(-32600, 'Invalid JSON-RPC 2.0 request');
      return;
    }

    if (body.method === 'initialize') {
      reply({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'shipcheck-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      });
      return;
    }

    if (body.method === 'notifications/initialized') {
      res.status(204).end();
      return;
    }

    if (body.method === 'tools/list') {
      reply({
        tools: [
          {
            name: 'shipcheck_audit_url',
            description: 'Run a pre-launch QA audit on a public URL and return readiness score, grade, and critical findings.',
            inputSchema: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'Public http/https URL to audit' },
              },
              required: ['url'],
            },
          },
          {
            name: 'shipcheck_get_report',
            description: 'Fetch a completed ShipCheck scan scorecard and findings by shareSlug or scan ID.',
            inputSchema: {
              type: 'object',
              properties: {
                slug: { type: 'string', description: 'Report shareSlug or scan ID' },
              },
              required: ['slug'],
            },
          },
          {
            name: 'shipcheck_trigger_deploy_check',
            description: 'Trigger a tracked project deploy webhook audit using its webhook token.',
            inputSchema: {
              type: 'object',
              properties: {
                token: { type: 'string', description: 'Project deploy webhook token (sc_wh_...)' },
                deployUrl: { type: 'string', description: 'Optional override preview deploy URL' },
              },
              required: ['token'],
            },
          },
        ],
      });
      return;
    }

    if (body.method === 'tools/call') {
      const toolName = String(body.params?.name || '');
      const args = (body.params?.arguments || {}) as Record<string, unknown>;

      try {
        if (toolName === 'shipcheck_audit_url') {
          const url = String(args.url || '').trim();
          const allowLocalForDemo = isLocalDemoFixtureUrl(url, req);
          const allowLocalScans = process.env.ALLOW_LOCAL_SCANS === 'true' || allowLocalForDemo;
          const validated = await normalizeAndValidateUrl(url, { allowLocalScans });
          const scan = await store.createScanRun({
            targetUrl: validated.normalizedUrl,
            triggerType: TriggerType.MANUAL,
          });
          await scanQueue.enqueueAndWait({
            scanId: scan.id,
            shareSlug: scan.shareSlug,
            targetUrl: validated.normalizedUrl,
            allowLocalScans,
          });

          const latest = (await store.getScanByIdOrSlug(scan.id)) ?? scan;

          reply({
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    shareSlug: latest.shareSlug,
                    reportPath: `/reports/${latest.shareSlug}`,
                    status: latest.status,
                    score: latest.score,
                    grade: latest.grade,
                    scanMode: latest.scanMode,
                    summary: latest.summary,
                    issues: (latest.issues || []).slice(0, 20),
                  },
                  null,
                  2
                ),
              },
            ],
          });
          return;
        }

        if (toolName === 'shipcheck_get_report') {
          const slug = String(args.slug || '').trim();
          const report = await store.getScanByIdOrSlug(slug);
          if (!report) {
            replyError(-32001, 'Scan report not found');
            return;
          }
          reply({
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          });
          return;
        }

        if (toolName === 'shipcheck_trigger_deploy_check') {
          const token = String(args.token || '').trim();
          const project = await store.getProjectByWebhookToken(token);
          if (!project) {
            replyError(-32001, 'Invalid deploy webhook token');
            return;
          }
          const targetCandidate = args.deployUrl ? String(args.deployUrl) : project.targetUrl;
          const allowLocalScans =
            process.env.ALLOW_LOCAL_SCANS === 'true' || isLocalDemoFixtureUrl(targetCandidate, req);
          const validated = await normalizeAndValidateUrl(targetCandidate, { allowLocalScans });
          const scan = await store.createScanRun({
            targetUrl: validated.normalizedUrl,
            triggerType: TriggerType.WEBHOOK,
            projectId: project.id,
            ownerId: project.ownerId,
          });
          scanQueue.enqueue({
            scanId: scan.id,
            shareSlug: scan.shareSlug,
            targetUrl: validated.normalizedUrl,
            allowLocalScans,
          });
          reply({
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    scanId: scan.id,
                    shareSlug: scan.shareSlug,
                    reportPath: `/reports/${scan.shareSlug}`,
                    status: scan.status,
                  },
                  null,
                  2
                ),
              },
            ],
          });
          return;
        }

        replyError(-32601, `Unknown tool: ${toolName}`);
      } catch (err) {
        replyError(-32000, err instanceof Error ? err.message : 'MCP tool execution failed');
      }
      return;
    }

    replyError(-32601, `Method not found: ${body.method}`);
  });

  return router;
}
