/** 应用配置 (通过后端 API 持久化) */

import { create } from 'zustand';
import { userApi, type RemoteSettings } from '@/api/client';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoPlayAudio: boolean;
  srsRetention: number;       // FSRS 目标保留率 0-1
  keyboardLayout: '3key' | '4key';
  shuffleWords: boolean;      // 单词模式下是否打乱顺序
}

const DEFAULTS: AppSettings = {
  theme: 'system',
  autoPlayAudio: true,
  srsRetention: 0.9,
  keyboardLayout: '3key',
  shuffleWords: false,
};

interface SettingsState extends AppSettings {
  loading: boolean;
  /** 从后端加载设置 */
  init: () => Promise<void>;
  patch: (p: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loading: true,

  init: async () => {
    try {
      const remote = await userApi.getSettings();
      const merged: AppSettings = {
        theme: (remote.theme as AppSettings['theme']) ?? DEFAULTS.theme,
        autoPlayAudio: remote.autoPlayAudio ?? DEFAULTS.autoPlayAudio,
        srsRetention: remote.srsRetention ?? DEFAULTS.srsRetention,
        keyboardLayout: (remote.keyboardLayout as AppSettings['keyboardLayout']) ?? DEFAULTS.keyboardLayout,
        shuffleWords: remote.shuffleWords ?? DEFAULTS.shuffleWords,
      };
      set({ ...merged, loading: false });
    } catch (e) {
      console.error('[settings] init failed', e);
      set({ loading: false });
    }
  },

  patch: (p) => {
    set((s) => ({ ...s, ...p }));
    // 异步保存到后端（不阻塞 UI）
    const current = { ...get() };
    const remote: RemoteSettings = {
      theme: current.theme,
      autoPlayAudio: current.autoPlayAudio,
      srsRetention: current.srsRetention,
      keyboardLayout: current.keyboardLayout,
      shuffleWords: current.shuffleWords,
    };
    userApi.saveSettings(remote).catch((e) => {
      console.error('[settings] save failed', e);
    });
  },
}));
