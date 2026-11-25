export enum ScanStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum TriggerType {
  MANUAL = 'MANUAL',
  WEBHOOK = 'WEBHOOK',
}

export enum ScanMode {
  PLAYWRIGHT = 'PLAYWRIGHT',
  HTTP_CHEERIO = 'HTTP_CHEERIO',
}

export enum IssueCategory {
  CONSOLE = 'CONSOLE',
  NETWORK = 'NETWORK',
  MOBILE = 'MOBILE',
  BROKEN_ASSET = 'BROKEN_ASSET',
  SEO = 'SEO',
  SECURITY = 'SECURITY',
}

export enum IssueSeverity {
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export type LaunchGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScreenshotEvidence {
  label: string;
  viewport: '1280×800' | '390×844';
  pageUrl: string;
  dataUrl: string;
  caption?: string;
}

export interface ScanSummary {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  passedChecks: string[];
  screenshots?: ScreenshotEvidence[];
}

export interface ScanIssueInput {
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  remediation: string;
  pageUrl: string;
  evidence: Record<string, unknown>;
}

export interface ScanIssueRecord extends ScanIssueInput {
  id: string;
  scanRunId: string;
  createdAt: string;
}

export interface ScanRunRecord {
  id: string;
  shareSlug: string;
  ownerId: string | null;
  targetUrl: string;
  status: ScanStatus;
  triggerType: TriggerType;
  scanMode: ScanMode;
  score: number | null;
  grade: LaunchGrade | null;
  summary: ScanSummary | null;
  pagesScanned: number;
  durationMs: number | null;
  errorMessage: string | null;
  projectId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  issues?: ScanIssueRecord[];
}

export interface ProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  targetUrl: string;
  webhookToken: string;
  createdAt: string;
  updatedAt: string;
  recentScans?: ScanRunRecord[];
}

export interface ScanProgressEvent {
  scanId: string;
  shareSlug: string;
  status: ScanStatus;
  step: string;
  label: string;
  progressPct: number;
  scanMode?: ScanMode;
  pagesScanned?: number;
  score?: number | null;
  grade?: LaunchGrade | null;
  errorMessage?: string | null;
  timestamp: string;
}
