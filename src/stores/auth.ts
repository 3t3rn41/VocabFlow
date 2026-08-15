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
  isAuthenticated: boolean;

  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
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
