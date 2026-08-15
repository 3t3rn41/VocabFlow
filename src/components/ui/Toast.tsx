import { useUiStore } from '@/stores/ui';
import { clsx } from 'clsx';

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const remove = useUiStore((s) => s.removeToast);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 z-50 flex flex-col gap-2 md:max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'px-4 py-3 rounded-lg shadow-lg border cursor-pointer transition animate-toastIn',
            'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
            { 'border-l-4 border-l-green-500': t.type === 'success' },
            { 'border-l-4 border-l-red-500': t.type === 'error' },
          )}
          onClick={() => remove(t.id)}
        >
          <p className="text-sm">{t.message}</p>
        </div>
      ))}
    </div>
  );
}
