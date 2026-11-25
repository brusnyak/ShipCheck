import type { Project, ScanRun } from '../types/shipcheck';

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed with HTTP ${res.status}`);
  }
  return data as T;
}

export async function createScan(
  url: string,
  options: { projectId?: string; isDemo?: boolean; idToken?: string | null } = {}
): Promise<{ id: string; shareSlug: string; status: string; targetUrl: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.idToken) {
    headers.Authorization = `Bearer ${options.idToken}`;
  }
  const res = await fetch('/api/scans', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.isDemo ? { isDemo: true } : {}),
    }),
  });
  return parseJson(res);
}

export async function fetchRecentScans(limit = 12): Promise<ScanRun[]> {
  const res = await fetch(`/api/scans/recent?limit=${limit}`);
  const data = await parseJson<{ scans: ScanRun[] }>(res);
  return data.scans;
}

export async function fetchScanReport(idOrSlug: string): Promise<ScanRun> {
  const res = await fetch(`/api/scans/${encodeURIComponent(idOrSlug)}`);
  const data = await parseJson<{ scan: ScanRun }>(res);
  return data.scan;
}

export async function fetchProjects(idToken: string): Promise<Project[]> {
  const res = await fetch('/api/projects', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJson<{ projects: Project[] }>(res);
  return data.projects;
}

export async function syncProjectsToBackend(idToken: string, projects: Project[]): Promise<Project[]> {
  const res = await fetch('/api/projects/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        targetUrl: p.targetUrl,
        webhookToken: p.webhookToken,
      })),
    }),
  });
  const data = await parseJson<{ projects: Project[] }>(res);
  return data.projects;
}

export async function createProjectApi(
  idToken: string,
  payload: { name: string; targetUrl: string }
): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ project: Project }>(res);
  return data.project;
}

export async function rotateProjectTokenApi(idToken: string, projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/rotate-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJson<{ project: Project }>(res);
  return data.project;
}

export async function deleteProjectApi(idToken: string, projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  await parseJson(res);
}

export async function triggerWebhookApi(token: string): Promise<{
  scanId: string;
  shareSlug: string;
  reportPath: string;
}> {
  const res = await fetch(`/api/webhooks/deploy/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseJson(res);
}
