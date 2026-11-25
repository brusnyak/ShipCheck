import { describe, expect, it } from 'vitest';
import { calculateScore, gradeFromScore } from '../../backend/src/scanner/scoring.ts';
import { IssueCategory, IssueSeverity } from '../../backend/src/types.ts';

describe('calculateScore()', () => {
  it('returns 100 and Grade A when zero issues exist', () => {
    const result = calculateScore([], ['HTTPS verified', 'Zero console errors', 'HTTPS verified']);
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.summary).toEqual({
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      passedChecks: ['HTTPS verified', 'Zero console errors'],
    });
  });

  it('applies deterministic severity deductions and computes exact grades', () => {
    const result = calculateScore([
      { severity: IssueSeverity.CRITICAL, category: IssueCategory.CONSOLE },
      { severity: IssueSeverity.WARNING, category: IssueCategory.SEO },
      { severity: IssueSeverity.INFO, category: IssueCategory.SECURITY },
    ]);

    // 100 - 18 - 7 - 2 = 73 -> Grade C
    expect(result.score).toBe(73);
    expect(result.grade).toBe('C');
    expect(result.summary.criticalCount).toBe(1);
    expect(result.summary.warningCount).toBe(1);
    expect(result.summary.infoCount).toBe(1);
  });

  it('clamps score at 0 for severe multi-failure sites', () => {
    const manyCriticals = Array.from({ length: 8 }, () => ({
      severity: IssueSeverity.CRITICAL,
      category: IssueCategory.NETWORK,
    }));

    const result = calculateScore(manyCriticals);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.summary.criticalCount).toBe(8);
  });

  it('maps grade boundary thresholds accurately', () => {
    expect(gradeFromScore(90)).toBe('A');
    expect(gradeFromScore(89)).toBe('B');
    expect(gradeFromScore(80)).toBe('B');
    expect(gradeFromScore(79)).toBe('C');
    expect(gradeFromScore(70)).toBe('C');
    expect(gradeFromScore(69)).toBe('D');
    expect(gradeFromScore(55)).toBe('D');
    expect(gradeFromScore(54)).toBe('F');
  });
});
