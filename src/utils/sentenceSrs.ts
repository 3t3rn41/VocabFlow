/**
 * 句子 SRS 集成工具
 *
 * 将句子练习纳入 FSRS 调度系统。
 * 复用现有的 srs_cards / review_logs 表，
 * wordId 使用复合格式：srs-sentence:${band}:${topicIdx}:${dialogueIdx}
 * bookId 使用句子书的 ID（如 ielts-sentences / language-sense）
 */

import type { Grade, StoredCard } from '@/types';
import { srsApi, sentenceApi } from '@/api/client';
import type { SentenceBand } from '@/types';

/* ------------------------------------------------------------------ */
/* 复合 ID 编解码                                                      */
/* ------------------------------------------------------------------ */

export interface SentenceRef {
  band: number;
  topicIdx: number;
  dialogueIdx: number;
}

/** 生成句子的 SRS wordId */
export function makeSentenceSrsId(ref: SentenceRef): string {
  return `srs-sentence:${ref.band}:${ref.topicIdx}:${ref.dialogueIdx}`;
}

/** 解析 SRS wordId 为句子位置 */
export function parseSentenceSrsId(wordId: string): SentenceRef | null {
  const parts = wordId.split(':');
  if (parts.length !== 4 || parts[0] !== 'srs-sentence') return null;
  const band = parseInt(parts[1], 10);
  const topicIdx = parseInt(parts[2], 10);
  const dialogueIdx = parseInt(parts[3], 10);
  if (Number.isNaN(band) || Number.isNaN(topicIdx) || Number.isNaN(dialogueIdx)) return null;
  return { band, topicIdx, dialogueIdx };
}

/** 判断 wordId 是否为句子 SRS 卡片 */
export function isSentenceSrsId(wordId: string): boolean {
  return wordId.startsWith('srs-sentence:');
}

/* ------------------------------------------------------------------ */
/* 熟练度 → 评分映射                                                   */
/* ------------------------------------------------------------------ */

/** 将句子练习的熟练度 (0-100) 映射为 SRS Grade (0-3) */
export function proficiencyToGrade(proficiency: number): Grade {
  if (proficiency >= 85) return 3; // Easy
  if (proficiency >= 65) return 2; // Good
  if (proficiency >= 40) return 1; // Hard
  return 0; // Again
}

/* ------------------------------------------------------------------ */
/* 句子 SRS 评分                                                       */
/* ------------------------------------------------------------------ */

/** 对句子进行 SRS 评分（调用后端 API） */
export async function reviewSentence(
  bookId: string,
  ref: SentenceRef,
  grade: Grade,
): Promise<StoredCard> {
  return srsApi.review(makeSentenceSrsId(ref), bookId, grade);
}

/* ------------------------------------------------------------------ */
/* 句子复习队列生成                                                    */
/* ------------------------------------------------------------------ */

export interface SentenceReviewItem extends SentenceRef {
  due: string;        // ISO 到期时间
  stability: number;
  reps: number;
  lapses: number;
  /** 对应的英文句子 */
  en: string;
  /** 对应的中文句子 */
  cn: string;
  /** 话题名称 */
  topic: string;
  /** band level */
  level: string;
}

/**
 * 生成句子 SRS 复习队列。
 * 从后端获取该句子书的所有 SRS 卡片，筛出 due <= now 的到期卡片，
 * 并映射回句子内容。
 */
