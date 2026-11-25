import type { AddressInfo } from 'node:net';
import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.ts';
import { store } from '../../backend/src/db/store.ts';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_LOCAL_SCANS = 'true';
  process.env.ENABLE_DEMO_FIXTURE = 'true';
  process.env.TEST_AUTH_BYPASS = 'true';
  process.env.FORCE_HTTP_FALLBACK = 'true';

  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(async () => {
  await store.clearForTesting();
});

describe('ShipCheck API integration tests', () => {
  it('GET /api/health returns service ok', async () => {
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('shipcheck');
  });

  it('POST /api/scans rejects cloud metadata and embedded credentials', async () => {
    const metaRes = await request(server)
      .post('/api/scans')
      .send({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(metaRes.status).toBe(400);
    expect(metaRes.body.error).toMatch(/blocked/i);

    const credRes = await request(server)
      .post('/api/scans')
      .send({ url: 'https://user:pass@example.com' });
    expect(credRes.status).toBe(400);
  });

  it('POST /api/scans audits /api/demo/broken-target and finds Critical issues', async () => {
    const createRes = await request(server)
      .post('/api/scans')
      .send({ url: `${baseUrl}/api/demo/broken-target`, isDemo: true });

    expect(createRes.status).toBe(202);
    expect(createRes.body.shareSlug).toBeTruthy();

    let scan: any = null;
    for (let i = 0; i < 30; i += 1) {
      const poll = await request(server).get(`/api/scans/${createRes.body.shareSlug}`);
      expect(poll.status).toBe(200);
      scan = poll.body.scan;
      if (scan.status === 'COMPLETED' || scan.status === 'FAILED') {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(scan).toBeTruthy();
    expect(scan.status).toBe('COMPLETED');
    expect(scan.score).toBeLessThan(80);
    expect(scan.summary.criticalCount).toBeGreaterThanOrEqual(2);
    expect(scan.issues.some((i: any) => i.severity === 'CRITICAL')).toBe(true);
  });

  it('requires authentication for /api/projects and triggers scans via deploy webhook', async () => {
    const unauth = await request(server).get('/api/projects');
    expect(unauth.status).toBe(401);

    const createProj = await request(server)
      .post('/api/projects')
      .set('Authorization', 'Bearer test-uid:engineer_1')
      .send({
        name: 'Demo Service',
        targetUrl: `${baseUrl}/api/demo/broken-target`,
      });

    expect(createProj.status).toBe(201);
    const project = createProj.body.project;
    expect(project.webhookToken).toMatch(/^sc_wh_/);

    const webhookRes = await request(server)
      .post(`/api/webhooks/deploy/${project.webhookToken}`)
      .send({});

    expect(webhookRes.status).toBe(202);
    expect(webhookRes.body.shareSlug).toBeTruthy();

    const listProj = await request(server)
      .get('/api/projects')
      .set('Authorization', 'Bearer test-uid:engineer_1');

    expect(listProj.status).toBe(200);
    expect(listProj.body.projects).toHaveLength(1);
    expect(listProj.body.projects[0].recentScans.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/mcp exposes MCP tools and executes shipcheck_audit_url', async () => {
    const listRes = await request(server)
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(listRes.status).toBe(200);
    expect(listRes.body.result.tools.map((t: any) => t.name)).toContain('shipcheck_audit_url');

    const callRes = await request(server)
      .post('/api/mcp')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'shipcheck_audit_url',
          arguments: { url: `${baseUrl}/api/demo/broken-target` },
        },
      });

    expect(callRes.status).toBe(200);
    const payload = JSON.parse(callRes.body.result.content[0].text);
    expect(payload.status).toBe('COMPLETED');
    expect(payload.grade).toBe('F');
    expect(payload.summary.criticalCount).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/setup returns single-command installer for Claude, OMP, Pi, Cursor, and Codex', async () => {
    const res = await request(server).get('/api/setup');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/shellscript|text\/x-shellscript/i);
    expect(res.text).toContain('/api/mcp');
    expect(res.text).toContain('/SKILL.md');
    expect(res.text).toContain('.omp/agent');
    expect(res.text).toContain('.pi/agent');
    expect(res.text).toContain('claude mcp add');
  });
});
