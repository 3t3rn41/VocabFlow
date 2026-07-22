import { useState, useEffect } from 'react';
import { useUiStore } from '@/stores/ui';
import { useSettingsStore } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { useAuthStore } from '@/stores/auth';
import { getBookMeta } from '@/data/wordbooks';

export function Topbar() {
  const toggle = useUiStore((s) => s.toggleSidebar);
  const theme = useSettingsStore((s) => s.theme);
  const patchSettings = useSettingsStore((s) => s.patch);
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  const username = useAuthStore((s) => s.user?.username);
  const logout = useAuthStore((s) => s.logout);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  function handleFullscreenToggle() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  /** 点击太阳/月亮图标，在亮色/暗色之间直接切换 */
  function handleThemeToggle() {
    // 计算当前实际生效的主题（system 模式下需读取系统偏好）
    let isDark: boolean;
    if (theme === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      isDark = theme === 'dark';
    }
    patchSettings({ theme: isDark ? 'light' : 'dark' });
  }

  // 计算当前实际生效的主题，决定显示哪个图标
  const isDarkActive =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="h-14 px-4 md:px-6 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      {/* 左侧：移动端显示标题，桌面端显示折叠按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          className="hidden md:block p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          ☰
        </button>
        <span className="md:hidden font-bold text-brand-600 text-lg">涓词 VocabFlow</span>
        {bookMeta && (
          <span className="hidden sm:inline text-xs text-slate-400 truncate max-w-[160px]">
            {bookMeta.title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleThemeToggle}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition text-lg leading-none"
          title={isDarkActive ? '切换为浅色' : '切换为深色'}
        >
          {isDarkActive ? '🌙' : '☀️'}
        </button>
        <button
          onClick={handleFullscreenToggle}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition text-lg leading-none"
          title={isFullscreen ? '退出全屏' : '全屏'}
        >
          {isFullscreen ? '🗗' : '⛶'}
        </button>
        {username && (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm text-slate-600 dark:text-slate-300">
              👤 {username}
            </span>
            <button
              onClick={logout}
              className="text-xs text-slate-400 hover:text-red-500 transition px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
              title="退出登录"
            >
              退出
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
