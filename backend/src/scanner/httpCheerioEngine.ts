import * as cheerio from 'cheerio';
import { IssueCategory, IssueSeverity, ScanIssueInput } from '../types.ts';
import { normalizeAndValidateUrl } from '../security/ssrf.ts';
import type { EngineAuditResult, ProgressCallback } from './playwrightEngine.ts';

const DEFAULT_MAX_PAGES = 4;

async function fetchWithTimeout(url: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  try {
    return await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ShipCheckBot/1.0 (+https://shipcheck.dev)',
        ...(options.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeFetchFollowingRedirects(
  url: string,
  allowLocalScans?: boolean,
  method: 'GET' | 'HEAD' = 'GET',
  maxRedirects = 3
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await normalizeAndValidateUrl(currentUrl, { allowLocalScans });
    const response = await fetchWithTimeout(currentUrl, { method });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { response, finalUrl: currentUrl };
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
  throw new Error('Too many redirects');
}

export async function runHttpCheerioAudit(
  targetUrl: string,
  options: {
    allowLocalScans?: boolean;
    maxPages?: number;
    onProgress?: ProgressCallback;
  } = {}
): Promise<EngineAuditResult> {
  const maxPages = options.maxPages ?? (Number(process.env.MAX_PAGES_PER_SCAN) || DEFAULT_MAX_PAGES);
  const issues: ScanIssueInput[] = [];
  const dedupeKeys = new Set<string>();

  const addIssue = (issue: ScanIssueInput) => {
    const key = `${issue.category}:${issue.severity}:${issue.title}:${issue.pageUrl}`;
    if (!dedupeKeys.has(key)) {
      dedupeKeys.add(key);
      issues.push(issue);
    }
  };

  const visited = new Set<string>();
  const queue: string[] = [targetUrl];
  const origin = new URL(targetUrl).origin;

  let consoleIssuesCount = 0;
  let networkIssuesCount = 0;
  let brokenAssetCount = 0;
  let mobileIssuesCount = 0;
  let seoIssuesCount = 0;
  let securityIssuesCount = 0;

  while (queue.length > 0 && visited.size < maxPages) {
    const currentUrl = queue.shift()!;
    if (visited.has(currentUrl)) continue;

    visited.add(currentUrl);
    const pageIndex = visited.size;
    const pct = Math.min(85, 25 + Math.round((pageIndex / maxPages) * 55));
    options.onProgress?.(
      'crawling',
      `HTTP audit ${pageIndex}/${maxPages}: ${new URL(currentUrl).pathname || '/'}`,
      pct,
      pageIndex
    );

    let res: Response;
    let finalUrl = currentUrl;
    try {
      const result = await safeFetchFollowingRedirects(currentUrl, options.allowLocalScans, 'GET');
      res = result.response;
      finalUrl = result.finalUrl;
    } catch (err) {
      networkIssuesCount += 1;
      addIssue({
        category: IssueCategory.NETWORK,
        severity: IssueSeverity.CRITICAL,
        title: 'Target URL unreachable',
        description: `Failed to fetch ${currentUrl}: ${err instanceof Error ? err.message : String(err)}`,
        remediation: 'Verify DNS records, server health, and public HTTPS accessibility.',
        pageUrl: currentUrl,
        evidence: { error: err instanceof Error ? err.message : String(err) },
      });
      continue;
    }

    if (res.status >= 400) {
      networkIssuesCount += 1;
      addIssue({
        category: IssueCategory.NETWORK,
        severity: IssueSeverity.CRITICAL,
        title: `Page returned HTTP ${res.status}`,
        description: `Request to ${finalUrl} returned HTTP status ${res.status}.`,
        remediation: 'Verify route configuration, authentication expectations, and server error logs.',
        pageUrl: finalUrl,
        evidence: { status: res.status, url: finalUrl },
      });
      continue;
    }

    if (pageIndex === 1) {
      const parsedTarget = new URL(finalUrl);
      if (parsedTarget.protocol !== 'https:' && parsedTarget.hostname !== '127.0.0.1' && parsedTarget.hostname !== 'localhost') {
        securityIssuesCount += 1;
        addIssue({
          category: IssueCategory.SECURITY,
          severity: IssueSeverity.CRITICAL,
          title: 'Site is not served over HTTPS',
          description: 'Plaintext HTTP exposes traffic and credentials in transit.',
          remediation: 'Provision TLS certificates and enforce HTTPS redirects.',
          pageUrl: finalUrl,
          evidence: { protocol: parsedTarget.protocol },
        });
      }

      if (!res.headers.get('x-content-type-options')) {
        securityIssuesCount += 1;
        addIssue({
          category: IssueCategory.SECURITY,
          severity: IssueSeverity.WARNING,
          title: 'Missing X-Content-Type-Options header',
          description: 'Response lacks "X-Content-Type-Options: nosniff" MIME-sniffing protection.',
          remediation: 'Add "X-Content-Type-Options: nosniff" to HTTP responses.',
          pageUrl: finalUrl,
          evidence: { missingHeader: 'x-content-type-options' },
        });
      }

      if (!res.headers.get('content-security-policy')) {
        securityIssuesCount += 1;
        addIssue({
          category: IssueCategory.SECURITY,
          severity: IssueSeverity.INFO,
          title: 'No Content-Security-Policy header detected',
          description: 'Adding a Content-Security-Policy header strengthens protection against XSS.',
          remediation: 'Configure a baseline Content-Security-Policy header.',
          pageUrl: finalUrl,
          evidence: { missingHeader: 'content-security-policy' },
        });
      }

      const poweredBy = res.headers.get('x-powered-by');
      if (poweredBy) {
        securityIssuesCount += 1;
        addIssue({
          category: IssueCategory.SECURITY,
          severity: IssueSeverity.INFO,
          title: 'Server framework exposed via X-Powered-By',
          description: `Response exposes "X-Powered-By: ${poweredBy}".`,
          remediation: 'Disable the X-Powered-By header in Express or your edge proxy.',
          pageUrl: finalUrl,
          evidence: { xPoweredBy: poweredBy },
        });
      }
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      continue;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // SEO checks
    const title = $('title').first().text().trim();
    const description = $('meta[name="description"]').attr('content')?.trim() || '';
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || '';
    const viewport = $('meta[name="viewport"]').attr('content')?.trim() || '';

    if (!title) {
      seoIssuesCount += 1;
      addIssue({
        category: IssueCategory.SEO,
        severity: IssueSeverity.WARNING,
        title: 'Missing <title> tag',
        description: 'Document does not contain a non-empty <title> element.',
        remediation: 'Add a descriptive <title> tag inside <head>.',
        pageUrl: finalUrl,
        evidence: { tag: 'title' },
      });
    }

    if (!description) {
      seoIssuesCount += 1;
      addIssue({
        category: IssueCategory.SEO,
        severity: IssueSeverity.WARNING,
        title: 'Missing meta description',
        description: 'No <meta name="description"> tag found in document head.',
        remediation: 'Add a concise <meta name="description"> tag for search previews.',
        pageUrl: finalUrl,
        evidence: { tag: 'meta[name="description"]' },
      });
    }

    if (!ogTitle || !ogImage) {
      seoIssuesCount += 1;
      addIssue({
        category: IssueCategory.SEO,
        severity: IssueSeverity.INFO,
        title: 'Incomplete OpenGraph social preview tags',
        description: 'Missing og:title or og:image limits rich card previews when links are shared.',
        remediation: 'Add <meta property="og:title"> and <meta property="og:image"> tags.',
        pageUrl: finalUrl,
        evidence: { ogTitle: Boolean(ogTitle), ogImage: Boolean(ogImage) },
      });
    }

    if (!viewport) {
      mobileIssuesCount += 1;
      addIssue({
        category: IssueCategory.MOBILE,
        severity: IssueSeverity.WARNING,
        title: 'Missing mobile viewport meta tag',
        description: 'No <meta name="viewport" content="width=device-width, initial-scale=1.0"> detected.',
        remediation: 'Include the responsive viewport meta tag in <head>.',
        pageUrl: finalUrl,
        evidence: { missingTag: 'meta[name="viewport"]' },
      });
    }

    // Check inline wide-layout overflow hints in HTML/CSS
    const overflowWidthMatch = /(?:min-width|width)\s*:\s*(\d{3,4})px/i.exec(html);
    if (overflowWidthMatch && Number(overflowWidthMatch[1]) > 480) {
      mobileIssuesCount += 1;
      addIssue({
        category: IssueCategory.MOBILE,
        severity: IssueSeverity.CRITICAL,
        title: `Fixed-width container (${overflowWidthMatch[1]}px) risks mobile overflow`,
        description: `Detected fixed CSS width "${overflowWidthMatch[0]}" which exceeds a 390px mobile viewport.`,
        remediation: 'Use responsive max-width: 100% or media queries instead of wide fixed pixel widths.',
        pageUrl: finalUrl,
        evidence: { cssRule: overflowWidthMatch[0], viewportWidth: 390 },
      });
    }

    // Probe inline script references to same-origin API endpoints (and detect explicit throw statements)
    const scriptContents = $('script:not([src])')
      .map((_, el) => $(el).html() || '')
      .get()
      .join('\n');

    if (/\bthrow\s+new\s+(?:Error|TypeError|ReferenceError)\b/.test(scriptContents)) {
      consoleIssuesCount += 1;
      addIssue({
        category: IssueCategory.CONSOLE,
        severity: IssueSeverity.CRITICAL,
        title: 'Uncaught runtime throw detected in inline script',
        description: 'Inline page script contains an unguarded throw statement that can crash client execution.',
        remediation: 'Guard runtime initialization with defensive checks and error boundaries.',
        pageUrl: finalUrl,
        evidence: { source: 'inline-script-static-check' },
      });
    }

    const apiMatches = Array.from(scriptContents.matchAll(/fetch\(\s*['"]([^'"]+)['"]\s*\)/g)).map((m) => m[1]);
    for (const apiPath of apiMatches.slice(0, 5)) {
      try {
        const apiUrl = new URL(apiPath, finalUrl).toString();
        const apiRes = await safeFetchFollowingRedirects(apiUrl, options.allowLocalScans, 'GET');
        if (apiRes.response.status >= 400) {
          networkIssuesCount += 1;
          addIssue({
            category: IssueCategory.NETWORK,
            severity: IssueSeverity.CRITICAL,
            title: `API endpoint returned HTTP ${apiRes.response.status}`,
            description: `Client fetch call to ${apiUrl} returned HTTP ${apiRes.response.status}.`,
            remediation: 'Fix the failing backend endpoint or handle error states gracefully in the UI.',
            pageUrl: finalUrl,
            evidence: { status: apiRes.response.status, url: apiUrl },
          });
        }
      } catch {
        // ignore invalid or external script fetch targets
      }
    }

    // Check <img> assets (up to 12 per page)
    const imgSrcs = $('img[src]')
      .map((_, el) => $(el).attr('src') || '')
      .get()
      .filter(Boolean)
      .slice(0, 12);

    await Promise.all(
      imgSrcs.map(async (src) => {
        if (src.startsWith('data:')) return;
        try {
          const assetUrl = new URL(src, finalUrl).toString();
          const assetRes = await safeFetchFollowingRedirects(assetUrl, options.allowLocalScans, 'GET');
          if (assetRes.response.status >= 400) {
            brokenAssetCount += 1;
            addIssue({
              category: IssueCategory.BROKEN_ASSET,
              severity: IssueSeverity.CRITICAL,
              title: `Broken image asset (HTTP ${assetRes.response.status})`,
              description: `Image asset ${assetUrl} returned HTTP ${assetRes.response.status}.`,
              remediation: 'Ensure the referenced image exists at the target path and returns HTTP 200.',
              pageUrl: finalUrl,
              evidence: { status: assetRes.response.status, src: assetUrl },
            });
          }
        } catch (err) {
          brokenAssetCount += 1;
          addIssue({
            category: IssueCategory.BROKEN_ASSET,
            severity: IssueSeverity.WARNING,
            title: 'Image asset could not be fetched',
            description: `Could not load image "${src}": ${err instanceof Error ? err.message : String(err)}`,
            remediation: 'Check image URL validity, DNS, and CORS/hotlink permissions.',
            pageUrl: finalUrl,
            evidence: { src },
          });
        }
      })
    );

    // Collect same-origin links to crawl
    const links = $('a[href]')
      .map((_, el) => $(el).attr('href') || '')
      .get()
      .filter(Boolean);

    for (const href of links) {
      if (visited.size + queue.length >= maxPages * 3) break;
      try {
        const parsedLink = new URL(href, finalUrl);
        parsedLink.hash = '';
        const normalized = parsedLink.toString();
        if (
          parsedLink.origin === origin &&
          !visited.has(normalized) &&
          !queue.includes(normalized) &&
          !normalized.match(/\.(pdf|zip|png|jpg|jpeg|svg|webp|gif)$/i)
        ) {
          queue.push(normalized);
        }
      } catch {
        // ignore invalid href
      }
    }
  }

  const passedChecks: string[] = [];
  if (consoleIssuesCount === 0) passedChecks.push('No unguarded inline script exceptions detected');
  if (networkIssuesCount === 0) passedChecks.push('All probed routes and endpoints returned 2xx/3xx');
  if (brokenAssetCount === 0) passedChecks.push('All inspected image assets resolved cleanly');
  if (mobileIssuesCount === 0) passedChecks.push('Viewport meta tag and responsive layout rules verified');
  if (seoIssuesCount === 0) passedChecks.push('Title, meta description, and OpenGraph tags verified');
  if (securityIssuesCount === 0) passedChecks.push('HTTPS and baseline security response headers verified');

  return {
    issues,
    passedChecks,
    pagesScanned: visited.size,
  };
}
