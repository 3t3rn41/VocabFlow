/** 用户认证状态管理 */

import { create } from 'zustand';
import {
  authApi,
  setToken,
  clearToken,
  getToken,
  onUnauthorized,
  type AuthUser,
} from '@/api/client';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** 是否已登录 */
  isAuthenticated: boolean;

  /** 初始化: 检查本地 token 是否有效 */
  init: () => Promise<void>;
  /** 登录 */
  login: (username: string, password: string) => Promise<void>;
  /** 注册 */
  register: (username: string, password: string) => Promise<void>;
  /** 登出 */
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // 注册 401 回调: token 过期时自动登出
  onUnauthorized(() => {
    set({ user: null, isAuthenticated: false });
  });

  return {
    user: null,
    loading: true,
    isAuthenticated: false,

    init: async () => {
      const token = getToken();
      if (!token) {
        set({ loading: false, isAuthenticated: false, user: null });
        return;
      }

      try {
        const { user } = await authApi.me();
        set({ user, isAuthenticated: true, loading: false });
      } catch {
        clearToken();
        set({ user: null, isAuthenticated: false, loading: false });
      }
    },

    login: async (username, password) => {
      const { token, user } = await authApi.login(username, password);
      setToken(token);
      set({ user, isAuthenticated: true });
    },

    register: async (username, password) => {
      const { token, user } = await authApi.register(username, password);
      setToken(token);
      set({ user, isAuthenticated: true });
    },

    logout: () => {
      clearToken();
      set({ user: null, isAuthenticated: false });
    },
  };
});
