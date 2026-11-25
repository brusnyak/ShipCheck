import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Info,
  RefreshCw,
  X,
} from 'lucide-react';
import { ScoreGauge } from '../components/ScoreGauge';
import { useAuth } from '../context/AuthContext';
import { createScan, fetchScanReport } from '../lib/api';
import { fetchScanReportFromFirestore, persistScanReportToFirestore } from '../lib/firestoreRepo';
import type {
  IssueCategory,
  IssueSeverity,
  ScanIssue,
  ScanProgressEvent,
  ScanRun,
} from '../types/shipcheck';

interface ReportPageProps {
  slug: string;
  onNavigate: (path: string) => void;
}

const CATEGORY_LABELS: Record<'ALL' | IssueCategory, string> = {
  ALL: 'All',
  CONSOLE: 'Console',
  NETWORK: 'Network',
  MOBILE: 'Mobile',
  BROKEN_ASSET: 'Broken Assets',
  SEO: 'SEO',
  SECURITY: 'Security',
};

const TIMELINE_STEPS = [
  { key: 'ssrf', label: 'URL normalization & SSRF DNS check' },
  { key: 'browser', label: 'Initialize headless browser / HTTP fallback' },
  { key: 'crawling', label: 'Crawl same-origin routes, assets & mobile layout' },
  { key: 'scoring', label: 'Compute readiness score & grade' },
];

function buildMarkdownReport(scan: ScanRun): string {
  const issues = scan.issues ?? [];
  const summary = scan.summary ?? {
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
    passedChecks: [],
  };

  const lines: string[] = [
    `# ShipCheck Launch Audit Report`,
    ``,
    `- **Target:** ${scan.targetUrl}`,
    `- **Launch Readiness Score:** ${scan.score ?? 0}/100 (Grade ${scan.grade ?? 'F'})`,
    `- **Audit Mode:** ${scan.scanMode === 'PLAYWRIGHT' ? 'Full Browser Audit' : 'Fast HTTP Audit'}`,
    `- **Pages Audited:** ${scan.pagesScanned}`,
    `- **Duration:** ${scan.durationMs ?? 0}ms`,
    `- **Findings:** ${summary.criticalCount} Critical, ${summary.warningCount} Warning, ${summary.infoCount} Info`,
    ``,
  ];

  if (issues.length === 0) {
    lines.push('## Findings', '', 'No issues detected. All audited checks passed.');
  } else {
    lines.push('## Findings', '');
    issues.forEach((issue, idx) => {
      lines.push(
        `### ${idx + 1}. [${issue.severity}] (${issue.category}) ${issue.title}`,
        `- **Page:** ${issue.pageUrl}`,
        `- **Details:** ${issue.description}`,
        `- **How to fix:** ${issue.remediation}`,
        ''
      );
    });
  }

  return lines.join('\n');
}

