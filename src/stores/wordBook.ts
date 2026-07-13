/** 当前选中的词书 (通过后端 API 持久化) */

import { create } from 'zustand';
import { userApi } from '@/api/client';

interface WordBookState {
  activeBookId: string | null;
  hasSelectedBook: boolean;
  loading: boolean;
  /** 从后端加载活跃词书 */
  init: () => Promise<void>;
  setBook: (bookId: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useWordBookStore = create<WordBookState>((set) => ({
  activeBookId: null,
  hasSelectedBook: false,
  loading: true,

  init: async () => {
    try {
      const { bookId } = await userApi.getActiveBook();
      set({
        activeBookId: bookId,
        hasSelectedBook: bookId != null,
        loading: false,
      });
    } catch (e) {
      console.error('[wordBook] init failed', e);
      set({ loading: false });
    }
  },

  setBook: async (bookId) => {
    set({ activeBookId: bookId, hasSelectedBook: true });
    try {
      await userApi.setActiveBook(bookId);
    } catch (e) {
      console.error('[wordBook] setBook failed', e);
    }
  },

  clear: async () => {
    set({ activeBookId: null, hasSelectedBook: false });
    try {
      await userApi.clearActiveBook();
    } catch (e) {
      console.error('[wordBook] clear failed', e);
    }
  },
}));
