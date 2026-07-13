/**
 * 后端 API 客户端
 *
 * 所有数据持久化操作通过 HTTP 请求发送到 Express + MySQL 后端。
 * Vite dev server 通过 /api 代理转发到 http://localhost:3001。
 */

import type { StoredCard, ReviewLog } from '@/types';

const API_BASE = '/api';

/* ------------------------------------------------------------------ */
/* 通用请求封装                                                         */
/* ------------------------------------------------------------------ */

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/* SRS API                                                             */
/* ------------------------------------------------------------------ */

export const srsApi = {
  /** 获取全部卡片 */
  getAllCards: () => apiGet<Record<string, StoredCard>>('/srs/cards'),

  /** 评分 */
  review: (wordId: string, bookId: string, grade: number) =>
    apiPost<StoredCard>('/srs/review', { wordId, bookId, grade }),

  /** 获取复习日志 */
  getLogs: () => apiGet<ReviewLog[]>('/srs/logs'),

  /** 撤销 */
  undo: (wordId: string) => apiPost<{ ok: boolean }>(`/srs/undo/${wordId}`),

  /** 清除所有 SRS 数据 */
  clearAll: () => apiDelete<{ ok: boolean }>('/srs/all'),

  /** 词书统计 */
  getStats: (bookId: string) =>
    apiGet<{ total: number; learned: number; due: number }>(`/srs/stats/${bookId}`),

  /** 今日进度 */
  getTodayProgress: (bookId: string) =>
    apiGet<{ dueCount: number; newCount: number; finishedToday: number }>(
      `/srs/today/${bookId}`,
    ),
};

/* ------------------------------------------------------------------ */
/* 句子练习 API                                                        */
/* ------------------------------------------------------------------ */

export type SentenceProgress = Record<string, number[]>;

export interface SentencePosition {
  band: number;
  topicIdx: number;
  dialogueIdx: number;
}

export interface SentenceMasteryDetail {
  band: number;
  topicIdx: number;
  dialogueIdx: number;
  source: string;
  proficiency: number;
  pauseMs: number;
  tabCount: number;
  typoCount: number;
}

export interface SentenceMasteryResult {
  mastery: Record<string, number[]>;
  details: SentenceMasteryDetail[];
}

export interface SentenceStats {
  learnedSentences: number;
  totalPractices: number;
  streakDays: number;
  practicedToday: number;
  avgProficiency: number;
}

export interface SentenceProficiencyDaily {
  date: string;
  avgProficiency: number;
  count: number;
}

export interface SentenceProficiencyRecord {
  id: number;
  band: number;
  topicIdx: number;
  dialogueIdx: number;
  proficiency: number;
  pauseMs: number;
  tabCount: number;
  typoCount: number;
  practicedAt: string;
}

export interface SentenceProficiencyHistory {
  daily: SentenceProficiencyDaily[];
  recent: SentenceProficiencyRecord[];
}

export const sentenceApi = {
  /** 加载句子完成进度 */
  getProgress: () => apiGet<SentenceProgress>('/sentences/progress'),

  /** 标记句子完成 */
  markComplete: (band: number, topicIdx: number, dialogueIdx: number) =>
    apiPost<{ ok: boolean }>('/sentences/complete', { band, topicIdx, dialogueIdx }),

  /** 加载下一个未完成句子位置 (传入 band/topic/dialogue 结构) */
  getPosition: (structure?: Array<{ band: number; topics: number[] }>) =>
    apiGet<SentencePosition | null>(
      structure
        ? `/sentences/position?structure=${encodeURIComponent(JSON.stringify(structure))}`
        : '/sentences/position',
    ),

  /** 保存当前位置 */
  savePosition: (pos: SentencePosition) =>
    apiPost<{ ok: boolean }>('/sentences/position', pos),

  /** 加载所有熟知标记 */
  getMastery: () => apiGet<SentenceMasteryResult>('/sentences/mastery'),

  /** 标记句子为熟知 (含熟练度数据) */
  markMastery: (params: {
    band: number;
    topicIdx: number;
    dialogueIdx: number;
    source?: 'manual' | 'auto';
    proficiency?: number;
    pauseMs?: number;
    tabCount?: number;
    typoCount?: number;
  }) => apiPost<{ ok: boolean }>('/sentences/mastery', params),

  /** 取消句子熟知标记 */
  unmarkMastery: (band: number, topicIdx: number, dialogueIdx: number) =>
    apiDelete<{ ok: boolean }>('/sentences/mastery', { band, topicIdx, dialogueIdx }),

  /** 清除某 band 的所有熟知标记 */
  clearBandMastery: (band: number) =>
    apiDelete<{ ok: boolean }>(`/sentences/mastery/band/${band}`),

  /** 记录一次句子练习 (含熟练度数据) */
  logPractice: (params: {
    band: number;
    topicIdx: number;
    dialogueIdx: number;
    proficiency?: number;
    pauseMs?: number;
    tabCount?: number;
    typoCount?: number;
  }) => apiPost<{ ok: boolean }>('/sentences/log', params),

  /** 获取句子练习统计 */
  getStats: () => apiGet<SentenceStats>('/sentences/stats'),

  /** 获取熟练度历史 */
  getProficiencyHistory: () =>
    apiGet<SentenceProficiencyHistory>('/sentences/proficiency-history'),
};

/* ------------------------------------------------------------------ */
/* 用户设置 & 活跃词书 API                                             */
/* ------------------------------------------------------------------ */

export interface RemoteSettings {
  theme?: string;
  autoPlayAudio?: boolean;
  srsRetention?: number;
  keyboardLayout?: string;
  shuffleWords?: boolean;
  ttsApiKey?: string;
}

export const userApi = {
  /** 加载设置 */
  getSettings: () => apiGet<RemoteSettings>('/user/settings'),

  /** 保存设置 */
  saveSettings: (settings: RemoteSettings) =>
    apiPut<{ ok: boolean }>('/user/settings', settings),

  /** 获取活跃词书 */
  getActiveBook: () => apiGet<{ bookId: string | null }>('/user/active-book'),

  /** 设置活跃词书 */
  setActiveBook: (bookId: string) =>
    apiPut<{ ok: boolean }>('/user/active-book', { bookId }),

  /** 清除活跃词书 */
  clearActiveBook: () => apiDelete<{ ok: boolean }>('/user/active-book'),
};
