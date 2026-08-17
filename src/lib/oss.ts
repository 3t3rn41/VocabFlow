/**
 * OSS 静态资源地址工具
 *
 * 将本地 public 目录下的相对路径（/audio/...、/images/...）
 * 统一映射为 OSS 远端 URL，避免打包 exe/msi 时携带超大静态资源。
 *
 * OSS 示例：
 *   http://oss.nysxzs.top/audio/example/IELTS/examples/0000_acquit.wav
 *
 * 用法：
 *   ossUrl('/audio/manifest.json')
 *   // => 'http://oss.nysxzs.top/audio/manifest.json'
 */

/** OSS 根地址（无尾斜杠） */
export const OSS_BASE = 'http://oss.nysxzs.top';

/**
 * 将项目内以 `/audio/...` 或 `/images/...` 开头的本地相对路径
 * 转换为 OSS 远端完整 URL。
 *
 * - 若传入的已经是 http(s) 或 data: 等 URL，原样返回；
 * - 若传入空字符串/null/undefined，原样返回；
 * - 其余情况拼接 OSS_BASE + path。
 */
export function ossUrl(path: string | null | undefined): string {
  if (path == null || path === '') return path as string;
  // 已经是绝对 URL，直接返回
  if (/^(https?:|data:|blob:|file:)/i.test(path)) return path;
  // 去除多余的 leading slash，保持一致
  const normalized = path.replace(/^\/+/, '');
  return `${OSS_BASE}/${normalized}`;
}
