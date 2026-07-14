/**
 * 用户认证路由
 *
 * 提供注册、登录、获取当前用户信息接口。
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, execute } from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

/** 用户注册 */
authRouter.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }

    if (username.length < 2 || username.length > 32) {
      res.status(400).json({ error: '用户名长度需在 2-32 个字符之间' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: '密码长度不能少于 6 位' });
      return;
    }

    // 检查用户名是否已存在
    const existing = await query<UserRow>(
      'SELECT id FROM users WHERE username = ?',
      [username],
    );
    if (existing.length > 0) {
      res.status(409).json({ error: '该用户名已被注册' });
      return;
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 创建用户
    const result = await execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, passwordHash],
    );

    const userId = result.insertId;
    const token = signToken(userId, username);

    res.status(201).json({
      token,
      user: { id: userId, username },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 用户登录 */
authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }

    const rows = await query<UserRow>(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username],
    );

    if (rows.length === 0) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const token = signToken(user.id, user.username);

    res.json({
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 获取当前登录用户信息 */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user!.userId,
      username: req.user!.username,
    },
  });
});
