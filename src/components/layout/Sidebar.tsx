import { NavLink } from 'react-router-dom';
import { useUiStore } from '@/stores/ui';
import { useWordBookStore } from '@/stores/wordBook';
import { useAuthStore } from '@/stores/auth';
import { getBookMeta } from '@/data/wordbooks';
import { clsx } from 'clsx';

/* SVG 图标组件 */
function Icon({ name, className }: { name: string; className?: string }) {
  const icons: Record<string, React.ReactElement> = {
    home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M9 22V12h6v10" /></svg>,
    review: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M3 12a9 9 0 0115.5-6.5L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 01-15.5 6.5L3 16" /><path d="M3 21v-5h5" /></svg>,
    dictation: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><path d="M12 19v4" /><path d="M8 23h8" /></svg>,
    spelling: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h16a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
    quiz: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>,
    translate: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v8a2 2 0 002 2h6" /><path d="M2 12h6" /><path d="M18 18l3-3-3-3" /><path d="M21 15h-6a2 2 0 00-2 2v0" /></svg>,
    match: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M4 7h6M4 17h6M14 7h6M14 17h6" /><path d="M7 4v6M17 14v6" /></svg>,
    words: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>,
    sentences: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>,
    favorites: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>,
    stats: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M3 3v18h18" /><path d="M7 16l4-4 4 4 6-6" /></svg>,
    settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
  };
  return icons[name] ?? null;
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  wordOnly?: boolean;
  section?: 'main' | 'practice' | 'other';
}

const NAV: NavItem[] = [
  { to: '/today', label: '学习', icon: 'home', section: 'main' },
  { to: '/review', label: '复习', icon: 'review', wordOnly: true, section: 'practice' },
  { to: '/dictation', label: '听写', icon: 'dictation', wordOnly: true, section: 'practice' },
  { to: '/quiz', label: '选择', icon: 'quiz', wordOnly: true, section: 'practice' },
  { to: '/translate', label: '互译', icon: 'translate', wordOnly: true, section: 'practice' },
  { to: '/match', label: '配对', icon: 'match', wordOnly: true, section: 'practice' },
  { to: '/words', label: '词库', icon: 'words', section: 'main' },
  { to: '/sentences', label: '句子', icon: 'sentences', section: 'main' },
  { to: '/favorites', label: '生词本', icon: 'favorites', wordOnly: true, section: 'other' },
  { to: '/stats', label: '统计', icon: 'stats', section: 'other' },
  { to: '/settings', label: '设置', icon: 'settings', section: 'other' },
];

/** 过滤导航项 */
function useFilteredNav() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  return NAV.filter((item) => {
    if (item.to === '/sentences' && bookMeta?.kind === 'word') return false;
    if (item.to === '/words' && bookMeta?.kind === 'sentence') return false;
    if ('wordOnly' in item && item.wordOnly && bookMeta?.kind === 'sentence') return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* 桌面端侧边栏                                                        */
/* ------------------------------------------------------------------ */

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  const items = useFilteredNav();
  const username = useAuthStore((s) => s.user?.username);

  const sections: Array<{ label: string; items: NavItem[] }> = [
    { label: '主菜单', items: items.filter((i) => i.section === 'main') },
    { label: '练习', items: items.filter((i) => i.section === 'practice') },
    { label: '其他', items: items.filter((i) => i.section === 'other') },
  ].filter((s) => s.items.length > 0);

  return (
    <aside
      className={clsx(
        'hidden md:flex h-full bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex-col transition-all',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h1 className={clsx('font-bold text-brand-600', collapsed ? 'text-center text-sm' : 'text-xl')}>
          {collapsed ? '涓' : '涓词 VocabFlow'}
        </h1>
        {!collapsed && bookMeta && (
          <p className="text-xs text-slate-400 mt-0.5 truncate">{bookMeta.title}</p>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-3">
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="px-3 mb-1 text-xs font-medium text-slate-400 uppercase tracking-wide">
                {section.label}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/today'}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg transition',
                      isActive
                        ? 'bg-brand-50 dark:bg-brand-700/20 text-brand-700 dark:text-brand-300'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300',
                      collapsed && 'justify-center',
                    )
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <Icon name={item.icon} className="w-5 h-5 flex-shrink-0" />
                  {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      {/* 用户信息 */}
      {username && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-700">
          <NavLink
            to="/settings"
            className={clsx(
              'flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 transition',
              collapsed && 'justify-center',
            )}
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
              {username.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{username}</span>
            )}
          </NavLink>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* 移动端底部导航栏                                                    */
/* ------------------------------------------------------------------ */

export function BottomNav() {
  const items = useFilteredNav();

  // 移动端只显示核心导航项
  const mobileItems = items.filter((item) =>
    ['/today', '/review', '/words', '/sentences', '/favorites', '/stats', '/settings'].includes(item.to),
  );

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 safe-area-pb">
      <div className="flex items-stretch justify-around h-14">
        {mobileItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/today'}
            className={({ isActive }) =>
              clsx(
                'flex flex-col items-center justify-center gap-0.5 flex-1 transition',
                isActive
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-slate-400 dark:text-slate-500',
              )
            }
          >
            <Icon name={item.icon} className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
