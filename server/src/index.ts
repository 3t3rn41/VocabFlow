/**
 * VocabFlow 后端服务
 *
 * Express + SQLite (sql.js WASM)，提供用户认证、SRS、句子进度、用户设置等 API。
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { srsRouter } from './routes/srs.js';
import { sentenceRouter } from './routes/sentences.js';
import { userRouter } from './routes/user.js';
import { ttsRouter } from './routes/tts.js';
import { authRouter } from './routes/auth.js';
import { ping } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json());

/* 健康检查 */
app.get('/api/health', async (_req, res) => {
  try {
    await ping();
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: String(e) });
  }
});

/* 路由挂载 */
app.use('/api/auth', authRouter);          // 认证路由 (注册/登录/me/change-password)
app.use('/api/srs', srsRouter);            // SRS 路由 (需认证)
app.use('/api/sentences', sentenceRouter); // 句子练习路由 (需认证)
app.use('/api/user', userRouter);          // 用户设置路由 (需认证)
app.use('/api/tts', ttsRouter);            // TTS 代理 (桌面版 stub)

/* 静态资源服务 (images / audio) */
function findStaticDir(name: string): string | null {
  const candidates = [
    path.join(process.cwd(), name),
    path.join(process.cwd(), '..', name),
    path.join(process.cwd(), 'public', name),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

const imagesDir = findStaticDir('images');
if (imagesDir) {
  app.use('/images', express.static(imagesDir, { maxAge: '7d', immutable: true }));
  console.log(`[desktop-server] serving images from: ${imagesDir}`);
}

const audioDir = findStaticDir('audio');
if (audioDir) {
  app.use('/audio', express.static(audioDir, { maxAge: '7d', immutable: true }));
  console.log(`[desktop-server] serving audio from: ${audioDir}`);
}

app.listen(PORT, () => {
  console.log(`[desktop-server] VocabFlow API running at http://localhost:${PORT}`);
});
