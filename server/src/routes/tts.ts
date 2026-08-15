/**
 * TTS 路由 (桌面版 stub)
 * 桌面版 TTS 由前端处理，此路由仅保留兼容性
 */

import { Router } from 'express';

export const ttsRouter = Router();

ttsRouter.get('/', async (req, res) => {
  const { text } = req.query as { text?: string };
  if (!text) {
    res.status(400).json({ error: 'text 参数不能为空' });
    return;
  }
  res.json({ ok: true, message: 'Desktop TTS handled by frontend' });
});

ttsRouter.post('/', async (req, res) => {
  res.json({ ok: true, message: 'Desktop TTS handled by frontend' });
});
