import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { AppLayout } from '@/components/layout/AppLayout';
import { WordBookSelection } from '@/pages/WordBookSelection';
import { Today } from '@/pages/Today';
import { Review } from '@/pages/Review';
import { Words } from '@/pages/Words';
import { WordDetail } from '@/pages/WordDetail';
import { Sentences } from '@/pages/Sentences';
import { Settings } from '@/pages/Settings';
import { ToastContainer } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Spinner';

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const settingsLoading = useSettingsStore((s) => s.loading);
  const bookLoading = useWordBookStore((s) => s.loading);
  const hasSelectedBook = useWordBookStore((s) => s.hasSelectedBook);
  const initSettings = useSettingsStore((s) => s.init);
  const initBook = useWordBookStore((s) => s.init);

  // 启动时从后端加载设置和活跃词书
  useEffect(() => {
    initSettings();
    initBook();
  }, [initSettings, initBook]);

  // 应用主题: theme 变化或系统主题变化时同步 <html class="dark">
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

  // 等待后端数据加载完成
  if (settingsLoading || bookLoading) {
    return (
      <div className="h-screen flex items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-slate-500">加载中...</span>
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
          <Route path="/settings" element={<Settings />} />
          <Route path="/select-book" element={<WordBookSelection />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
      <ToastContainer />
    </>
  );
}
