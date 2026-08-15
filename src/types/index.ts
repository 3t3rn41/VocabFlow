/** VocabFlow 新类型系统 — 纯本地数据，无外部 API 依赖 */

/* ------------------------------------------------------------------ */
/* 词书类型                                                             */
/* ------------------------------------------------------------------ */

export type BookKind = 'word' | 'sentence';

export interface WordBookMeta {
  id: string;
  title: string;
  description: string;
  kind: BookKind;
  total: number;
}

/* ------------------------------------------------------------------ */
/* 单词条目                                                             */
/* ------------------------------------------------------------------ */

export interface WordEntry {
  id: string;
  word: string;
  meaning_cn: string;
  phonetic?: string;
  pos?: string;
  example?: string;
  example_cn?: string;
  bookId: string;
}

/* ------------------------------------------------------------------ */
/* 句子练习                                                             */
/* ------------------------------------------------------------------ */

export interface SentenceDialogue {
  cn: string;
  en: string;
}

export interface SentenceTopic {
  topic: string;
  dialogues: SentenceDialogue[];
}

export interface SentenceBand {
  band: number;
  level: string;
  topics: SentenceTopic[];
}

export interface SentenceBook {
  id: string;
  title: string;
  description: string;
  bands: SentenceBand[];
}

/* ------------------------------------------------------------------ */
/* SRS 相关                                                             */
/* ------------------------------------------------------------------ */

export enum Grade {
  Again = 0,
  Hard = 1,
  Good = 2,
  Easy = 3,
}

export const GRADE_LABELS: Record<Grade, { key: string; label: string; hint: string }> = {
  [Grade.Again]: { key: '1', label: '忘记', hint: '完全没想起来' },
  [Grade.Hard]: { key: '2', label: '模糊', hint: '勉强想起' },
  [Grade.Good]: { key: '3', label: '认识', hint: '正常想起' },
  [Grade.Easy]: { key: '4', label: '熟知', hint: '非常轻松' },
};

/** 持久化的 SRS 卡片状态 */
export interface StoredCard {
  wordId: string;
  bookId: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  state: number; // 0 NEW 1 LEARNING 2 REVIEW 3 RELEARNING
  due: string;   // ISO date
  reps: number;
  lapses: number;
  lastGrade: number | null;
  updatedAt: string;
}

/** 复习日志 */
export interface ReviewLog {
  wordId: string;
  bookId: string;
  reviewedAt: string;
  grade: number;
}

/* ------------------------------------------------------------------ */
/* 复习队列                                                             */
/* ------------------------------------------------------------------ */

export interface ReviewItem {
  wordId: string;
  word: string;
  meaning_cn: string;
  phonetic?: string;
  pos?: string;
  example?: string;
  example_cn?: string;
  bookId: string;
  isNew: boolean;
}

/** 今日学习进度 */
export interface TodayProgress {
  dueCount: number;
  newCount: number;
  finishedToday: number;
  totalToday: number;
}
