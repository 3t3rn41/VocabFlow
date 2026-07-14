/**
 * SRS 引擎（服务端版）
 * 使用 ts-fsrs 在服务端计算卡片状态
 * 所有操作按用户隔离
 */

import {
  type Card,
  type RecordLogItem,
  createEmptyCard,
  fsrs,
  Rating,
} from 'ts-fsrs';
import { query, execute } from './db.js';

let _f: ReturnType<typeof fsrs> | null = null;

function getFsrs() {
  if (!_f) {
    _f = fsrs({
      request_retention: 0.9,
      enable_short_term: true,
      enable_fuzz: true,
      maximum_interval: 36500,
    });
  }
  return _f;
}

export interface StoredCard {
  wordId: string;
  bookId: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  state: number;
  due: string;
  reps: number;
  lapses: number;
  lastGrade: number | null;
  updatedAt: string;
}

export interface ReviewLog {
  id?: number;
  wordId: string;
  bookId: string;
  reviewedAt: string;
  grade: number;
}

/* ------------------------------------------------------------------ */

/** 将 ISO 字符串或 Date 转换为 MySQL DATETIME 格式 (YYYY-MM-DD HH:MM:SS) */
function toMySQLDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** 获取用户的所有卡片 */
export async function loadAllCards(userId: number): Promise<Record<string, StoredCard>> {
  const rows = await query<{
    word_id: string;
    book_id: string;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    state: number;
    due: Date;
    reps: number;
    lapses: number;
    last_grade: number | null;
    updated_at: Date;
  }>('SELECT word_id, book_id, stability, difficulty, elapsed_days, state, due, reps, lapses, last_grade, updated_at FROM srs_cards WHERE user_id = ?', [userId]);

  const result: Record<string, StoredCard> = {};
  for (const r of rows) {
    result[r.word_id] = {
      wordId: r.word_id,
      bookId: r.book_id,
      stability: r.stability,
      difficulty: r.difficulty,
      elapsedDays: r.elapsed_days,
      state: r.state,
      due: new Date(r.due).toISOString(),
      reps: r.reps,
      lapses: r.lapses,
      lastGrade: r.last_grade,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }
  return result;
}

/** 获取用户的单张卡片 */
export async function loadCard(userId: number, wordId: string): Promise<StoredCard | null> {
  const rows = await query<{
    word_id: string;
    book_id: string;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    state: number;
    due: Date;
    reps: number;
    lapses: number;
    last_grade: number | null;
    updated_at: Date;
  }>('SELECT word_id, book_id, stability, difficulty, elapsed_days, state, due, reps, lapses, last_grade, updated_at FROM srs_cards WHERE user_id = ? AND word_id = ?', [userId, wordId]);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    wordId: r.word_id,
    bookId: r.book_id,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsedDays: r.elapsed_days,
    state: r.state,
    due: new Date(r.due).toISOString(),
    reps: r.reps,
    lapses: r.lapses,
    lastGrade: r.last_grade,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function toStoredCard(
  wordId: string,
  bookId: string,
  card: Card,
  lastGrade: number | null,
): StoredCard {
  return {
    wordId,
    bookId,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    state: card.state,
    due: card.due.toISOString(),
    reps: card.reps,
    lapses: card.lapses,
    lastGrade: lastGrade ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function fromStoredCard(sc: StoredCard): Card {
  return {
    ...createEmptyCard(new Date()),
    stability: sc.stability,
    difficulty: sc.difficulty,
    reps: sc.reps,
    lapses: sc.lapses,
    state: sc.state as Card['state'],
    due: new Date(sc.due),
    last_review: sc.updatedAt ? new Date(sc.updatedAt) : null,
  } as Card;
}

function gradeToRating(grade: number): Rating {
  return (grade + 1) as Rating;
}

/** UPSERT 卡片到 MySQL (含 user_id) */
async function upsertCard(userId: number, card: StoredCard): Promise<void> {
  await execute(
    `INSERT INTO srs_cards (user_id, word_id, book_id, stability, difficulty, elapsed_days, state, due, reps, lapses, last_grade, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       book_id = VALUES(book_id),
       stability = VALUES(stability),
       difficulty = VALUES(difficulty),
       elapsed_days = VALUES(elapsed_days),
       state = VALUES(state),
       due = VALUES(due),
       reps = VALUES(reps),
       lapses = VALUES(lapses),
       last_grade = VALUES(last_grade),
       updated_at = VALUES(updated_at)`,
    [
      userId,
      card.wordId,
      card.bookId,
      card.stability,
      card.difficulty,
      card.elapsedDays,
      card.state,
      toMySQLDateTime(card.due),
      card.reps,
      card.lapses,
      card.lastGrade,
      toMySQLDateTime(card.updatedAt),
    ],
  );
}

/** 评分并持久化 */
export async function reviewAndPersist(
  userId: number,
  wordId: string,
  bookId: string,
  grade: number,
): Promise<StoredCard> {
  const existing = await loadCard(userId, wordId);
  const card: Card = existing ? fromStoredCard(existing) : createEmptyCard(new Date());
  const f = getFsrs();
  const preview = f.repeat(card, new Date());
  const rating = gradeToRating(grade);
  const log = (preview as unknown as Record<number, RecordLogItem>)[rating];
  const nextCard = log.card;

  const stored = toStoredCard(wordId, bookId, nextCard, grade);
  await upsertCard(userId, stored);

  // 记录日志
  await execute(
    `INSERT INTO review_logs (user_id, word_id, book_id, reviewed_at, grade) VALUES (?, ?, ?, ?, ?)`,
    [userId, wordId, bookId, toMySQLDateTime(new Date()), grade],
  );

  return stored;
}

/** 获取用户的所有复习日志 */
export async function loadReviewLogs(userId: number): Promise<ReviewLog[]> {
  const rows = await query<{
    id: number;
    word_id: string;
    book_id: string;
    reviewed_at: Date;
    grade: number;
  }>('SELECT id, word_id, book_id, reviewed_at, grade FROM review_logs WHERE user_id = ? ORDER BY reviewed_at ASC', [userId]);

  return rows.map((r) => ({
    id: r.id,
    wordId: r.word_id,
    bookId: r.book_id,
    reviewedAt: new Date(r.reviewed_at).toISOString(),
    grade: r.grade,
  }));
}

/** 撤销复习 */
export async function undoReview(userId: number, wordId: string): Promise<void> {
  const card = await loadCard(userId, wordId);
  if (!card) return;

  if (card.reps > 0) card.reps -= 1;
  card.due = new Date().toISOString();
  card.updatedAt = new Date().toISOString();
  await upsertCard(userId, card);

  // 删除最后一条该词的日志
  await execute(
    `DELETE FROM review_logs WHERE id = (
       SELECT id FROM (
         SELECT id FROM review_logs WHERE user_id = ? AND word_id = ? ORDER BY reviewed_at DESC LIMIT 1
       ) AS t
     )`,
    [userId, wordId],
  );
}

/** 清除用户的所有 SRS 数据 */
export async function clearAllSrs(userId: number): Promise<void> {
  await execute('DELETE FROM srs_cards WHERE user_id = ?', [userId]);
  await execute('DELETE FROM review_logs WHERE user_id = ?', [userId]);
}

/** 获取词书统计 (按用户) */
export async function getBookStats(userId: number, bookId: string): Promise<{
  total: number;
  learned: number;
  due: number;
}> {
  const learnedRows = await query<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM srs_cards WHERE user_id = ? AND book_id = ?',
    [userId, bookId],
  );
  const dueRows = await query<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM srs_cards WHERE user_id = ? AND book_id = ? AND due <= UTC_TIMESTAMP()',
    [userId, bookId],
  );

  // total 需要前端提供（因为词库数据来自 JSON）
  return {
    total: 0, // 前端会补充
    learned: learnedRows[0]?.cnt ?? 0,
    due: dueRows[0]?.cnt ?? 0,
  };
}

/** 获取今日进度 (按用户) */
export async function getTodayProgress(
  userId: number,
  bookId: string,
  newLimit: number = 20,
): Promise<{ dueCount: number; newCount: number; finishedToday: number }> {
  const dueRows = await query<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM srs_cards WHERE user_id = ? AND book_id = ? AND due <= UTC_TIMESTAMP()',
    [userId, bookId],
  );
  const todayRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM review_logs
     WHERE user_id = ? AND book_id = ? AND DATE(reviewed_at) = UTC_DATE()`,
    [userId, bookId],
  );

  const dueCount = Math.min(dueRows[0]?.cnt ?? 0, 200);

  return {
    dueCount,
    newCount: newLimit, // 前端会根据总词数和已学数计算实际新词数
    finishedToday: todayRows[0]?.cnt ?? 0,
  };
}
