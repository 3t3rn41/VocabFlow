/**
 * VocabFlow 后端服务
 *
 * Express + MySQL，提供 SRS、句子进度、用户设置等 API。
 */

import express from 'express';
import cors from 'cors';
import { srsRouter } from './routes/srs.js';
import { sentenceRouter } from './routes/sentences.js';
import { userRouter } from './routes/user.js';
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
app.use('/api/srs', srsRouter);
app.use('/api/sentences', sentenceRouter);
app.use('/api/user', userRouter);

app.listen(PORT, () => {
  console.log(`[server] VocabFlow API running at http://localhost:${PORT}`);
});
