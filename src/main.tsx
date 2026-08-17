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

/** 在 Tauri 桌面端等待后端就绪（最长 30 秒） */
async function waitForBackend(): Promise<void> {
  if (!isTauri()) return;

  // 先尝试通过 Tauri 命令检查后端状态
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    for (let i = 0; i < 60; i++) {
      const ready = await invoke<boolean>('is_backend_ready');
      if (ready) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch {
    // invoke 不可用时，直接尝试 HTTP 连接
  }

  // Fallback：直接尝试 HTTP 请求
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${getApiBase()}/health`);
      if (res.ok) return;
    } catch {
      // 后端还没启动，继续等待
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function bootstrap() {
  // 初始化桌面端 API 地址（非 Tauri 环境下为空操作）
  await initDesktopApiBase();

  // Tauri 桌面端：等待后端子进程就绪
  if (isTauri()) {
    // 显示加载画面
    const root = document.getElementById('root')!;
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;gap:12px;">
        <div style="width:24px;height:24px;border:3px solid #e2e8f0;border-top-color:#4f46e5;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <span style="color:#64748b;font-size:15px;">正在启动后端服务...</span>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;

    await waitForBackend();
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
