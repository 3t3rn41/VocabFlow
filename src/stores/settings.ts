/** 应用配置 (通过数据层持久化：完整版用后端 API，静态版用 localStorage) */

import { create } from 'zustand';
import { userApi, type RemoteSettings } from '@/api/client';

export type CardTheme = 'default' | 'green' | 'parchment' | 'minimal';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoPlayAudio: boolean;
  srsRetention: number;       // FSRS 目标保留率 0-1
  keyboardLayout: '3key' | '4key';
  shuffleWords: boolean;      // 单词模式下是否打乱顺序
  // 卡片皮肤 (2.5.1)
  cardTheme: CardTheme;
  // 学习计划与目标 (2.3.2)
  dailyNewGoal: number;       // 每日新词目标
  dailyReviewGoal: number;    // 每日复习目标
}

const DEFAULTS: AppSettings = {
  theme: 'system',
  autoPlayAudio: true,
  srsRetention: 0.9,
  keyboardLayout: '3key',
  shuffleWords: false,
  cardTheme: 'default',
  dailyNewGoal: 30,
  dailyReviewGoal: 50,
};

interface SettingsState extends AppSettings {
  loading: boolean;
  /** 从数据层加载设置 */
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
        cardTheme: (remote.cardTheme as CardTheme) ?? DEFAULTS.cardTheme,
        dailyNewGoal: remote.dailyNewGoal ?? DEFAULTS.dailyNewGoal,
        dailyReviewGoal: remote.dailyReviewGoal ?? DEFAULTS.dailyReviewGoal,
      };
      set({ ...merged, loading: false });
    } catch (e) {
      console.error('[settings] init failed', e);
      set({ loading: false });
    }
  },

  patch: (p) => {
    set((s) => ({ ...s, ...p }));
    // 卡片皮肤应用到 DOM
    if (p.cardTheme !== undefined) {
      applyCardTheme(p.cardTheme);
    }
    // 异步保存到数据层（不阻塞 UI）
    const current = { ...get() };
    const remote: RemoteSettings = {
      theme: current.theme,
      autoPlayAudio: current.autoPlayAudio,
      srsRetention: current.srsRetention,
      keyboardLayout: current.keyboardLayout,
      shuffleWords: current.shuffleWords,
      cardTheme: current.cardTheme,
      dailyNewGoal: current.dailyNewGoal,
      dailyReviewGoal: current.dailyReviewGoal,
    };
    userApi.saveSettings(remote).catch((e) => {
      console.error('[settings] save failed', e);
    });
  },
}));

/* ------------------------------------------------------------------ */
/* 卡片皮肤：通过 data-attribute 控制 CSS 变量                          */
/* ------------------------------------------------------------------ */

export function applyCardTheme(theme: CardTheme): void {
  document.documentElement.setAttribute('data-card-theme', theme);
}
