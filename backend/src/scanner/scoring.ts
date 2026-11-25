import { IssueCategory, IssueSeverity, LaunchGrade, ScanSummary, ScreenshotEvidence } from '../types.ts';

export interface ScoreableIssue {
  severity: IssueSeverity;
  category: IssueCategory;
}

export interface ScoreResult {
  score: number;
  grade: LaunchGrade;
  summary: ScanSummary;
}

const SEVERITY_WEIGHTS: Record<IssueSeverity, number> = {
  [IssueSeverity.CRITICAL]: 18,
  [IssueSeverity.WARNING]: 7,
  [IssueSeverity.INFO]: 2,
};

export function gradeFromScore(score: number): LaunchGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 55) return 'D';
  return 'F';
}

export function calculateScore(
  issues: ScoreableIssue[],
  passedChecks: string[] = [],
  screenshots: ScreenshotEvidence[] = []
): ScoreResult {
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let totalDeduction = 0;

  for (const issue of issues) {
    if (issue.severity === IssueSeverity.CRITICAL) {
      criticalCount += 1;
    } else if (issue.severity === IssueSeverity.WARNING) {
      warningCount += 1;
    } else {
      infoCount += 1;
    }
    totalDeduction += SEVERITY_WEIGHTS[issue.severity] ?? 0;
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
  const grade = gradeFromScore(score);

  return {
    score,
    grade,
    summary: {
      criticalCount,
      warningCount,
      infoCount,
      passedChecks: Array.from(new Set(passedChecks)).slice(0, 50),
      ...(screenshots.length > 0 ? { screenshots } : {}),
    },
  };
}
