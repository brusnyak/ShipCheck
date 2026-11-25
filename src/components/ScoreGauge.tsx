import type { LaunchGrade } from '../types/shipcheck';

interface ScoreGaugeProps {
  score: number;
  grade: LaunchGrade;
}

export function ScoreGauge({ score, grade }: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  const tone =
    grade === 'A' || grade === 'B'
      ? {
          stroke: 'stroke-emerald-600 dark:stroke-emerald-500',
          text: 'text-emerald-700 dark:text-emerald-400',
          statusLabel: grade === 'A' ? 'Launch Ready' : 'Minor Polish',
        }
      : grade === 'C' || grade === 'D'
        ? {
            stroke: 'stroke-amber-500',
            text: 'text-amber-700 dark:text-amber-400',
            statusLabel: 'Needs Attention',
          }
        : {
            stroke: 'stroke-rose-600 dark:stroke-rose-500',
            text: 'text-rose-700 dark:text-rose-400',
            statusLabel: 'Launch Blocked',
          };

  return (
    <div className="flex items-center gap-5 shrink-0">
      <div className="relative w-32 h-32 flex items-center justify-center">
        <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="8"
            className="stroke-zinc-200 dark:stroke-zinc-800"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={`${tone.stroke} transition-all duration-500`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-50 leading-none">
            {clamped}
          </span>
          <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-1">/ 100</span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline gap-2.5">
          <span className={`text-3xl font-bold font-mono ${tone.text}`}>Grade {grade}</span>
        </div>
        <p className={`text-sm font-medium ${tone.text}`}>{tone.statusLabel}</p>
      </div>
    </div>
  );
}
