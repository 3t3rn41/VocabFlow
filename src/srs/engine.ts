/**
 * FSRS-4.5 SRS 引擎 — 前端薄层
 *
 * SRS 计算逻辑在后端 (server/src/srs.ts) 使用 ts-fsrs 完成，
 * 本文件仅负责调用后端 API 和在本地内存中缓存词库数据。
 */

import type { Grade, StoredCard, ReviewLog, ReviewItem } from '@/types';
import { getWordsByBook } from '@/data/wordbooks';
import { srsApi } from '@/api/client';

/* ------------------------------------------------------------------ */
/* FSRS 引擎 (仅用于 review queue 排序时的本地计算)                     */
/* ------------------------------------------------------------------ */

/** 当设置中保留率变化时调用（前端无需操作，后端固定 0.9） */
export function rebuildFsrs(): void {
  // 后端使用固定保留率 0.9，此处保留兼容性
}

/* ------------------------------------------------------------------ */
/* 卡片存取（通过后端 API）                                             */
/* ------------------------------------------------------------------ */

/** 读取全部卡片状态 */
export async function loadAllCards(): Promise<Record<string, StoredCard>> {
  return srsApi.getAllCards();
}

/** 读取某词的卡片 */
export async function loadCard(wordId: string): Promise<StoredCard | null> {
  const all = await loadAllCards();
  return all[wordId] ?? null;
}

/* ------------------------------------------------------------------ */
/* 评分                                                                */
/* ------------------------------------------------------------------ */

/**
 * 给一张卡片评分 — 调用后端 API 更新 SRS 状态并记录日志。
 * 返回更新后的 StoredCard。
 */
export async function reviewAndPersist(
  wordId: string,
  bookId: string,
  grade: Grade,
): Promise<StoredCard> {
  return srsApi.review(wordId, bookId, grade);
}

/* ------------------------------------------------------------------ */
/* 复习日志                                                            */
/* ------------------------------------------------------------------ */

/** 读取全部复习日志 */
export async function loadReviewLogs(): Promise<ReviewLog[]> {
  return srsApi.getLogs();
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

/** Fisher-Yates 洗牌算法 */
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* 复习队列生成（本地逻辑，使用后端卡片数据）                           */
/* ------------------------------------------------------------------ */

/**
 * 生成今日复习队列。
 *
 * 策略:
 *   1. 从后端获取该词书所有已存在的卡片，筛出 due <= now 的到期卡片
 *   2. 对没有卡片的单词（新词），全部加入队列
 *   3. 合并后返回
 */
export async function generateReviewQueue(
  bookId: string,
  reviewLimit: number = 200,
  shuffle: boolean = false,
): Promise<ReviewItem[]> {
  const words = getWordsByBook(bookId);
  if (!words.length) return [];

  const allCards = await loadAllCards();
  const now = new Date();

  const dueItems: ReviewItem[] = [];
  const newItems: ReviewItem[] = [];

  for (const w of words) {
    const card = allCards[w.id];
    if (card) {
      const dueDate = new Date(card.due);
      if (dueDate <= now) {
        dueItems.push({
          wordId: w.id,
          word: w.word,
          meaning_cn: w.meaning_cn,
          phonetic: w.phonetic,
          pos: w.pos,
          example: w.example,
          example_cn: w.example_cn,
          bookId: w.bookId,
          isNew: false,
        });
      }
    } else {
      newItems.push({
        wordId: w.id,
        word: w.word,
        meaning_cn: w.meaning_cn,
        phonetic: w.phonetic,
        pos: w.pos,
        example: w.example,
        example_cn: w.example_cn,
        bookId: w.bookId,
        isNew: true,
      });
    }
  }

  // 到期卡片按 due 排序
  dueItems.sort((a, b) => {
    const da = new Date(allCards[a.wordId].due).getTime();
    const db = new Date(allCards[b.wordId].due).getTime();
    return da - db;
  });

  const limitedDue = dueItems.slice(0, reviewLimit);

  // 可选：打乱新词顺序
  const finalNewItems = shuffle ? shuffleArray(newItems) : newItems;

  // 新词排在到期卡片之后（先复习旧的再学新的）
  return [...limitedDue, ...finalNewItems];
}

/**
 * 获取今日进度统计。
 */
export async function getTodayProgress(
  bookId: string,
): Promise<{ dueCount: number; newCount: number; finishedToday: number }> {
  const words = getWordsByBook(bookId);
  if (!words.length) return { dueCount: 0, newCount: 0, finishedToday: 0 };

  const allCards = await loadAllCards();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let dueCount = 0;
  let newCount = 0;

  for (const w of words) {
    const card = allCards[w.id];
    if (card) {
      if (new Date(card.due) <= now) dueCount++;
    } else {
      newCount++;
    }
  }

  // 今日已复习次数
  const logs = await loadReviewLogs();
  const finishedToday = logs.filter(
    (l) => l.bookId === bookId && l.reviewedAt.slice(0, 10) === todayStr,
  ).length;

  return {
    dueCount: Math.min(dueCount, 200),
    newCount,
    finishedToday,
  };
}

/* ------------------------------------------------------------------ */
/* 撤销支持                                                            */
/* ------------------------------------------------------------------ */

export async function undoReview(wordId: string): Promise<void> {
  await srsApi.undo(wordId);
}

/* ------------------------------------------------------------------ */
/* 清除所有 SRS 数据                                                    */
/* ------------------------------------------------------------------ */

export async function clearAllSrs(): Promise<void> {
  await srsApi.clearAll();
}

/* ------------------------------------------------------------------ */
/* 获取某词书的已学/总数统计                                            */
/* ------------------------------------------------------------------ */

export async function getBookStats(bookId: string): Promise<{
  total: number;
  learned: number;
  due: number;
}> {
  const words = getWordsByBook(bookId);
  const total = words.length;
  if (!total) return { total: 0, learned: 0, due: 0 };

  const allCards = await loadAllCards();
  const now = new Date();
  let learned = 0;
  let due = 0;

  for (const w of words) {
    const card = allCards[w.id];
    if (card) {
      learned++;
      if (new Date(card.due) <= now) due++;
    }
  }

  return { total, learned, due };
}
