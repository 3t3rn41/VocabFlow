/**
 * SRS 路由
 * 所有操作需认证，按用户隔离数据
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
import { requireAuth } from '../middleware/auth.js';

export const srsRouter = Router();

/** 获取全部卡片 */
srsRouter.get('/cards', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const cards = await loadAllCards(userId);
    res.json(cards);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 评分 */
srsRouter.post('/review', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { wordId, bookId, grade } = req.body as {
      wordId: string;
      bookId: string;
      grade: number;
    };
    const card = await reviewAndPersist(userId, wordId, bookId, grade);
    res.json(card);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 获取复习日志 */
srsRouter.get('/logs', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const logs = await loadReviewLogs(userId);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 撤销 */
srsRouter.post('/undo/:wordId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    await undoReview(userId, req.params.wordId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 清除所有 SRS 数据 */
srsRouter.delete('/all', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    await clearAllSrs(userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 词书统计 */
srsRouter.get('/stats/:bookId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const stats = await getBookStats(userId, req.params.bookId);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 今日进度 */
srsRouter.get('/today/:bookId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const newLimit = Number(req.query.newLimit) || 20;
    const progress = await getTodayProgress(userId, req.params.bookId, newLimit);
    res.json(progress);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
