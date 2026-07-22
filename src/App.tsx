import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSettingsStore, applyCardTheme } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { useAuthStore } from '@/stores/auth';
import { AppLayout } from '@/components/layout/AppLayout';
import { WordBookSelection } from '@/pages/WordBookSelection';
import { Login } from '@/pages/Login';
import { Today } from '@/pages/Today';
import { Review } from '@/pages/Review';
import { Words } from '@/pages/Words';
import { WordDetail } from '@/pages/WordDetail';
import { Sentences } from '@/pages/Sentences';
import { Settings } from '@/pages/Settings';
import { Dictation } from '@/pages/Dictation';
import { Quiz } from '@/pages/Quiz';
import { Translate } from '@/pages/Translate';
import { MatchGame } from '@/pages/MatchGame';
import { Favorites } from '@/pages/Favorites';
import { Stats } from '@/pages/Stats';
import { ToastContainer } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Spinner';
import { useStudyReminder } from '@/hooks/useStudyReminder';

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const cardTheme = useSettingsStore((s) => s.cardTheme);
  const settingsLoading = useSettingsStore((s) => s.loading);
  const bookLoading = useWordBookStore((s) => s.loading);
  const hasSelectedBook = useWordBookStore((s) => s.hasSelectedBook);
  const initSettings = useSettingsStore((s) => s.init);
  const initBook = useWordBookStore((s) => s.init);

  const { isAuthenticated, loading: authLoading, user, init: initAuth } = useAuthStore();

  useStudyReminder();

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      initSettings();
      initBook();
    }
  }, [isAuthenticated, initSettings, initBook]);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mq.matches);
      root.classList.toggle('dark', isDark);
    };

    apply();

    if (theme === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  useEffect(() => {
    applyCardTheme(cardTheme);
  }, [cardTheme]);

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center gap-3 px-4">
        <Spinner size="lg" />
        <span className="text-slate-500 text-sm md:text-base">加载中...</span>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <>
        <Login />
        <ToastContainer />
      </>
    );
  }

  if (settingsLoading || bookLoading) {
    return (
      <div className="h-screen flex items-center justify-center gap-3 px-4">
        <Spinner size="lg" />
        <span className="text-slate-500 text-sm md:text-base">加载中...</span>
      </div>
    );
  }

  if (!hasSelectedBook) {
    return (
      <>
        <WordBookSelection />
        <ToastContainer />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/today" element={<Today />} />
          <Route path="/review" element={<Review />} />
          <Route path="/words" element={<Words />} />
          <Route path="/words/:id" element={<WordDetail />} />
          <Route path="/sentences" element={<Sentences />} />
          <Route path="/dictation" element={<Dictation />} />
                    <Route path="/quiz" element={<Quiz />} />
          <Route path="/translate" element={<Translate />} />
          <Route path="/match" element={<MatchGame />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/select-book" element={<WordBookSelection />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
      <ToastContainer />
    </>
  );
}
