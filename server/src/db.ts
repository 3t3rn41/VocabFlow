/**
 * SQLite 数据库层 (sql.js WASM)
 * 数据持久化到 ~/.vocabflow/vocabflow.db
 */

import sql from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

function getDbPath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '.';
  const dataDir = path.join(home, '.vocabflow');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'vocabflow.db');
}

const DB_PATH = getDbPath();
let _db: any = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

async function getDb() {
  if (_db) return _db;
  const dir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const wasmCandidates = [
    path.join(dir, 'sql-wasm.wasm'),
    path.join(dir, '..', 'sql-wasm.wasm'),
    path.join(dir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(dir, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    'sql-wasm.wasm',
  ];
  const wasmPath = wasmCandidates.find((p) => fs.existsSync(p)) ?? 'sql-wasm.wasm';
  const SQL = await (sql as any).default({ locateFile: (file: string) => file === 'sql-wasm.wasm' ? wasmPath : file });
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(buffer);
  } else {
    _db = new SQL.Database();
    initSchema(_db);
    saveDb();
  }
  console.log(`[sqlite] 数据库路径: ${DB_PATH}`);
  return _db;
}

function saveDb() {
  if (!_db) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (!_db) return;
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }, 100);
}

function initSchema(db: any) {
  // 完整建表语句
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS srs_cards (
      user_id INTEGER NOT NULL,
      word_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      stability REAL DEFAULT 0,
      difficulty REAL DEFAULT 0,
      elapsed_days INTEGER DEFAULT 0,
      state INTEGER DEFAULT 0,
      due TEXT,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      last_grade INTEGER,
      updated_at TEXT,
      PRIMARY KEY (user_id, word_id)
    );
    CREATE TABLE IF NOT EXISTS review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      word_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      grade INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_logs_user ON review_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_user_book ON review_logs(user_id, book_id);
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      theme TEXT DEFAULT 'system',
      auto_play_audio INTEGER DEFAULT 1,
      srs_retention REAL DEFAULT 0.9,
      keyboard_layout TEXT DEFAULT '3key',
      daily_new_limit INTEGER DEFAULT 20,
      shuffle_words INTEGER DEFAULT 0,
      card_theme TEXT DEFAULT 'default',
      daily_new_goal INTEGER DEFAULT 30,
      daily_review_goal INTEGER DEFAULT 50
    );
    CREATE TABLE IF NOT EXISTS active_book (
      user_id INTEGER PRIMARY KEY,
      book_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sentence_progress (
      user_id INTEGER NOT NULL,
      band INTEGER NOT NULL,
      topic_idx INTEGER NOT NULL,
      dialogue_idx INTEGER NOT NULL,
      completed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, band, topic_idx, dialogue_idx)
    );
    CREATE TABLE IF NOT EXISTS sentence_position (
      user_id INTEGER PRIMARY KEY,
      band INTEGER NOT NULL,
      topic_idx INTEGER NOT NULL,
      dialogue_idx INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sentence_mastery (
      user_id INTEGER NOT NULL,
      band INTEGER NOT NULL,
      topic_idx INTEGER NOT NULL,
      dialogue_idx INTEGER NOT NULL,
      source TEXT DEFAULT 'manual',
      proficiency INTEGER DEFAULT 100,
      pause_ms INTEGER DEFAULT 0,
      tab_count INTEGER DEFAULT 0,
      typo_count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, band, topic_idx, dialogue_idx)
    );
    CREATE TABLE IF NOT EXISTS sentence_practice_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      band INTEGER NOT NULL,
      topic_idx INTEGER NOT NULL,
      dialogue_idx INTEGER NOT NULL,
      proficiency INTEGER DEFAULT 0,
      pause_ms INTEGER DEFAULT 0,
      tab_count INTEGER DEFAULT 0,
      typo_count INTEGER DEFAULT 0,
      practiced_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spl_user ON sentence_practice_log(user_id);
  `);
}

/** MySQL→SQLite SQL 方言转换 */
function adaptSql(sql: string): string {
  let s = sql;
  // DATE_SUB 必须先于 UTC_DATE 替换，否则 UTC_DATE() 已被替换为 date('now') 导致正则失配
  s = s.replace(/DATE_SUB\(UTC_DATE\(\),\s*INTERVAL\s+(\d+)\s+DAY\)/g, "date('now', '-$1 day')");
  s = s.replace(/UTC_TIMESTAMP\(\)/g, "datetime('now')");
  s = s.replace(/UTC_DATE\(\)/g, "date('now')");
  s = s.replace(/UTC_TIME\(\)/g, "time('now')");
  return s;
}

/** 执行查询并返回行 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await getDb();
  const stmt = db.prepare(adaptSql(sql));
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

/** 执行单条写入，返回 insertId */
export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ insertId: number; affectedRows: number }> {
  const db = await getDb();
  db.run(adaptSql(sql), params);
  const insertId = db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0] ?? 0;
  const affectedRows = db.getRowsModified();
  saveDb();
  return { insertId, affectedRows };
}

/** 健康检查 */
export async function ping(): Promise<void> {
  await getDb();
}
