/**
 * JWT 认证中间件
 *
 * 从 Authorization: Bearer <token> 头中解析 JWT，
 * 验证后将 userId 和 username 挂载到 req.user 上。
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'vocabflow-secret-key-change-in-production';
const JWT_EXPIRES_IN = '30d';

/** 扩展 Express Request 类型，添加 user 字段 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        username: string;
      };
    }
  }
}

/** 生成 JWT Token */
export function signToken(userId: number, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** 验证 JWT Token，返回 payload 或 null */
export function verifyToken(token: string): { userId: number; username: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
    return payload;
  } catch {
    return null;
  }
}

/**
 * 认证中间件 — 要求请求携带有效的 JWT Token
 * 无 token 或 token 无效时返回 401
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录，请先登录' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
    return;
  }

  req.user = payload;
  next();
}
