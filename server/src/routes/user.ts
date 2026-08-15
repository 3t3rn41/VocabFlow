/**
 * 用户设置 & 活跃词书路由
 * 对应 user_settings / active_book 表
 * 所有操作需认证，按用户隔离数据
 */

import { Router } from 'express';
import { query, execute } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const userRouter = Router();

/* ------------------------------------------------------------------ */
/* 设置 (user_settings 表，按用户隔离)                                  */
/* ------------------------------------------------------------------ */

interface SettingsRow {
  theme: string;
  auto_play_audio: number;
  srs_retention: string;
  keyboard_layout: string;
  daily_new_limit: number;
  shuffle_words: number;
}

/** 加载设置 */
userRouter.get('/settings', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const rows = await query<SettingsRow>(
      'SELECT theme, auto_play_audio, srs_retention, keyboard_layout, daily_new_limit, shuffle_words FROM user_settings WHERE user_id = ?',
      [userId],
    );
    if (!rows.length) {
      // 新用户无设置记录，返回默认值
      res.json({
        theme: 'system',
        autoPlayAudio: true,
        srsRetention: 0.9,
        keyboardLayout: '3key',
        dailyNewLimit: 20,
        shuffleWords: false,
      });
      return;
    }
    const r = rows[0];
    res.json({
      theme: r.theme,
      autoPlayAudio: !!r.auto_play_audio,
      srsRetention: Number(r.srs_retention),
      keyboardLayout: r.keyboard_layout,
      dailyNewLimit: r.daily_new_limit,
      shuffleWords: !!r.shuffle_words,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 保存设置 */
userRouter.put('/settings', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const {
      theme,
      autoPlayAudio,
      srsRetention,
      keyboardLayout,
      dailyNewLimit,
      shuffleWords,
    } = req.body as {
      theme?: string;
      autoPlayAudio?: boolean;
      srsRetention?: number;
      keyboardLayout?: string;
      dailyNewLimit?: number;
      shuffleWords?: boolean;
    };

    // UPSERT: 如果没有记录就 INSERT，否则 UPDATE
    await execute(
      `INSERT INTO user_settings (user_id, theme, auto_play_audio, srs_retention, keyboard_layout, daily_new_limit, shuffle_words)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         theme = VALUES(theme),
         auto_play_audio = VALUES(auto_play_audio),
         srs_retention = VALUES(srs_retention),
         keyboard_layout = VALUES(keyboard_layout),
         daily_new_limit = VALUES(daily_new_limit),
         shuffle_words = VALUES(shuffle_words)`,
      [
        userId,
        theme ?? 'system',
        autoPlayAudio ? 1 : 0,
        srsRetention ?? 0.9,
        keyboardLayout ?? '3key',
        dailyNewLimit ?? 20,
        shuffleWords ? 1 : 0,
      ],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* 活跃词书 (active_book 表，按用户隔离)                                */
/* ------------------------------------------------------------------ */

/** 获取活跃词书 */
userRouter.get('/active-book', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const rows = await query<{ book_id: string }>(
      'SELECT book_id FROM active_book WHERE user_id = ?',
      [userId],
    );
    if (!rows.length) {
      res.json({ bookId: null });
      return;
    }
    res.json({ bookId: rows[0].book_id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 设置活跃词书 */
userRouter.put('/active-book', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { bookId } = req.body as { bookId: string };
    await execute(
      `INSERT INTO active_book (user_id, book_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE book_id = VALUES(book_id)`,
      [userId, bookId],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 清除活跃词书 */
userRouter.delete('/active-book', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    await execute('DELETE FROM active_book WHERE user_id = ?', [userId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
