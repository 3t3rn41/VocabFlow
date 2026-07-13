/**
 * 用户设置 & 活跃词书路由
 * 对应 user_settings / active_book 表
 */

import { Router } from 'express';
import { query, execute } from '../db.js';

export const userRouter = Router();

/* ------------------------------------------------------------------ */
/* 设置 (user_settings 表，单行 id=1)                                  */
/* ------------------------------------------------------------------ */

interface SettingsRow {
  theme: string;
  auto_play_audio: number;
  srs_retention: string;
  keyboard_layout: string;
  daily_new_limit: number;
  shuffle_words: number;
  tts_api_key: string | null;
}

/** 加载设置 */
userRouter.get('/settings', async (_req, res) => {
  try {
    const rows = await query<SettingsRow>(
      'SELECT theme, auto_play_audio, srs_retention, keyboard_layout, daily_new_limit, shuffle_words, tts_api_key FROM user_settings WHERE id = 1',
    );
    if (!rows.length) {
      res.json({});
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
      ttsApiKey: r.tts_api_key ?? '',
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 保存设置 */
userRouter.put('/settings', async (req, res) => {
  try {
    const {
      theme,
      autoPlayAudio,
      srsRetention,
      keyboardLayout,
      dailyNewLimit,
      shuffleWords,
      ttsApiKey,
    } = req.body as {
      theme?: string;
      autoPlayAudio?: boolean;
      srsRetention?: number;
      keyboardLayout?: string;
      dailyNewLimit?: number;
      shuffleWords?: boolean;
      ttsApiKey?: string;
    };

    // 如果没有记录就 INSERT，否则 UPDATE
    const existing = await query('SELECT id FROM user_settings WHERE id = 1');
    if (existing.length === 0) {
      await execute(
        `INSERT INTO user_settings (id, theme, auto_play_audio, srs_retention, keyboard_layout, daily_new_limit, shuffle_words, tts_api_key)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          theme ?? 'system',
          autoPlayAudio ? 1 : 0,
          srsRetention ?? 0.9,
          keyboardLayout ?? '3key',
          dailyNewLimit ?? 20,
          shuffleWords ? 1 : 0,
          ttsApiKey ?? null,
        ],
      );
    } else {
      await execute(
        `UPDATE user_settings SET
          theme = ?,
          auto_play_audio = ?,
          srs_retention = ?,
          keyboard_layout = ?,
          daily_new_limit = ?,
          shuffle_words = ?,
          tts_api_key = ?
         WHERE id = 1`,
        [
          theme ?? 'system',
          autoPlayAudio ? 1 : 0,
          srsRetention ?? 0.9,
          keyboardLayout ?? '3key',
          dailyNewLimit ?? 20,
          shuffleWords ? 1 : 0,
          ttsApiKey ?? null,
        ],
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* 活跃词书 (active_book 表，单行 id=1)                                */
/* ------------------------------------------------------------------ */

/** 获取活跃词书 */
userRouter.get('/active-book', async (_req, res) => {
  try {
    const rows = await query<{ book_id: string }>(
      'SELECT book_id FROM active_book WHERE id = 1',
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
userRouter.put('/active-book', async (req, res) => {
  try {
    const { bookId } = req.body as { bookId: string };
    await execute(
      `INSERT INTO active_book (id, book_id)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE book_id = VALUES(book_id)`,
      [bookId],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 清除活跃词书 */
userRouter.delete('/active-book', async (_req, res) => {
  try {
    await execute('DELETE FROM active_book WHERE id = 1', []);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
