import { ScanIssueInput, ScanMode } from '../types.ts';
import { normalizeAndValidateUrl } from '../security/ssrf.ts';
import { calculateScore, ScoreResult } from './scoring.ts';
import { PlaywrightLaunchError, runPlaywrightAudit, type ProgressCallback } from './playwrightEngine.ts';
import { runHttpCheerioAudit } from './httpCheerioEngine.ts';

export interface FullAuditOutput extends ScoreResult {
  scanMode: ScanMode;
  issues: ScanIssueInput[];
  pagesScanned: number;
  durationMs: number;
}

export async function runDualModeAudit(
  rawUrl: string,
  options: {
    allowLocalScans?: boolean;
    maxPages?: number;
    onStep?: (step: string, label: string, progressPct: number, scanMode?: ScanMode, pagesScanned?: number) => void;
  } = {}
): Promise<FullAuditOutput> {
  const startTime = Date.now();

  options.onStep?.('ssrf', 'Validating target URL & resolving DNS...', 10);
  const validated = await normalizeAndValidateUrl(rawUrl, {
    allowLocalScans: options.allowLocalScans,
  });

  let scanMode: ScanMode = ScanMode.PLAYWRIGHT;
  let auditResult;

  options.onStep?.('browser', 'Launching headless Chromium audit...', 20, ScanMode.PLAYWRIGHT, 0);

  const onProgress: ProgressCallback = (step, label, progressPct, pagesScanned) => {
    options.onStep?.(step, label, progressPct, scanMode, pagesScanned);
  };

  try {
    auditResult = await runPlaywrightAudit(validated.normalizedUrl, {
      allowLocalScans: options.allowLocalScans,
      maxPages: options.maxPages,
      onProgress,
    });
  } catch (err) {
    if (err instanceof PlaywrightLaunchError || process.env.FORCE_HTTP_FALLBACK === 'true') {
      scanMode = ScanMode.HTTP_CHEERIO;
      options.onStep?.(
        'fallback',
        'Browser sandbox unavailable — switching to Fast HTTP Audit...',
        25,
        ScanMode.HTTP_CHEERIO,
        0
      );
      auditResult = await runHttpCheerioAudit(validated.normalizedUrl, {
        allowLocalScans: options.allowLocalScans,
        maxPages: options.maxPages,
        onProgress,
      });
    } else {
      throw err;
    }
  }

  options.onStep?.('scoring', 'Calculating launch readiness score...', 92, scanMode, auditResult.pagesScanned);
  const scored = calculateScore(
    auditResult.issues,
    auditResult.passedChecks,
    auditResult.screenshots ?? []
  );
  const durationMs = Math.max(1, Date.now() - startTime);

  return {
    ...scored,
    scanMode,
    issues: auditResult.issues,
    pagesScanned: auditResult.pagesScanned,
    durationMs,
  };
}
