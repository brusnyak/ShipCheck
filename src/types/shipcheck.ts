export type ScanStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type TriggerType = 'MANUAL' | 'WEBHOOK';
export type ScanMode = 'PLAYWRIGHT' | 'HTTP_CHEERIO';
export type IssueCategory =
  | 'CONSOLE'
  | 'NETWORK'
  | 'MOBILE'
  | 'BROKEN_ASSET'
  | 'SEO'
  | 'SECURITY';
export type IssueSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
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

export interface ScanIssue {
  id: string;
  scanRunId: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  remediation: string;
  pageUrl: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface ScanRun {
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
  issues?: ScanIssue[];
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  targetUrl: string;
  webhookToken: string;
  createdAt: string;
  updatedAt: string;
  recentScans?: ScanRun[];
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
