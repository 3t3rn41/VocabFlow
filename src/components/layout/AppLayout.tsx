import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, BottomNav } from './Sidebar';
import { Topbar } from './Topbar';
import { useAppData } from '@/hooks/useAppData';
import { Spinner } from '@/components/ui/Spinner';

export function AppLayout() {
  const { ready } = useAppData();
  const mainRef = useRef<HTMLDivElement>(null);

  // 移动端：监听 visualViewport 变化（键盘弹出/收起）
  // iOS Safari 键盘弹出时 dvh 不变，需要手动调整高度
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      const h = vv.height;
      if (mainRef.current) {
        mainRef.current.style.height = `${h}px`;
      }
    };

    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-slate-500">正在初始化...</span>
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden" style={{ height: '100dvh' }}>
      <Sidebar />
      <main ref={mainRef} className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <div className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
