import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '../context/ThemeContext';

interface FooterProps {
  onNavigate: (path: string) => void;
}

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Day', Icon: Sun },
  { value: 'dark', label: 'Night', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

export function Footer({ onNavigate }: FooterProps) {
  const { mode, setMode } = useTheme();

  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 py-10 flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex flex-wrap items-center gap-7 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">ShipCheck</span>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            Scanner
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/projects')}
            className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            Projects &amp; Webhooks
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/agents')}
            className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            Agents &amp; MCP
          </button>
          <a
            href="https://github.com/brusnyak/shipcheck"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors whitespace-nowrap"
          >
            GitHub
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-center md:justify-end gap-5">
          {/* Day / Night / Browser System Switcher */}
          <div
            role="group"
            aria-label="Color theme"
            className="inline-flex items-center gap-0.5 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
          >
            {THEME_OPTIONS.map(({ value, label, Icon }) => {
              const active = mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Lingonberry Creator Signature (adaptive Day/Night image pair) */}
          <div className="flex items-center gap-2.5 pl-4 border-l border-zinc-200 dark:border-zinc-800">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              Created by <span className="font-medium text-zinc-800 dark:text-zinc-200">Lingonberry</span>
            </span>
            <img
              src="/assets/aistudio/black_sign_90f7a0a1.png"
              alt="Lingonberry creator signature"
              className="h-7 w-auto object-contain dark:hidden mix-blend-multiply select-none"
            />
            <img
              src="/assets/aistudio/white_sign_8726de1f.png"
              alt="Lingonberry creator signature"
              className="h-7 w-auto object-contain hidden dark:block mix-blend-screen select-none"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
