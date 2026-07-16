/**
 * VocabFlow 后端服务
 *
 * Express + MySQL，提供用户认证、SRS、句子进度、用户设置等 API。
 */

import express from 'express';
import cors from 'cors';
import { srsRouter } from './routes/srs.js';
import { sentenceRouter } from './routes/sentences.js';
import { userRouter } from './routes/user.js';
import { ttsRouter } from './routes/tts.js';
import { asrRouter, preloadASRModel } from './routes/asr.js';
import { authRouter } from './routes/auth.js';
import { pool } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json());

/* 健康检查 */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.execute('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: String(e) });
  }
});

/* 路由挂载 */
app.use('/api/auth', authRouter);          // 认证路由 (注册/登录/me)
app.use('/api/srs', srsRouter);            // SRS 路由 (需认证)
app.use('/api/sentences', sentenceRouter); // 句子练习路由 (需认证)
app.use('/api/user', userRouter);          // 用户设置路由 (需认证)
app.use('/api/tts', ttsRouter);            // TTS 代理 (无需认证)
app.use('/api/asr', asrRouter);            // ASR 语音识别 (需认证)

app.listen(PORT, () => {
  console.log(`[server] VocabFlow API running at http://localhost:${PORT}`);

  // 服务启动后预加载 Whisper ASR 模型（异步，不阻塞服务启动）
  preloadASRModel();
});
