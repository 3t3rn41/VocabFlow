import { NavLink } from 'react-router-dom';
import { useUiStore } from '@/stores/ui';
import { useWordBookStore } from '@/stores/wordBook';
import { getBookMeta } from '@/data/wordbooks';
import { clsx } from 'clsx';

const NAV = [
  { to: '/today', label: '学习', icon: '📖' },
  { to: '/words', label: '词库', icon: '📚' },
  { to: '/sentences', label: '句子', icon: '💬' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;

  return (
    <aside
      className={clsx(
        'h-full bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col transition-all',
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
        {NAV.filter((item) => {
          // 单词模式下不显示句子 tab，句子模式下不显示词库 tab
          if (item.to === '/sentences' && bookMeta?.kind === 'word') return false;
          if (item.to === '/words' && bookMeta?.kind === 'sentence') return false;
          return true;
        }).map((item) => (
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
    </aside>
  );
}
