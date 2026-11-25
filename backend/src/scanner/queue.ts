import { EventEmitter } from 'node:events';
import { ScanMode, ScanProgressEvent, ScanStatus } from '../types.ts';
import { store } from '../db/store.ts';
import { runDualModeAudit } from './engine.ts';

interface QueuedJob {
  scanId: string;
  shareSlug: string;
  targetUrl: string;
  allowLocalScans?: boolean;
}

class ScanQueueManager {
  private readonly emitter = new EventEmitter();
  private readonly queue: QueuedJob[] = [];
  private readonly latestEvents = new Map<string, ScanProgressEvent>();
  private activeCount = 0;
  private readonly maxConcurrent = Number(process.env.MAX_CONCURRENT_SCANS) || 1;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  enqueue(job: QueuedJob): void {
    const queuedEvent: ScanProgressEvent = {
      scanId: job.scanId,
      shareSlug: job.shareSlug,
      status: ScanStatus.QUEUED,
      step: 'queued',
      label: 'Queued for launch audit...',
      progressPct: 5,
      timestamp: new Date().toISOString(),
    };
    this.publishEvent(queuedEvent);
    this.queue.push(job);
    void this.processNext();
  }

  enqueueAndWait(job: QueuedJob, timeoutMs = 25000): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsubscribe = this.subscribe(job.scanId, (event) => {
        if (event.status === ScanStatus.COMPLETED || event.status === ScanStatus.FAILED) {
          finish();
        }
      });
      this.enqueue(job);
    });
  }

  subscribe(idOrSlug: string, listener: (event: ScanProgressEvent) => void): () => void {
    const channel = `scan:${idOrSlug}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  getLatestEvent(idOrSlug: string): ScanProgressEvent | undefined {
    return this.latestEvents.get(idOrSlug);
  }

  private publishEvent(event: ScanProgressEvent): void {
    this.latestEvents.set(event.scanId, event);
    this.latestEvents.set(event.shareSlug, event);
    this.emitter.emit(`scan:${event.scanId}`, event);
    this.emitter.emit(`scan:${event.shareSlug}`, event);
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift()!;
    this.activeCount += 1;

    try {
      const startedAt = new Date().toISOString();
      await store.updateScanRun(job.scanId, {
        status: ScanStatus.RUNNING,
        startedAt,
      });

      this.publishEvent({
        scanId: job.scanId,
        shareSlug: job.shareSlug,
        status: ScanStatus.RUNNING,
        step: 'starting',
        label: 'Initializing ShipCheck scanner...',
        progressPct: 8,
        timestamp: startedAt,
      });

      const result = await runDualModeAudit(job.targetUrl, {
        allowLocalScans: job.allowLocalScans,
        onStep: (step, label, progressPct, scanMode, pagesScanned) => {
          this.publishEvent({
            scanId: job.scanId,
            shareSlug: job.shareSlug,
            status: ScanStatus.RUNNING,
            step,
            label,
            progressPct,
            scanMode,
            pagesScanned,
            timestamp: new Date().toISOString(),
          });
        },
      });

      await store.addScanIssues(job.scanId, result.issues);
      const completedAt = new Date().toISOString();
      await store.updateScanRun(job.scanId, {
        status: ScanStatus.COMPLETED,
        scanMode: result.scanMode,
        score: result.score,
        grade: result.grade,
        summary: result.summary,
        pagesScanned: result.pagesScanned,
        durationMs: result.durationMs,
        completedAt,
      });

      this.publishEvent({
        scanId: job.scanId,
        shareSlug: job.shareSlug,
        status: ScanStatus.COMPLETED,
        step: 'completed',
        label: `Audit complete — Score ${result.score}/100 (Grade ${result.grade})`,
        progressPct: 100,
        scanMode: result.scanMode,
        pagesScanned: result.pagesScanned,
        score: result.score,
        grade: result.grade,
        timestamp: completedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed unexpectedly';
      const completedAt = new Date().toISOString();
      await store.updateScanRun(job.scanId, {
        status: ScanStatus.FAILED,
        errorMessage: message,
        completedAt,
      });

      this.publishEvent({
        scanId: job.scanId,
        shareSlug: job.shareSlug,
        status: ScanStatus.FAILED,
        step: 'failed',
        label: 'Launch audit failed',
        progressPct: 100,
        scanMode: ScanMode.HTTP_CHEERIO,
        errorMessage: message,
        timestamp: completedAt,
      });
    } finally {
      this.activeCount -= 1;
      void this.processNext();
    }
  }
}

export const scanQueue = new ScanQueueManager();
