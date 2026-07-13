import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAppData } from '@/hooks/useAppData';
import { Spinner } from '@/components/ui/Spinner';

export function AppLayout() {
  const { ready } = useAppData();

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-slate-500">正在初始化...</span>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
