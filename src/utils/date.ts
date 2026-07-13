/** 时间工具 — 北京时区 (UTC+8) */

const BJT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 返回今天的北京日期 'YYYY-MM-DD' */
export function todayBJ(): string {
  return toBJDate(new Date());
}

export function toBJDate(d: Date | string | number): string {
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  const bj = new Date(date.getTime() + BJT_OFFSET_MS);
  return bj.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function isoToMs(iso: string | undefined | null): number {
  if (!iso) return 0;
  return new Date(iso).getTime();
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟${s % 60}秒`;
  const h = Math.floor(m / 60);
  return `${h}小时${m % 60}分钟`;
}

/** N 天前的北京日期 (from = today if not provided) */
export function daysAgoBJ(n: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() - n * 86_400_000);
  return toBJDate(d);
}
