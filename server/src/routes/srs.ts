/**
 * SRS 路由
 */

import { Router } from 'express';
import {
  loadAllCards,
  reviewAndPersist,
  loadReviewLogs,
  undoReview,
  clearAllSrs,
  getBookStats,
  getTodayProgress,
} from '../srs.js';

export const srsRouter = Router();

/** 获取全部卡片 */
srsRouter.get('/cards', async (_req, res) => {
  try {
    const cards = await loadAllCards();
    res.json(cards);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 评分 */
srsRouter.post('/review', async (req, res) => {
  try {
    const { wordId, bookId, grade } = req.body as {
      wordId: string;
      bookId: string;
      grade: number;
    };
    const card = await reviewAndPersist(wordId, bookId, grade);
    res.json(card);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 获取复习日志 */
srsRouter.get('/logs', async (_req, res) => {
  try {
    const logs = await loadReviewLogs();
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 撤销 */
srsRouter.post('/undo/:wordId', async (req, res) => {
  try {
    await undoReview(req.params.wordId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 清除所有 SRS 数据 */
srsRouter.delete('/all', async (_req, res) => {
  try {
    await clearAllSrs();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 词书统计 */
srsRouter.get('/stats/:bookId', async (req, res) => {
  try {
    const stats = await getBookStats(req.params.bookId);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 今日进度 */
srsRouter.get('/today/:bookId', async (req, res) => {
  try {
    const newLimit = Number(req.query.newLimit) || 20;
    const progress = await getTodayProgress(req.params.bookId, newLimit);
    res.json(progress);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
