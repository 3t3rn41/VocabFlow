import { useUiStore } from '@/stores/ui';
import { useSettingsStore } from '@/stores/settings';

export function Topbar() {
  const toggle = useUiStore((s) => s.toggleSidebar);
  const theme = useSettingsStore((s) => s.theme);

  return (
    <header className="h-14 px-6 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <button
        onClick={toggle}
        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        ☰
      </button>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">
          {theme === 'dark' ? '🌙' : '☀️'}
        </span>
      </div>
    </header>
  );
}
