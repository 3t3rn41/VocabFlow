/** localStorage 包装 — 简单 KV */

export class StorageQuotaError extends Error {
  constructor(
    message: string,
    readonly key: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export const storage = {
  get<T = string>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  /**
   * 写入 KV。成功返回 true; 若触发 QuotaExceededError 抛出 StorageQuotaError,
   * 调用方可捕获后向用户提示需要清理数据。
   */
  set(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      const isQuota =
        e instanceof DOMException &&
        (e.name === 'QuotaExceededError' ||
          e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      if (isQuota) {
        throw new StorageQuotaError(
          `本地存储空间已满,写入 "${key}" 失败。请在设置中清理数据后重试。`,
          key,
          e,
        );
      }
      console.error('[storage] set failed', key, e);
      return false;
    }
  },

  remove(key: string): void {
    localStorage.removeItem(key);
  },
};
