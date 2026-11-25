import { useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';
import { TopBar } from './components/TopBar';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AgentsPage } from './pages/AgentsPage';
import { LandingPage } from './pages/LandingPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ReportPage } from './pages/ReportPage';

function AppRoutes() {
  const [path, setPath] = useState<string>(() => window.location.pathname || '/');

  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    if (nextPath !== window.location.pathname) {
      window.history.pushState({}, '', nextPath);
      setPath(nextPath);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, []);

  const reportMatch = /^\/reports\/([a-zA-Z0-9_-]+)\/?$/.exec(path);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 flex flex-col">
      <TopBar currentPath={path} onNavigate={navigate} />
      <main className="flex-1">
        {reportMatch ? (
          <ReportPage slug={reportMatch[1]} onNavigate={navigate} />
        ) : path.startsWith('/projects') ? (
          <ProjectsPage onNavigate={navigate} />
        ) : path.startsWith('/agents') ? (
          <AgentsPage />
        ) : (
          <LandingPage onNavigate={navigate} />
        )}
      </main>
      <Footer onNavigate={navigate} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
