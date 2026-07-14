/**
 * 登录/注册页面
 */

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useUiStore } from '@/stores/ui';

export function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { login, register } = useAuthStore();
  const pushToast = useUiStore((s) => s.pushToast);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      pushToast('请输入用户名和密码', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(username.trim(), password);
        pushToast('登录成功', 'success');
      } else {
        await register(username.trim(), password);
        pushToast('注册成功，欢迎使用 VocabFlow！', 'success');
      }
    } catch (err) {
      const msg = (err as Error).message;
      // 提取后端返回的错误信息
      const match = msg.match(/\(\d+\):\s*(.+)/);
      pushToast(match ? match[1] : '操作失败，请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-900">
      <div className="w-full max-w-md">
        {/* Logo & 标题 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg mb-4">
            <span className="text-3xl">📚</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">VocabFlow</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            科学背词，高效复习
          </p>
        </div>

        {/* 表单卡片 */}
        <div className="card-container p-8 space-y-6">
          {/* 模式切换 */}
          <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-800 text-brand-600 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                mode === 'register'
                  ? 'bg-white dark:bg-slate-800 text-brand-600 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              注册
            </button>
          </div>

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="用户名"
              name="username"
              type="text"
              placeholder="请输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              hint={mode === 'register' ? '2-32 个字符' : undefined}
            />
            <Input
              label="密码"
              name="password"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              hint={mode === 'register' ? '至少 6 位' : undefined}
            />

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting}
            >
              {submitting
                ? '请稍候...'
                : mode === 'login'
                  ? '登录'
                  : '注册'}
            </Button>
          </form>

          {/* 切换提示 */}
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? (
              <>
                还没有账号？
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="ml-1 text-brand-600 hover:underline font-medium"
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账号？
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="ml-1 text-brand-600 hover:underline font-medium"
                >
                  去登录
                </button>
              </>
            )}
          </p>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
          FSRS 间隔重复算法 · 多用户数据隔离
        </p>
      </div>
    </div>
  );
}
