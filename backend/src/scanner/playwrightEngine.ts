import { chromium, type Browser, type Page } from 'playwright';
import { IssueCategory, IssueSeverity, ScanIssueInput, ScreenshotEvidence } from '../types.ts';
import { normalizeAndValidateUrl } from '../security/ssrf.ts';

export class PlaywrightLaunchError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PlaywrightLaunchError';
  }
}

export interface EngineAuditResult {
  issues: ScanIssueInput[];
  passedChecks: string[];
  pagesScanned: number;
  screenshots?: ScreenshotEvidence[];
}

export type ProgressCallback = (step: string, label: string, progressPct: number, pagesScanned: number) => void;

const DEFAULT_MAX_PAGES = 4;

async function captureCompactScreenshot(page: Page): Promise<string | null> {
  try {
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 52,
      fullPage: false,
      timeout: 5000,
    });
    if (buffer.byteLength > 180 * 1024) {
      return null;
    }
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function runPlaywrightAudit(
  targetUrl: string,
  options: {
    allowLocalScans?: boolean;
    maxPages?: number;
    onProgress?: ProgressCallback;
  } = {}
): Promise<EngineAuditResult> {
  const maxPages = options.maxPages ?? (Number(process.env.MAX_PAGES_PER_SCAN) || DEFAULT_MAX_PAGES);
  let browser: Browser;

  const remoteWs = process.env.BROWSER_WS_ENDPOINT?.trim();
  try {
    if (remoteWs) {
      try {
        browser = await chromium.connectOverCDP(remoteWs);
      } catch {
        browser = await chromium.connect(remoteWs);
      }
    } else {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
        ],
      });
    }
  } catch (err) {
    throw new PlaywrightLaunchError('Headless Chromium is unavailable in this environment.', err);
  }

  const issues: ScanIssueInput[] = [];
  const screenshots: ScreenshotEvidence[] = [];
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

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'ShipCheckBot/1.0 (+https://shipcheck.dev)',
    });

    const page = await context.newPage();

    // Abort heavy media & font requests to stay well under 512MB RAM
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (resourceType === 'media' || resourceType === 'font') {
        return route.abort();
      }
      return route.continue();
    });

    while (queue.length > 0 && visited.size < maxPages) {
      const currentUrl = queue.shift()!;
      if (visited.has(currentUrl)) continue;

      // SSRF check on every crawled link before navigation
      try {
        await normalizeAndValidateUrl(currentUrl, { allowLocalScans: options.allowLocalScans });
      } catch {
        continue;
      }

      visited.add(currentUrl);
      const pageIndex = visited.size;
      const pct = Math.min(85, 25 + Math.round((pageIndex / maxPages) * 55));
      options.onProgress?.(
        'crawling',
        `Auditing page ${pageIndex}/${maxPages}: ${new URL(currentUrl).pathname || '/'}`,
        pct,
        pageIndex
      );

      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const failedResponses: Array<{ url: string; status: number; resourceType: string }> = [];

      const onPageError = (err: Error) => {
        pageErrors.push(err.message || String(err));
      };
      const onConsole = (msg: { type: () => string; text: () => string }) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      };
      const onResponse = (res: { url: () => string; status: () => number; request: () => { resourceType: () => string } }) => {
        const status = res.status();
        const url = res.url();
        if (status >= 400 && !url.endsWith('/favicon.ico')) {
          failedResponses.push({
            url,
            status,
            resourceType: res.request().resourceType(),
          });
        }
      };

      page.on('pageerror', onPageError);
      page.on('console', onConsole);
      page.on('response', onResponse);

      try {
        await page.setViewportSize({ width: 1280, height: 800 });
        const mainResponse = await page.goto(currentUrl, {
          waitUntil: 'networkidle',
          timeout: 15000,
        }).catch(async () => {
          return page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        });

        await page.waitForTimeout(450);

        if (mainResponse) {
          const status = mainResponse.status();
          if (status >= 400) {
            networkIssuesCount += 1;
            addIssue({
              category: IssueCategory.NETWORK,
              severity: IssueSeverity.CRITICAL,
              title: `Page returned HTTP ${status}`,
              description: `Navigating to ${currentUrl} returned an error status code (${status}).`,
              remediation: 'Verify the route handler, deployment routing rules, and server logs for unhandled exceptions.',
              pageUrl: currentUrl,
              evidence: { status, url: currentUrl },
            });
          }

          if (pageIndex === 1) {
            const headers = mainResponse.headers();
            const parsedTarget = new URL(currentUrl);
            if (parsedTarget.protocol !== 'https:' && parsedTarget.hostname !== '127.0.0.1' && parsedTarget.hostname !== 'localhost') {
              securityIssuesCount += 1;
              addIssue({
                category: IssueCategory.SECURITY,
                severity: IssueSeverity.CRITICAL,
                title: 'Site is not served over HTTPS',
                description: 'Plaintext HTTP leaves user sessions and API payloads exposed to interception.',
                remediation: 'Enable TLS/HTTPS and configure automatic HTTP-to-HTTPS redirects at your edge or load balancer.',
                pageUrl: currentUrl,
                evidence: { protocol: parsedTarget.protocol },
              });
            }

            if (!headers['x-content-type-options']) {
              securityIssuesCount += 1;
              addIssue({
                category: IssueCategory.SECURITY,
                severity: IssueSeverity.WARNING,
                title: 'Missing X-Content-Type-Options header',
                description: 'Responses lack "X-Content-Type-Options: nosniff", allowing browsers to MIME-sniff untrusted payloads.',
                remediation: 'Set "X-Content-Type-Options: nosniff" via Helmet or your reverse proxy configuration.',
                pageUrl: currentUrl,
                evidence: { missingHeader: 'x-content-type-options' },
              });
            }

            if (!headers['content-security-policy']) {
              securityIssuesCount += 1;
              addIssue({
                category: IssueCategory.SECURITY,
                severity: IssueSeverity.INFO,
                title: 'No Content-Security-Policy header detected',
                description: 'A Content-Security-Policy (CSP) helps mitigate XSS by restricting allowed script and resource origins.',
                remediation: 'Configure a baseline Content-Security-Policy header tuned to your trusted script and asset origins.',
                pageUrl: currentUrl,
                evidence: { missingHeader: 'content-security-policy' },
              });
            }

            if (headers['x-powered-by']) {
              securityIssuesCount += 1;
              addIssue({
                category: IssueCategory.SECURITY,
                severity: IssueSeverity.INFO,
                title: 'Server framework exposed via X-Powered-By',
                description: `Response exposes "X-Powered-By: ${headers['x-powered-by']}", leaking runtime stack details.`,
                remediation: 'Disable the X-Powered-By header (e.g. app.disable("x-powered-by") or Helmet).',
                pageUrl: currentUrl,
                evidence: { xPoweredBy: headers['x-powered-by'] },
              });
            }
          }
        }

        // Uncaught runtime errors
        for (const errMsg of pageErrors) {
          consoleIssuesCount += 1;
          addIssue({
            category: IssueCategory.CONSOLE,
            severity: IssueSeverity.CRITICAL,
            title: 'Uncaught runtime exception',
            description: `An unhandled JavaScript error occurred during page execution: ${errMsg.slice(0, 240)}`,
            remediation: 'Inspect the stack trace in browser DevTools and wrap fragile initialization or async code with error boundaries.',
            pageUrl: currentUrl,
            evidence: { type: 'pageerror', message: errMsg },
          });
        }

        for (const msg of consoleErrors) {
          consoleIssuesCount += 1;
          addIssue({
            category: IssueCategory.CONSOLE,
            severity: IssueSeverity.CRITICAL,
            title: 'Console error logged during load',
            description: `Browser console logged an error: ${msg.slice(0, 240)}`,
            remediation: 'Resolve the underlying client error or failed API call triggering console.error during render.',
            pageUrl: currentUrl,
            evidence: { type: 'console.error', message: msg },
          });
        }

        for (const failed of failedResponses) {
          if (failed.resourceType === 'image') {
            brokenAssetCount += 1;
            addIssue({
              category: IssueCategory.BROKEN_ASSET,
              severity: IssueSeverity.CRITICAL,
              title: `Broken image asset (HTTP ${failed.status})`,
              description: `Image failed to load with HTTP ${failed.status}: ${failed.url}`,
              remediation: 'Verify the asset path exists in your build output or CDN bucket and uses case-exact filenames.',
              pageUrl: currentUrl,
              evidence: failed,
            });
          } else {
            networkIssuesCount += 1;
            const isCritical = failed.status >= 500 || failed.url.includes('/api/');
            addIssue({
              category: IssueCategory.NETWORK,
              severity: isCritical ? IssueSeverity.CRITICAL : IssueSeverity.WARNING,
              title: `Failed ${failed.resourceType} request (HTTP ${failed.status})`,
              description: `Request to ${failed.url} returned HTTP ${failed.status}.`,
              remediation: 'Check backend API routes, auth headers, CORS rules, or missing static bundle references.',
              pageUrl: currentUrl,
              evidence: failed,
            });
          }
        }

        // DOM inspection for broken images, SEO tags, and internal links
        const domReport = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img')).map((img) => ({
            src: img.getAttribute('src') || '',
            alt: img.getAttribute('alt'),
            complete: img.complete,
            naturalWidth: img.naturalWidth,
          }));
          const title = document.title?.trim() || '';
          const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
          const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content')?.trim() || '';
          const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
          const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || '';
          const links = Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter(Boolean);

          return { imgs, title, description, viewport, ogTitle, ogImage, links };
        });

        for (const img of domReport.imgs) {
          if (img.complete && img.naturalWidth === 0) {
            brokenAssetCount += 1;
            addIssue({
              category: IssueCategory.BROKEN_ASSET,
              severity: IssueSeverity.CRITICAL,
              title: 'Image failed to render (naturalWidth = 0)',
              description: `Image element with src "${img.src || '(empty)'}" rendered with 0px width.`,
              remediation: 'Ensure the image URL resolves to a valid image file and is bundled into your public/assets directory.',
              pageUrl: currentUrl,
              evidence: img,
            });
          }
        }

        if (!domReport.title) {
          seoIssuesCount += 1;
          addIssue({
            category: IssueCategory.SEO,
            severity: IssueSeverity.WARNING,
            title: 'Missing <title> tag',
            description: 'The page is missing a non-empty <title> element, hurting search indexing and browser tab clarity.',
            remediation: 'Add a concise, unique <title> inside <head>.',
            pageUrl: currentUrl,
            evidence: { tag: 'title' },
          });
        }

        if (!domReport.description) {
          seoIssuesCount += 1;
          addIssue({
            category: IssueCategory.SEO,
            severity: IssueSeverity.WARNING,
            title: 'Missing meta description',
            description: 'No <meta name="description"> tag was found in the document head.',
            remediation: 'Add <meta name="description" content="..."> summarizing the page in 120–160 characters.',
            pageUrl: currentUrl,
            evidence: { tag: 'meta[name="description"]' },
          });
        }

        if (!domReport.ogTitle || !domReport.ogImage) {
          seoIssuesCount += 1;
          addIssue({
            category: IssueCategory.SEO,
            severity: IssueSeverity.INFO,
            title: 'Incomplete OpenGraph social preview tags',
            description: 'Missing og:title or og:image reduces link preview quality when shared in Slack, Discord, or X.',
            remediation: 'Include <meta property="og:title"> and <meta property="og:image"> in your HTML <head>.',
            pageUrl: currentUrl,
            evidence: { ogTitle: Boolean(domReport.ogTitle), ogImage: Boolean(domReport.ogImage) },
          });
        }

        if (!domReport.viewport) {
          mobileIssuesCount += 1;
          addIssue({
            category: IssueCategory.MOBILE,
            severity: IssueSeverity.WARNING,
            title: 'Missing mobile viewport meta tag',
            description: 'Document lacks <meta name="viewport" content="width=device-width, initial-scale=1.0">.',
            remediation: 'Add the standard responsive viewport meta tag to <head> so mobile devices scale CSS pixels properly.',
            pageUrl: currentUrl,
            evidence: { missingTag: 'meta[name="viewport"]' },
          });
        }

        // Capture desktop screenshot evidence on primary route or when runtime errors occur
        const hasDesktopErrors =
          pageErrors.length > 0 || consoleErrors.length > 0 || failedResponses.length > 0;
        if ((pageIndex === 1 || hasDesktopErrors) && screenshots.length < 4) {
          const desktopDataUrl = await captureCompactScreenshot(page);
          if (desktopDataUrl) {
            screenshots.push({
              label: hasDesktopErrors ? 'Desktop Error State' : 'Desktop Viewport',
              viewport: '1280×800',
              pageUrl: currentUrl,
              dataUrl: desktopDataUrl,
              caption: hasDesktopErrors
                ? `${pageErrors.length + consoleErrors.length} runtime error(s), ${failedResponses.length} failed request(s)`
                : 'Primary desktop render at 1280×800',
            });
          }
        }

        // Mobile 390x844 horizontal overflow check
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(150);
        const mobileMetrics = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            overflowPx: doc.scrollWidth - doc.clientWidth,
          };
        });

        let mobileScreenshotUrl: string | null = null;
        if ((pageIndex === 1 || mobileMetrics.overflowPx > 2) && screenshots.length < 4) {
          mobileScreenshotUrl = await captureCompactScreenshot(page);
          if (mobileScreenshotUrl) {
            screenshots.push({
              label:
                mobileMetrics.overflowPx > 2
                  ? `Mobile Overflow (+${mobileMetrics.overflowPx}px)`
                  : 'Mobile Viewport',
              viewport: '390×844',
              pageUrl: currentUrl,
              dataUrl: mobileScreenshotUrl,
              caption:
                mobileMetrics.overflowPx > 2
                  ? `scrollWidth ${mobileMetrics.scrollWidth}px exceeds ${mobileMetrics.clientWidth}px`
                  : 'Responsive mobile render at 390×844',
            });
          }
        }

        if (mobileMetrics.overflowPx > 2) {
          mobileIssuesCount += 1;
          addIssue({
            category: IssueCategory.MOBILE,
            severity: IssueSeverity.CRITICAL,
            title: `Mobile horizontal overflow (${mobileMetrics.overflowPx}px)`,
            description: `At 390×844 mobile viewport, page scrollWidth (${mobileMetrics.scrollWidth}px) exceeds clientWidth (${mobileMetrics.clientWidth}px).`,
            remediation: 'Replace fixed pixel widths with max-w-full / responsive containers, or wrap wide tables in overflow-x-auto.',
            pageUrl: currentUrl,
            evidence: {
              viewport: '390x844',
              ...mobileMetrics,
              ...(mobileScreenshotUrl ? { screenshotDataUrl: mobileScreenshotUrl } : {}),
            },
          });
        }

        // Enqueue same-origin internal links
        for (const link of domReport.links) {
          if (visited.size + queue.length >= maxPages * 3) break;
          try {
            const parsedLink = new URL(link);
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
            // ignore malformed href
          }
        }
      } finally {
        page.off('pageerror', onPageError);
        page.off('console', onConsole);
        page.off('response', onResponse);
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  const passedChecks: string[] = [];
  if (consoleIssuesCount === 0) passedChecks.push('Zero uncaught runtime or console errors');
  if (networkIssuesCount === 0) passedChecks.push('All crawled routes and API requests returned 2xx/3xx');
  if (brokenAssetCount === 0) passedChecks.push('All rendered images and static assets loaded cleanly');
  if (mobileIssuesCount === 0) passedChecks.push('Mobile viewport (390×844) rendered with zero horizontal overflow');
  if (seoIssuesCount === 0) passedChecks.push('Title, meta description, and OpenGraph tags verified');
  if (securityIssuesCount === 0) passedChecks.push('HTTPS and baseline security response headers verified');

  return {
    issues,
    passedChecks,
    pagesScanned: visited.size,
    screenshots,
  };
}
