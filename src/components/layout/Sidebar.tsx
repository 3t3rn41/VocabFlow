import { NavLink } from 'react-router-dom';
import { useUiStore } from '@/stores/ui';
import { useWordBookStore } from '@/stores/wordBook';
import { useAuthStore } from '@/stores/auth';
import { getBookMeta } from '@/data/wordbooks';
import { clsx } from 'clsx';

const NAV = [
  { to: '/today', label: '学习', icon: '📖' },
  { to: '/review', label: '复习', icon: '🔄', wordOnly: true },
  { to: '/dictation', label: '听写', icon: '📝', wordOnly: true },
  { to: '/words', label: '词库', icon: '📚' },
  { to: '/sentences', label: '句子', icon: '💬' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

/** 过滤导航项：单词模式下不显示句子 tab，句子模式下不显示词库/复习/听写 tab */
function useFilteredNav() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  return NAV.filter((item) => {
    if (item.to === '/sentences' && bookMeta?.kind === 'word') return false;
    if (item.to === '/words' && bookMeta?.kind === 'sentence') return false;
    // wordOnly 的项仅在单词模式下显示
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

  return (
    <aside
      className={clsx(
        'hidden md:flex h-full bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex-col transition-all',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h1 className={clsx('font-bold text-brand-600', collapsed ? 'text-center text-sm' : 'text-xl')}>
          {collapsed ? 'VF' : 'VocabFlow'}
        </h1>
        {!collapsed && bookMeta && (
          <p className="text-xs text-slate-400 mt-0.5 truncate">📖 {bookMeta.title}</p>
        )}
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {items.map((item) => (
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
              )
            }
          >
            <span className="text-lg">{item.icon}</span>
            {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
          </NavLink>
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

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 safe-area-pb">
      <div className="flex items-stretch justify-around h-14">
        {items.map((item) => (
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
            <span className="text-xl leading-none">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
