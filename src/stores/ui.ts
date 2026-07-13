/** UI 状态 (侧边栏折叠、Toast 等) */

import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface UIState {
  sidebarCollapsed: boolean;
  toasts: Toast[];
  toggleSidebar: () => void;
  pushToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
}

let _toastSeq = 0;

export const useUiStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  toasts: [],

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  pushToast: (message, type = 'info') => {
    const id = `t${++_toastSeq}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
