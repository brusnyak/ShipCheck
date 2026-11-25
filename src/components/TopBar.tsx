import { LogIn, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface TopBarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function TopBar({ currentPath, onNavigate }: TopBarProps) {
  const { user, loading, signInWithGoogle, signOutUser } = useAuth();

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (path.startsWith('/#')) {
      const hash = path.slice(2);
      if (currentPath === '/') {
        e.preventDefault();
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      e.preventDefault();
      onNavigate('/');
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
      return;
    }
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800/90 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 h-18 flex items-center justify-between gap-10">
        <a
          href="/"
          onClick={(e) => handleNavClick(e, '/')}
          className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50 whitespace-nowrap shrink-0 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
        >
          ShipCheck
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium">
          <a
            href="/"
            onClick={(e) => handleNavClick(e, '/')}
            className={`whitespace-nowrap shrink-0 transition-colors hover:underline underline-offset-4 ${
              currentPath === '/'
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            Scanner
          </a>
          <a
            href="/projects"
            onClick={(e) => handleNavClick(e, '/projects')}
            className={`whitespace-nowrap shrink-0 transition-colors hover:underline underline-offset-4 ${
              currentPath.startsWith('/projects')
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            Projects
          </a>
          <a
            href="/agents"
            onClick={(e) => handleNavClick(e, '/agents')}
            className={`whitespace-nowrap shrink-0 transition-colors hover:underline underline-offset-4 ${
              currentPath.startsWith('/agents')
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            Agents &amp; MCP
          </a>
          <a
            href="/#how-it-works"
            onClick={(e) => handleNavClick(e, '/#how-it-works')}
            className="hidden sm:inline-block whitespace-nowrap shrink-0 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors hover:underline underline-offset-4"
          >
            How It Works
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {loading ? (
            <div className="h-9 w-24 rounded-lg bg-zinc-200 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <span className="hidden md:inline-block text-xs font-mono text-zinc-500 dark:text-zinc-400 truncate max-w-[160px]">
                {user.email || user.displayName}
              </span>
              <button
                type="button"
                onClick={() => void signOutUser()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
