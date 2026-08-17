import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { initDesktopApiBase, isTauri, getApiBase } from '@/api/client';
import './index.css';

/**
 * 使用 HashRouter 而非 BrowserRouter：
 * Tauri 生产模式下页面协议为 tauri://localhost，不支持 HTML5 History API，
 * HashRouter 通过 URL hash (#/path) 导航，在所有协议下均可靠工作。
 */

/** 启动画面 HTML */
function showLoadingScreen() {
  const root = document.getElementById('root')!;
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;gap:12px;">
      <div style="width:24px;height:24px;border:3px solid #e2e8f0;border-top-color:#4f46e5;border-radius:50%;animation:vf-spin 0.8s linear infinite;"></div>
      <span style="color:#64748b;font-size:15px;">正在启动后端服务...</span>
    </div>
    <style>@keyframes vf-spin{to{transform:rotate(360deg)}}</style>
  `;
}

/** 错误画面 HTML */
function showErrorScreen(reason: string) {
  const root = document.getElementById('root')!;
  // 转义 HTML 特殊字符，防止 stderr 中的 < > & 破坏 DOM
  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;gap:16px;padding:24px;">
      <div style="font-size:40px;">⚠️</div>
      <div style="color:#dc2626;font-size:16px;font-weight:600;text-align:center;max-width:480px;">
        后端服务启动失败
      </div>
      <pre style="color:#334155;font-size:13px;text-align:left;max-width:560px;width:100%;line-height:1.6;background:#f8fafc;padding:16px 20px;border-radius:8px;border:1px solid #e2e8f0;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:0;">${escapeHtml(reason)}</pre>
      <button onclick="location.reload()" style="margin-top:8px;padding:8px 24px;background:#4f46e5;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer;">
        重新尝试
      </button>
    </div>
  `;
}

/**
 * 在 Tauri 桌面端等待后端就绪
 *
 * 策略：同时轮询 is_backend_ready 命令和 HTTP 健康检查。
 * 如果检测到 get_backend_error 返回了错误信息，立即返回失败原因。
 * 最多等待 30 秒。
 *
 * @returns null 表示成功，string 表示失败原因
 */
async function waitForBackend(): Promise<string | null> {
  if (!isTauri()) return null;

  const { invoke } = await import('@tauri-apps/api/core');
  const apiBase = getApiBase();
  const maxWait = 30_000; // 最长等待 30 秒
  const pollInterval = 300; // 每 300ms 轮询一次
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    // 1. 检查是否有错误信息（Rust 端已检测到失败）
    try {
      const error = await invoke<string | null>('get_backend_error');
      if (error) {
        return error;
      }
    } catch {
      // invoke 不可用，忽略
    }

    // 2. 检查后端是否已就绪
    try {
      const ready = await invoke<boolean>('is_backend_ready');
      if (ready) return null;
    } catch {
      // invoke 不可用，尝试 HTTP fallback
    }

    // 3. 直接尝试 HTTP 健康检查
    try {
      const res = await fetch(`${apiBase}/health`);
      if (res.ok) return null;
    } catch {
      // 后端还没启动，继续等待
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  // 超时后最后检查一次错误信息
  try {
    const error = await invoke<string | null>('get_backend_error');
    if (error) return error;
  } catch {
    // ignore
  }

  return '后端服务在 30 秒内未能启动就绪。可能原因：Node.js 未安装或版本过低、端口 3001 被占用、杀毒软件拦截了子进程。详细日志请查看 ~/.vocabflow/desktop.log';
}

async function bootstrap() {
  // 初始化桌面端 API 地址（非 Tauri 环境下为空操作）
  await initDesktopApiBase();

  // Tauri 桌面端：等待后端子进程就绪
  if (isTauri()) {
    showLoadingScreen();

    const failReason = await waitForBackend();
    if (failReason) {
      showErrorScreen(failReason);
      return;
    }
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  );
}

bootstrap();
