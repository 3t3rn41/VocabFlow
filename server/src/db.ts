/**
 * MySQL 连接池
 */

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'vocabflow',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  // 所有 DATETIME 值以 UTC 存储（toMySQLDateTime 使用 toISOString），
  // 必须告诉 mysql2 读取时也按 UTC 解析，否则会用服务器本地时区（如 UTC+8）解析，
  // 导致时间偏移 8 小时。
  timezone: '+00:00',
};

export const pool = mysql.createPool(DB_CONFIG);

/** 执行查询并返回行 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await pool.query(sql, params as mysql.QueryValues);
  return rows as T[];
}

/** 执行单条写入，返回 insertId */
export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await pool.query(sql, params as mysql.QueryValues);
  const r = result as mysql.ResultSetHeader;
  return { insertId: r.insertId, affectedRows: r.affectedRows };
}