export function ReportPage({ slug, onNavigate }: ReportPageProps) {
  const { user, idToken } = useAuth();
  const [scan, setScan] = useState<ScanRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | IssueCategory>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | IssueSeverity>('ALL');
  const [expandedIssueIds, setExpandedIssueIds] = useState<Set<string>>(new Set());
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [lightboxShot, setLightboxShot] = useState<{ label: string; viewport: string; pageUrl: string; dataUrl: string } | null>(null);
  const syncedToFirestoreRef = useRef<string | null>(null);

  const loadScan = useCallback(async () => {
    try {
      const data = await fetchScanReport(slug);
      setScan(data);
      setLoadError(null);
      return data;
    } catch (err) {
      try {
        const fsReport = await fetchScanReportFromFirestore(slug);
        if (fsReport) {
          setScan(fsReport);
          setLoadError(null);
          return fsReport;
        }
      } catch {
        // ignore secondary Firestore lookup failure
      }
      setLoadError(err instanceof Error ? err.message : 'Scan report not found.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    setScan(null);
    setProgress(null);
    void loadScan();
  }, [loadScan]);

  useEffect(() => {
    if (!scan || (scan.status !== 'QUEUED' && scan.status !== 'RUNNING')) {
      return;
    }

    const es = new EventSource(`/api/scans/${encodeURIComponent(scan.shareSlug)}/stream`);
    const handleProgress = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data) as ScanProgressEvent;
        setProgress(payload);
        if (payload.status === 'COMPLETED' || payload.status === 'FAILED') {
          es.close();
          void loadScan();
        }
      } catch {
        // ignore malformed chunk
      }
    };

    es.addEventListener('progress', handleProgress);
    es.onerror = () => {
      es.close();
      setTimeout(() => {
        void loadScan();
      }, 1000);
    };

    return () => {
      es.removeEventListener('progress', handleProgress);
      es.close();
    };
  }, [scan?.status, scan?.shareSlug, loadScan]);

  useEffect(() => {
    if (
      user &&
      scan &&
      (scan.status === 'COMPLETED' || scan.status === 'FAILED') &&
      syncedToFirestoreRef.current !== scan.shareSlug
    ) {
      syncedToFirestoreRef.current = scan.shareSlug;
      void persistScanReportToFirestore(scan, user.uid).catch((err) => {
        console.warn('Firestore report sync skipped:', err);
      });
    }
  }, [user, scan]);

  const issues = scan?.issues ?? [];

  const categoryCounts = useMemo(() => {
    const counts: Record<'ALL' | IssueCategory, number> = {
      ALL: issues.length,
      CONSOLE: 0,
      NETWORK: 0,
      MOBILE: 0,
      BROKEN_ASSET: 0,
      SEO: 0,
      SECURITY: 0,
    };
    for (const issue of issues) {
      counts[issue.category] = (counts[issue.category] || 0) + 1;
    }
    return counts;
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (categoryFilter !== 'ALL' && issue.category !== categoryFilter) return false;
      if (severityFilter !== 'ALL' && issue.severity !== severityFilter) return false;
      return true;
    });
  }, [issues, categoryFilter, severityFilter]);

  const toggleIssue = (id: string) => {
    setExpandedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyMarkdown = async () => {
    if (!scan) return;
    await navigator.clipboard.writeText(buildMarkdownReport(scan));
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 2000);
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleRerun = async () => {
    if (!scan) return;
    setRerunning(true);
    try {
      const isDemo = scan.targetUrl.includes('/api/demo/broken-target');
      const res = await createScan(scan.targetUrl, { isDemo, idToken });
      onNavigate(`/reports/${res.shareSlug}`);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to re-run audit.');
    } finally {
      setRerunning(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-6 animate-pulse">
        <div className="h-6 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
        <div className="h-44 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60" />
        <div className="h-64 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60" />
      </div>
    );
  }

  if (loadError || !scan) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 space-y-4">
          <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-5 h-5" />
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Report Not Found
            </h1>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {loadError || 'Unable to locate this audit report.'}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-sm font-medium text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Scanner
          </button>
        </div>
      </div>
    );
  }

  const isActive = scan.status === 'QUEUED' || scan.status === 'RUNNING';
  const activeStepKey = progress?.step || (scan.status === 'QUEUED' ? 'queued' : 'browser');
  const activePct = progress?.progressPct ?? (scan.status === 'QUEUED' ? 5 : 20);

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 py-12 sm:py-16 space-y-10">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          All Scans
        </button>

        <div className="text-xs font-mono text-zinc-500">Report #{scan.shareSlug}</div>
      </div>

      {/* Live Scan Progress Timeline */}
      {isActive && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-2.5 h-2.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"
                  aria-hidden="true"
                />
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                  Running Pre-Launch Audit
                </h1>
              </div>
              <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400 break-all">
                {scan.targetUrl}
              </p>
            </div>
            <span className="text-lg font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {activePct}%
            </span>
          </div>

          <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300"
              style={{ width: `${activePct}%` }}
            />
          </div>

          <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">
            {progress?.label || 'Preparing audit environment...'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {TIMELINE_STEPS.map((step, idx) => {
              const currentIdx = TIMELINE_STEPS.findIndex((s) => s.key === activeStepKey);
              const isDone =
                activeStepKey === 'completed' ||
                currentIdx > idx ||
                (activeStepKey === 'fallback' && idx === 0);
              const isCurrent =
                step.key === activeStepKey ||
                (activeStepKey === 'fallback' && step.key === 'browser');

              return (
                <div
                  key={step.key}
                  className={`rounded-lg border px-4 py-3 flex items-center gap-3 text-sm ${
                    isDone
                      ? 'border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200'
                      : isCurrent
                        ? 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100'
                        : 'border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/40 text-zinc-400 dark:text-zinc-500'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <span className="w-4 h-4 rounded-full border border-current shrink-0 flex items-center justify-center text-[10px] font-mono">
                      {idx + 1}
                    </span>
                  )}
                  <span>{step.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Failed State */}
      {scan.status === 'FAILED' && (
        <section className="rounded-xl border border-rose-300 dark:border-rose-500/40 bg-white dark:bg-zinc-900 p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-5 h-5" />
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Launch Audit Failed
            </h1>
          </div>
          <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400 break-all">
            {scan.targetUrl}
          </p>
          <p className="text-sm text-rose-700 dark:text-rose-200">
            {scan.errorMessage || 'The target site could not be audited.'}
          </p>
          <button
            type="button"
            disabled={rerunning}
            onClick={() => void handleRerun()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            {rerunning ? 'Starting...' : 'Retry Audit'}
          </button>
        </section>
      )}

      {/* Completed Scorecard */}
      {scan.status === 'COMPLETED' && (
        <>
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-6 sm:p-8 space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <ScoreGauge score={scan.score ?? 0} grade={scan.grade ?? 'F'} />

              <div className="flex-1 min-w-0 space-y-2">
                <h1 className="text-lg sm:text-xl font-semibold font-mono text-zinc-900 dark:text-zinc-100 break-all">
                  {scan.targetUrl}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {scan.scanMode === 'PLAYWRIGHT' ? 'Full Browser Audit' : 'Fast HTTP Audit'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{scan.pagesScanned} pages audited</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {scan.durationMs ? `${(scan.durationMs / 1000).toFixed(2)}s` : '—'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{scan.triggerType === 'WEBHOOK' ? 'Deploy Webhook' : 'Manual Scan'}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleCopyMarkdown()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedMarkdown ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Copied Markdown
                    </>
                  ) : (
                    <>
                      <FileText className="w-3.5 h-3.5" />
                      Copy Markdown Bug Report
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Link Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Shareable Link
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={rerunning}
                  onClick={() => void handleRerun()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {rerunning ? 'Re-running...' : 'Re-run'}
                </button>
              </div>
            </div>

            {/* Summary Metrics & Passed Checks */}
            <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-5 grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Critical
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-50 mt-1">
                    {scan.summary?.criticalCount ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Warning
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-50 mt-1">
                    {scan.summary?.warningCount ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400 font-medium">
                    <Info className="w-3.5 h-3.5" />
                    Info
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-50 mt-1">
                    {scan.summary?.infoCount ?? 0}
                  </div>
                </div>
              </div>

              <div className="md:col-span-7 space-y-2">
                <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Passed Checks
                </h2>
                {scan.summary?.passedChecks && scan.summary.passedChecks.length > 0 ? (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                    {scan.summary.passedChecks.map((check) => (
                      <li key={check} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <span>{check}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-zinc-500">
                    Resolve critical issues below to clear launch checks.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Visual Screenshot Evidence */}
          {scan.summary?.screenshots && scan.summary.screenshots.length > 0 && (
            <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-6 sm:p-8 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    Viewport Screenshot Evidence
                  </h2>
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Click any frame to inspect full capture
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {scan.summary.screenshots
                  .filter((shot) => typeof shot.dataUrl === 'string' && shot.dataUrl.startsWith('data:image/'))
                  .map((shot, idx) => (
                    <button
                      key={`${shot.viewport}-${idx}`}
                      type="button"
                      onClick={() => setLightboxShot(shot)}
                      className="text-left rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 overflow-hidden hover:border-emerald-500/60 transition-colors cursor-pointer group"
                    >
                      <div className="aspect-video w-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
                        <img
                          src={shot.dataUrl}
                          alt={`${shot.label} (${shot.viewport})`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover object-top group-hover:scale-[1.01] transition-transform"
                        />
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {shot.label}
                          </span>
                          <span className="font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
                            {shot.viewport}
                          </span>
                        </div>
                        {shot.caption && (
                          <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                            {shot.caption}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
              </div>
            </section>
          )}

          {/* Interactive Filters & Expandable Issues */}
          <section className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                {(Object.keys(CATEGORY_LABELS) as Array<'ALL' | IssueCategory>).map((cat) => {
                  const active = categoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-zinc-900 text-white dark:bg-zinc-800 dark:text-zinc-50'
                          : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                      }`}
                    >
                      {CATEGORY_LABELS[cat]}{' '}
                      <span className="font-mono tabular-nums opacity-65 ml-1">
                        {categoryCounts[cat]}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 self-start">
                {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverityFilter(sev)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      severityFilter === sev
                        ? 'bg-zinc-900 text-white dark:bg-zinc-800 dark:text-zinc-50'
                        : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    {sev === 'ALL'
                      ? 'All Severities'
                      : sev === 'CRITICAL'
                        ? 'Critical'
                        : sev === 'WARNING'
                          ? 'Warning'
                          : 'Info'}
                  </button>
                ))}
              </div>
            </div>

            {filteredIssues.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-10 text-center space-y-2">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mx-auto" />
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {issues.length === 0
                    ? 'Zero issues detected — ready to ship.'
                    : 'No issues match the selected filters.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredIssues.map((issue: ScanIssue) => {
                  const isExpanded = expandedIssueIds.has(issue.id);
                  const severityMeta =
                    issue.severity === 'CRITICAL'
                      ? { label: 'Critical', cls: 'text-rose-700 dark:text-rose-400', Icon: AlertCircle }
                      : issue.severity === 'WARNING'
                        ? { label: 'Warning', cls: 'text-amber-700 dark:text-amber-400', Icon: AlertTriangle }
                        : { label: 'Info', cls: 'text-sky-700 dark:text-sky-400', Icon: Info };
                  const SevIcon = severityMeta.Icon;

                  return (
                    <div
                      key={issue.id}
                      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleIssue(issue.id)}
                        className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`inline-flex items-center gap-1 font-semibold ${severityMeta.cls}`}>
                              <SevIcon className="w-3.5 h-3.5" />
                              {severityMeta.label}
                            </span>
                            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">·</span>
                            <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                              {CATEGORY_LABELS[issue.category]}
                            </span>
                            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">·</span>
                            <span className="font-mono text-zinc-500 dark:text-zinc-400 truncate max-w-md">
                              {issue.pageUrl}
                            </span>
                          </div>
                          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                            {issue.title}
                          </h3>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            {issue.description}
                          </p>
                        </div>
                        <span className="text-zinc-400 shrink-0 mt-1">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-5 pt-3 border-t border-zinc-200 dark:border-zinc-800/80 space-y-4 bg-zinc-50 dark:bg-zinc-950/50">
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              How to Fix
                            </h4>
                            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                              {issue.remediation}
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                              Captured Evidence
                            </h4>
                            {typeof issue.evidence?.screenshotDataUrl === 'string' &&
                              issue.evidence.screenshotDataUrl.startsWith('data:image/') && (
                                <div className="mb-3 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-100 dark:bg-zinc-950 max-w-md">
                                  <img
                                    src={issue.evidence.screenshotDataUrl}
                                    alt={`Screenshot evidence for ${issue.title}`}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-auto object-contain"
                                  />
                                </div>
                              )}
                            <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3.5 text-xs font-mono text-zinc-800 dark:text-zinc-300 overflow-x-auto">
                              {JSON.stringify(
                                issue.evidence?.screenshotDataUrl
                                  ? { ...issue.evidence, screenshotDataUrl: '[screenshot rendered above]' }
                                  : issue.evidence,
                                null,
                                2
                              )}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {lightboxShot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxShot.label}
          onClick={() => setLightboxShot(null)}
          className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4">
              <div className="text-xs">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {lightboxShot.label}
                </span>
                <span className="mx-2 text-zinc-400">·</span>
                <span className="font-mono text-zinc-500 dark:text-zinc-400">
                  {lightboxShot.viewport}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLightboxShot(null)}
                aria-label="Close screenshot preview"
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-zinc-100 dark:bg-zinc-950 max-h-[75vh] overflow-auto">
              <img
                src={lightboxShot.dataUrl}
                alt={lightboxShot.label}
                referrerPolicy="no-referrer"
                className="w-full h-auto rounded border border-zinc-200 dark:border-zinc-800"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
