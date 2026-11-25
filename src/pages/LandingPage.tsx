import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  FlaskConical,
  Globe,
  RefreshCw,
  Webhook,
} from 'lucide-react';
import { createScan, fetchRecentScans } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { ScanRun } from '../types/shipcheck';

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString();
}

function getGradeColorClass(grade: string | null): string {
  if (grade === 'A' || grade === 'B') return 'text-emerald-700 dark:text-emerald-400';
  if (grade === 'C' || grade === 'D') return 'text-amber-700 dark:text-amber-400';
  if (grade === 'F') return 'text-rose-700 dark:text-rose-400';
  return 'text-zinc-500 dark:text-zinc-400';
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  const { idToken } = useAuth();
  const [urlInput, setUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<ScanRun[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);

  const loadRecent = async () => {
    try {
      const scans = await fetchRecentScans(8);
      setRecentScans(scans);
    } catch {
      // preserve existing list on transient error
    } finally {
      setLoadingFeed(false);
    }
  };

  useEffect(() => {
    void loadRecent();
    const timer = setInterval(() => {
      void loadRecent();
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  const handleRunAudit = async (target: string, isDemo = false) => {
    const trimmed = target.trim();
    if (!trimmed) {
      setErrorMsg('Enter a staging or production URL (e.g., https://example.com).');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await createScan(trimmed, { isDemo, idToken });
      onNavigate(`/reports/${res.shareSlug}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start launch audit.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleRunAudit(urlInput, false);
  };

  const handleTryBrokenDemo = () => {
    const demoUrl = `${window.location.origin}/api/demo/broken-target`;
    setUrlInput(demoUrl);
    void handleRunAudit(demoUrl, true);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 sm:px-10 py-14 sm:py-20 lg:py-24 space-y-24 lg:space-y-28">
      {/* Focused Section: Spacious Asymmetric 12-Column Above-the-Fold Scanner + Recent Audits */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
        {/* Left 7 Columns: Proposition + Command-Bar Scanner */}
        <div className="lg:col-span-7 space-y-8">
          <div className="space-y-5">
            <h1
              className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-[1.12]"
              style={{ textWrap: 'balance' }}
            >
              Catch broken APIs, console crashes, and mobile layout breaks before your users do.
            </h1>
            <p className="text-base sm:text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-2xl">
              Audit any staging preview or production release across runtime console errors, HTTP responses, broken assets, mobile overflow, SEO tags, and security headers.
            </p>
          </div>

          <div className="space-y-4 pt-2">
            <form
              onSubmit={handleFormSubmit}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 p-2 rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus-within:ring-2 focus-within:ring-emerald-500/40 focus-within:border-emerald-600 dark:focus-within:border-emerald-500 transition-shadow"
            >
              <div className="relative flex-1 flex items-center">
                <Globe className="w-4 h-4 text-zinc-400 dark:text-zinc-500 ml-3.5 shrink-0 pointer-events-none" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://your-staging-app.com"
                  aria-label="Target URL to audit"
                  className="w-full h-12 px-3.5 bg-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-mono text-sm focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="h-12 px-6 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {submitting ? 'Starting...' : 'Run Launch Audit'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-xs text-zinc-500 dark:text-zinc-400 px-1 pt-1">
              <div className="flex flex-wrap items-center gap-3.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleTryBrokenDemo}
                  className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-200 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FlaskConical className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  Try Sample Broken Site
                </button>
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                <span>Up to 4 same-origin pages · SSRF DNS protected</span>
              </div>

              <div className="flex items-center gap-5">
                <button
                  type="button"
                  onClick={() => onNavigate('/projects')}
                  className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Webhook className="w-3.5 h-3.5" />
                  PR Action &amp; Webhooks
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/agents')}
                  className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Bot className="w-3.5 h-3.5" />
                  1-Command MCP Setup
                </button>
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 px-4 py-3.5 text-sm text-rose-800 dark:text-rose-200"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right 5 Columns: Spacious Live Recent Audits Ledger */}
        <div className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Recent Launch Audits
            </h2>
            <button
              type="button"
              onClick={() => void loadRecent()}
              aria-label="Refresh recent audits"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>

          {loadingFeed ? (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="px-6 py-4 flex items-center justify-between gap-4 animate-pulse">
                  <div className="h-3.5 w-44 bg-zinc-200 dark:bg-zinc-800 rounded" />
                  <div className="h-3.5 w-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
                </div>
              ))}
            </div>
          ) : recentScans.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-4">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                No audits recorded yet
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xs mx-auto">
                Scan any URL on the left or run the broken fixture to inspect a live scorecard.
              </p>
              <button
                type="button"
                onClick={handleTryBrokenDemo}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
              >
                <FlaskConical className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                Run Demo Audit
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {recentScans.map((scan) => (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => onNavigate(`/reports/${scan.shareSlug}`)}
                  className="w-full text-left px-6 py-4 flex items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-mono text-xs text-zinc-900 dark:text-zinc-100 truncate">
                      {scan.targetUrl.replace(/^https?:\/\//, '')}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                      <span>{scan.scanMode === 'PLAYWRIGHT' ? 'Browser' : 'HTTP'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{scan.triggerType === 'WEBHOOK' ? 'Webhook' : 'Manual'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatRelativeTime(scan.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums text-xs">
                    {scan.status === 'COMPLETED' ? (
                      <>
                        <span className="text-zinc-600 dark:text-zinc-300">
                          {scan.score ?? 0}
                        </span>
                        <span className={`font-bold w-4 text-right ${getGradeColorClass(scan.grade)}`}>
                          {scan.grade ?? '—'}
                        </span>
                      </>
                    ) : scan.status === 'FAILED' ? (
                      <span className="text-rose-600 dark:text-rose-400 font-medium">Failed</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">Running</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Hairline Coverage Matrix */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Six Pre-Launch Checks in One Run
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Deterministic 0–100 scoring across runtime, layout, metadata, and transport security
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border-t border-l border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/40">
          {[
            {
              title: 'Console & Runtime Errors',
              desc: 'Captures uncaught page exceptions and console.error logs during hydration.',
            },
            {
              title: 'Network & API Failures',
              desc: 'Flags 4xx and 5xx API responses, dead endpoints, and unreachable routes.',
            },
            {
              title: 'Mobile Overflow (390×844)',
              desc: 'Detects horizontal scroll overflow, missing viewport tags, and captures visual proof.',
            },
            {
              title: 'Broken Assets & Images',
              desc: 'Identifies 404 images and media elements failing to decode (naturalWidth = 0).',
            },
            {
              title: 'SEO & OpenGraph Tags',
              desc: 'Checks document title, meta description, and og:title/og:image preview tags.',
            },
            {
              title: 'TLS & Security Headers',
              desc: 'Audits HTTPS enforcement, X-Content-Type-Options, CSP, and header leaks.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="p-7 sm:p-8 border-r border-b border-zinc-200 dark:border-zinc-800 space-y-2"
            >
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {item.title}
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Editorial How It Works */}
      <section id="how-it-works" className="pt-12 border-t border-zinc-200 dark:border-zinc-800/80 space-y-10">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            How ShipCheck Works
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl leading-relaxed">
            Every manual scan, GitHub PR Action run, or AI agent audit runs through the same deterministic verification pipeline.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 lg:gap-12">
          <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
              01. Validate &amp; Crawl
            </span>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              SSRF Guard &amp; Discovery
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Normalizes URLs, checks DNS records against private and metadata IP ranges, and crawls up to 4 same-origin routes.
            </p>
          </div>

          <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
              02. Inspect Runtime
            </span>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Dual-Mode Audit &amp; Screenshots
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Runs headless Chromium (local or remote WebSocket) for live DOM, console, and screenshot evidence with automatic HTTP fallback.
            </p>
          </div>

          <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
              03. Gate Releases
            </span>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Scorecards, PR Action &amp; MCP
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Produces a shareable 0–100 scorecard, comments directly on GitHub pull requests, and integrates into Claude, OMP, Pi, and Cursor in one command.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
