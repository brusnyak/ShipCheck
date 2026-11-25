import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  LogIn,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  createProjectApi,
  createScan,
  deleteProjectApi,
  fetchProjects,
  rotateProjectTokenApi,
  syncProjectsToBackend,
  triggerWebhookApi,
} from '../lib/api';
import {
  deleteProjectFromFirestore,
  fetchUserProjectsFromFirestore,
  rotateProjectTokenInFirestore,
  saveProjectToFirestore,
} from '../lib/firestoreRepo';
import type { Project } from '../types/shipcheck';

interface ProjectsPageProps {
  onNavigate: (path: string) => void;
}

export function ProjectsPage({ onNavigate }: ProjectsPageProps) {
  const { user, loading: authLoading, signInWithGoogle, getFreshToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [snippetTabByProject, setSnippetTabByProject] = useState<Record<string, 'gh' | 'curl'>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  const loadAllProjects = useCallback(async () => {
    if (!user) return;
    setLoadingProjects(true);
    setErrorMsg(null);
    try {
      const token = await getFreshToken();
      if (!token) return;

      const [fsProjects, backendProjects] = await Promise.all([
        fetchUserProjectsFromFirestore(user.uid).catch(() => [] as Project[]),
        fetchProjects(token).catch(() => [] as Project[]),
      ]);

      const mergedById = new Map<string, Project>();
      for (const p of backendProjects) mergedById.set(p.id, p);
      for (const p of fsProjects) {
        if (!mergedById.has(p.id)) mergedById.set(p.id, p);
      }
      const combined = Array.from(mergedById.values());

      const synced =
        combined.length > 0 ? await syncProjectsToBackend(token, combined) : backendProjects;
      setProjects(synced);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load projects.');
    } finally {
      setLoadingProjects(false);
    }
  }, [user, getFreshToken]);

  useEffect(() => {
    if (user) {
      void loadAllProjects();
    } else {
      setProjects([]);
    }
  }, [user, loadAllProjects]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetUrl.trim()) {
      setErrorMsg('Provide both a project name and target URL.');
      return;
    }

    setErrorMsg(null);
    setCreating(true);
    try {
      const token = await getFreshToken();
      if (!token) throw new Error('Please sign in to create a project.');
      const created = await createProjectApi(token, {
        name: name.trim(),
        targetUrl: targetUrl.trim(),
      });
      await saveProjectToFirestore(created).catch((err) => {
        console.warn('Firestore project save warning:', err);
      });
      setProjects((prev) => [created, ...prev]);
      setName('');
      setTargetUrl('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create project.');
    } finally {
      setCreating(false);
    }
  };

  const handleRunScan = async (project: Project) => {
    setBusyProjectId(project.id);
    setErrorMsg(null);
    try {
      const token = await getFreshToken();
      const res = await createScan(project.targetUrl, {
        projectId: project.id,
        isDemo: project.targetUrl.includes('/api/demo/broken-target'),
        idToken: token,
      });
      onNavigate(`/reports/${res.shareSlug}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to trigger scan.');
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleTestWebhook = async (project: Project) => {
    setBusyProjectId(project.id);
    setErrorMsg(null);
    try {
      const res = await triggerWebhookApi(project.webhookToken);
      onNavigate(res.reportPath);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to trigger webhook.');
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleRotateToken = async (projectId: string) => {
    setBusyProjectId(projectId);
    setErrorMsg(null);
    try {
      const token = await getFreshToken();
      if (!token) return;
      const updated = await rotateProjectTokenApi(token, projectId);
      await rotateProjectTokenInFirestore(projectId, updated.webhookToken).catch(() => {});
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to rotate webhook token.');
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setBusyProjectId(projectId);
    setErrorMsg(null);
    try {
      const token = await getFreshToken();
      if (!token) return;
      await deleteProjectApi(token, projectId);
      await deleteProjectFromFirestore(projectId).catch(() => {});
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete project.');
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1800);
  };

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-16 space-y-6 animate-pulse">
        <div className="h-8 w-56 bg-zinc-200 dark:bg-zinc-800 rounded" />
        <div className="h-44 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-6 sm:px-10 py-20">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-8 sm:p-12 space-y-6">
          <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-400">
            <Webhook className="w-6 h-6" />
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Projects &amp; PR Gates
            </h1>
          </div>
          <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-xl">
            Sign in with Google to register staging or production targets, get plug-and-play GitHub PR Action gates and deploy webhooks, and keep your launch score history synced automatically.
          </p>
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 py-14 sm:py-20 space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Projects &amp; Deploy Webhooks
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1.5">
            Gate GitHub pull requests and trigger automated ShipCheck audits from any CI/CD deploy pipeline.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAllProjects()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors self-start whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Sync Projects
        </button>
      </div>

      {/* Create Project Form */}
      <form
        onSubmit={handleCreateProject}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-7 sm:p-8 space-y-5"
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Add Tracked Project
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Marketing App Staging"
            aria-label="Project Name"
            className="sm:col-span-4 h-11 px-3.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://staging.example.com"
            aria-label="Project Target URL"
            className="sm:col-span-6 h-11 px-3.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
          <button
            type="submit"
            disabled={creating}
            className="sm:col-span-2 h-11 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {creating ? 'Saving...' : 'Create'}
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-sm text-rose-800 dark:text-rose-200"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
      </form>

      {/* Project List */}
      {loadingProjects ? (
        <div className="space-y-4 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="h-52 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 p-10 text-center space-y-2">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            No tracked projects yet
          </p>
          <p className="text-xs text-zinc-500">
            Create your first project above to generate a deploy webhook URL and GitHub Actions snippet.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {projects.map((project) => {
            const origin = window.location.origin;
            const webhookUrl = `${origin}/api/webhooks/deploy/${project.webhookToken}`;
            const activeTab = snippetTabByProject[project.id] ?? 'gh';
            const curlSnippet = `curl -X POST "${webhookUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"deployUrl": "${project.targetUrl}"}'`;
            const ghSnippet = `- name: ShipCheck Pre-Launch PR Gate
  uses: brusnyak/shipcheck/.github/actions/shipcheck@main
  with:
    target_url: \${{ env.DEPLOY_URL }}
    shipcheck_url: ${origin}
    webhook_token: \${{ secrets.SHIPCHECK_WEBHOOK_TOKEN }}
    min_score: 80`;

            const snippetText = activeTab === 'gh' ? ghSnippet : curlSnippet;
            const isBusy = busyProjectId === project.id;

            return (
              <article
                key={project.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-7 sm:p-8 space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {project.name}
                    </h3>
                    <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 break-all">
                      {project.targetUrl}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleRunScan(project)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Run Scan
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleTestWebhook(project)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Webhook className="w-3.5 h-3.5" />
                      Trigger Webhook
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleRotateToken(project.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Rotate Token
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDeleteProject(project.id)}
                      aria-label={`Delete ${project.name}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:border-rose-400 dark:hover:border-rose-500/50 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Webhook URL & Snippets */}
                <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Deploy Webhook Endpoint
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy(`url-${project.id}`, webhookUrl)}
                      className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer self-start"
                    >
                      {copiedId === `url-${project.id}` ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied URL
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Webhook URL
                        </>
                      )}
                    </button>
                  </div>

                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3.5 py-2.5 text-xs font-mono text-zinc-800 dark:text-zinc-300 overflow-x-auto">
                    POST {webhookUrl}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                      <button
                        type="button"
                        onClick={() =>
                          setSnippetTabByProject((prev) => ({ ...prev, [project.id]: 'gh' }))
                        }
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                          activeTab === 'gh'
                            ? 'bg-zinc-900 text-white dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                        }`}
                      >
                        GitHub PR Action
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSnippetTabByProject((prev) => ({ ...prev, [project.id]: 'curl' }))
                        }
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                          activeTab === 'curl'
                            ? 'bg-zinc-900 text-white dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                        }`}
                      >
                        cURL Webhook
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleCopy(`snip-${project.id}`, snippetText)}
                      className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      {copiedId === `snip-${project.id}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          Copied Snippet
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Snippet
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3.5 text-xs font-mono text-zinc-800 dark:text-zinc-300 overflow-x-auto">
                    {snippetText}
                  </pre>
                </div>

                {/* Recent Deploy Score History */}
                {project.recentScans && project.recentScans.length > 0 && (
                  <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                    <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      Recent Deploy Scan History
                    </h4>
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800/70 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60">
                      {project.recentScans.map((scan) => (
                        <div
                          key={scan.id}
                          onClick={() => onNavigate(`/reports/${scan.shareSlug}`)}
                          className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                            <span className="font-mono text-zinc-500 dark:text-zinc-400">
                              #{scan.shareSlug}
                            </span>
                            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">·</span>
                            <span>{scan.triggerType === 'WEBHOOK' ? 'Webhook' : 'Manual'}</span>
                          </div>
                          <div className="flex items-center gap-3 font-mono tabular-nums">
                            <span className="text-zinc-800 dark:text-zinc-200">
                              {scan.score !== null ? `${scan.score}/100` : scan.status}
                            </span>
                            <span
                              className={`font-bold ${
                                scan.grade === 'A' || scan.grade === 'B'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : scan.grade === 'C' || scan.grade === 'D'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-rose-700 dark:text-rose-400'
                              }`}
                            >
                              {scan.grade ?? '—'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
