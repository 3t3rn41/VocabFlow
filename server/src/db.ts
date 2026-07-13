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