export async function generateSentenceReviewQueue(
  bookId: string,
  bands: SentenceBand[],
): Promise<SentenceReviewItem[]> {
  const allCards = await srsApi.getAllCards();
  const now = new Date();
  const dueItems: SentenceReviewItem[] = [];

  // 构建 band 查找表
  const bandMap = new Map<number, SentenceBand>();
  for (const b of bands) bandMap.set(b.band, b);

  for (const [wordId, card] of Object.entries(allCards)) {
    if (card.bookId !== bookId) continue;
    const ref = parseSentenceSrsId(wordId);
    if (!ref) continue;

    const dueDate = new Date(card.due);
    if (dueDate > now) continue;

    const band = bandMap.get(ref.band);
    if (!band) continue;
    if (ref.topicIdx >= band.topics.length) continue;
    const topic = band.topics[ref.topicIdx];
    if (ref.dialogueIdx >= topic.dialogues.length) continue;
    const dialogue = topic.dialogues[ref.dialogueIdx];

    dueItems.push({
      ...ref,
      due: card.due,
      stability: card.stability,
      reps: card.reps,
      lapses: card.lapses,
      en: dialogue.en,
      cn: dialogue.cn,
      topic: topic.topic,
      level: band.level,
    });
  }

  // 按 due 排序
  dueItems.sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());

  return dueItems;
}

/**
 * 获取句子 SRS 复习统计。
 */
export async function getSentenceSrsStats(
  bookId: string,
): Promise<{ dueCount: number; totalCards: number }> {
  const allCards = await srsApi.getAllCards();
  const now = new Date();

  let dueCount = 0;
  let totalCards = 0;

  for (const [wordId, card] of Object.entries(allCards)) {
    if (card.bookId !== bookId) continue;
    if (!isSentenceSrsId(wordId)) continue;
    totalCards++;
    if (new Date(card.due) <= now) dueCount++;
  }

  return { dueCount, totalCards };
}

/* ------------------------------------------------------------------ */
/* 已完成但未熟知 — 复习队列                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成"已完成但未熟知"句子的复习队列。
 * 遍历所有已完成的句子（sentenceApi.getProgress），
 * 排除已标记为熟知的（sentenceApi.getMastery），
 * 返回可复习的句子列表。
 */
export async function generateUnmasteredReviewQueue(
  bands: SentenceBand[],
): Promise<SentenceReviewItem[]> {
  const [progress, masteryResult] = await Promise.all([
    sentenceApi.getProgress(),
    sentenceApi.getMastery(),
  ]);

  const queue: SentenceReviewItem[] = [];

  // 构建 band 查找表
  const bandMap = new Map<number, SentenceBand>();
  for (const b of bands) bandMap.set(b.band, b);

  for (const [key, completedIndices] of Object.entries(progress)) {
    const parts = key.split(':');
    if (parts.length !== 2) continue;
    const band = parseInt(parts[0], 10);
    const topicIdx = parseInt(parts[1], 10);
    if (Number.isNaN(band) || Number.isNaN(topicIdx)) continue;

    const bandData = bandMap.get(band);
    if (!bandData || topicIdx >= bandData.topics.length) continue;
    const topic = bandData.topics[topicIdx];

    const masteredSet = new Set(masteryResult.mastery[key] ?? []);

    for (const dialogueIdx of completedIndices) {
      // 跳过已熟知的句子
      if (masteredSet.has(dialogueIdx)) continue;
      if (dialogueIdx >= topic.dialogues.length) continue;
      const dialogue = topic.dialogues[dialogueIdx];

      queue.push({
        band,
        topicIdx,
        dialogueIdx,
        due: '',
        stability: 0,
        reps: 0,
        lapses: 0,
        en: dialogue.en,
        cn: dialogue.cn,
        topic: topic.topic,
        level: bandData.level,
      });
    }
  }

  // 随机打乱，增加多样性
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  return queue;
}

/**
 * 获取"已完成但未熟知"句子的数量（轻量级，不需要 bands 数据）。
 */
export async function getUnmasteredReviewCount(): Promise<number> {
  const [progress, masteryResult] = await Promise.all([
    sentenceApi.getProgress(),
    sentenceApi.getMastery(),
  ]);

  let count = 0;
  for (const [key, completedIndices] of Object.entries(progress)) {
    const masteredSet = new Set(masteryResult.mastery[key] ?? []);
    for (const dialogueIdx of completedIndices) {
      if (!masteredSet.has(dialogueIdx)) count++;
    }
  }

  return count;
}
