/**
 * 后端 API 客户端
 *
 * 所有数据持久化操作通过 HTTP 请求发送到 Express + MySQL 后端。
 * Vite dev server 通过 /api 代理转发到 http://localhost:3001。
 * Tauri 桌面端通过 get_api_base 命令获取后端地址。
 * 所有请求自动携带 JWT Token（如已登录）。
 */

import type { StoredCard, ReviewLog } from '@/types';

/**
 * 检测当前是否运行在 Tauri 桌面端环境
 *
 * Tauri 生产模式下页面 URL 为 http(s)://tauri.localhost/...
 * 或 tauri://localhost/...
 * 同时 window.__TAURI_INTERNALS__ 会被注入
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  // 方式1：检查 Tauri 内部对象
  if ('__TAURI_INTERNALS__' in window) return true;
  // 方式2：检查 URL 协议/host（更可靠）
  const host = window.location?.hostname ?? '';
  const proto = window.location?.protocol ?? '';
  return host === 'tauri.localhost' || proto === 'tauri:';
}

/** 桌面端后端地址缓存 */
let _desktopApiBase = 'http://localhost:3001';

/** 初始化桌面端 API 地址（从 Tauri 命令获取） */
export async function initDesktopApiBase(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ url: string }>('get_api_base');
    if (result?.url) _desktopApiBase = result.url.replace(/\/$/, '');
  } catch (e) {
    console.warn('[api] 获取桌面端 API 地址失败，使用默认值:', e);
  }
}

/** 获取 API 基础路径（桌面端动态，Web 端固定 /api） */
export function getApiBase(): string {
  return isTauri() ? `${_desktopApiBase}/api` : '/api';
}

const TOKEN_KEY = 'vocabflow_token';

/* ------------------------------------------------------------------ */
/* Token 管理                                                          */
/* ------------------------------------------------------------------ */

/** 获取本地存储的 JWT Token */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** 保存 JWT Token */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** 清除 JWT Token */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/* ------------------------------------------------------------------ */
/* 通用请求封装                                                         */
/* ------------------------------------------------------------------ */

/** 401 回调 — 当 token 过期或无效时触发 */
let _onUnauthorized: (() => void) | null = null;

/** 注册 401 回调 (由 auth store 设置) */
export function onUnauthorized(cb: () => void): void {
  _onUnauthorized = cb;
}

/** 构建请求头，自动附加 Authorization */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** 统一错误处理：401 时清除 token 并触发回调 */
function handleUnauthorized(status: number): void {
  if (status === 401) {
    clearToken();
    _onUnauthorized?.();
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    handleUnauthorized(res.status);
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    handleUnauthorized(res.status);
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    handleUnauthorized(res.status);
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'DELETE',
    headers: authHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    handleUnauthorized(res.status);
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/* 认证 API                                                            */
/* ------------------------------------------------------------------ */

export interface AuthUser {
  id: number;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export const authApi = {
  /** 注册 */
  register: (username: string, password: string) =>
    apiPost<AuthResponse>('/auth/register', { username, password }),

  /** 登录 */
  login: (username: string, password: string) =>
    apiPost<AuthResponse>('/auth/login', { username, password }),

  /** 获取当前用户信息 */
  me: () => apiGet<{ user: AuthUser }>('/auth/me'),

  /** 修改密码 */
  changePassword: (currentPassword: string, newPassword: string) =>
    apiPost<{ ok: boolean }>('/auth/change-password', { currentPassword, newPassword }),
};

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
  cardTheme?: string;
  dailyNewGoal?: number;
  dailyReviewGoal?: number;
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
