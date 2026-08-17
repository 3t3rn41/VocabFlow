import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settings';
import type { CardTheme } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/stores/ui';
import { rebuildFsrs } from '@/srs/engine';
import { getBookMeta, WORD_BOOKS } from '@/data/wordbooks';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useState } from 'react';
import { clsx } from 'clsx';
import type { BookKind } from '@/types';

const RETENTION_OPTIONS = [0.85, 0.9, 0.92, 0.95];

const CARD_THEMES: { value: CardTheme; label: string; desc: string }[] = [
  { value: 'default', label: '默认', desc: '标准白色卡片' },
  { value: 'green', label: '护眼绿', desc: '柔和绿色背景' },
  { value: 'parchment', label: '羊皮卷', desc: '复古纸质风格' },
  { value: 'minimal', label: '极简白', desc: '极简阴影' },
];

const DAILY_NEW_OPTIONS = [10, 20, 30, 50, 80];
const DAILY_REVIEW_OPTIONS = [20, 50, 100, 150, 200];

/* ================================================================
   词书切换内联面板
   ================================================================ */

const BOOK_COVERS: Record<string, { bg: string; ring: string }> = {
  zhongkao: { bg: 'bg-orange-500', ring: 'ring-orange-300' },
  gaokao: { bg: 'bg-pink-500', ring: 'ring-pink-300' },
  cet4: { bg: 'bg-emerald-500', ring: 'ring-emerald-300' },
  cet6: { bg: 'bg-purple-500', ring: 'ring-purple-300' },
  ielts: { bg: 'bg-indigo-500', ring: 'ring-indigo-300' },
  'ielts-sentences': { bg: 'bg-teal-500', ring: 'ring-teal-300' },
  'language-sense': { bg: 'bg-fuchsia-500', ring: 'ring-fuchsia-300' },
};

function kindLabel(kind: BookKind): string {
  return kind === 'word' ? '单词' : '句子';
}

function kindBg(kind: BookKind): string {
  return kind === 'word'
    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300'
    : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-300';
}

interface BookSwitcherPanelProps {
  activeBookId: string | null;
  onSelect: (bookId: string) => void;
  expanded: boolean;
}

function BookSwitcherPanel({ activeBookId, onSelect, expanded }: BookSwitcherPanelProps) {
  return (
    <div
      className="grid transition-all duration-300 ease-out"
      style={{
        gridTemplateRows: expanded ? '1fr' : '0fr',
        opacity: expanded ? 1 : 0,
      }}
    >
      <div className="overflow-hidden">
        <div className="space-y-2 pt-2">
          {WORD_BOOKS.map((book) => {
            const cover = BOOK_COVERS[book.id] ?? BOOK_COVERS.ielts;
            const isActive = book.id === activeBookId;

            return (
              <button
                key={book.id}
                onClick={() => onSelect(book.id)}
                className={clsx(
                  'w-full flex items-center gap-3 p-2.5 rounded-xl transition-all',
                  isActive
                    ? 'bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 ring-1 ring-slate-200 dark:ring-slate-700',
                )}
              >
                {/* 封面缩略图 */}
                <div className={clsx(
                  'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-base font-bold text-white shadow-sm',
                  cover.bg,
                )}>
                  {book.title.charAt(0)}
                </div>

                {/* 书籍信息 */}
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 truncate text-sm">
                      {book.title}
                    </h4>
                    {isActive && (
                      <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full bg-brand-500 text-white text-[10px] font-bold">
                        当前
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {book.description}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', kindBg(book.kind))}>
                      {kindLabel(book.kind)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {book.total.toLocaleString()} {book.kind === 'word' ? '词' : '句'}
                    </span>
                  </div>
                </div>

                {/* 右侧箭头 */}
                <div className={clsx(
                  'flex-shrink-0 transition-transform',
                  isActive ? 'text-brand-500' : 'text-slate-300 dark:text-slate-600',
                )}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   设置页面
   ================================================================ */

export function Settings() {
  const settings = useSettingsStore();
  const { activeBookId, setBook } = useWordBookStore();
  const pushToast = useUiStore((s) => s.pushToast);
  const navigate = useNavigate();
  const { user, logout, changePassword } = useAuthStore();
  const isMobile = useIsMobile();

  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;

  const [showBookSwitcher, setShowBookSwitcher] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);

  async function handleChangePassword() {
    if (!passwordForm.current || !passwordForm.next) {
      pushToast('请填写当前密码和新密码', 'error');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      pushToast('两次输入的新密码不一致', 'error');
      return;
    }
    if (passwordForm.next.length < 6) {
      pushToast('新密码长度不能少于 6 位', 'error');
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(passwordForm.current, passwordForm.next);
      pushToast('密码修改成功', 'success');
      setShowChangePassword(false);
      setPasswordForm({ current: '', next: '', confirm: '' });
    } catch (e) {
      pushToast(`密码修改失败: ${(e as Error).message}`, 'error');
    } finally {
      setChangingPassword(false);
    }
  }

  function handleRetentionChange(value: number) {
    settings.patch({ srsRetention: value });
    rebuildFsrs();
    pushToast(`目标保留率已设为 ${Math.round(value * 100)}%`, 'success');
  }

  async function handleSwitchBook(bookId: string) {
    if (bookId === activeBookId) {
      setShowBookSwitcher(false);
      return;
    }
    await setBook(bookId);
    pushToast('词书已切换', 'success');
    setShowBookSwitcher(false);
    navigate('/today');
  }

  function handleLogout() {
    if (!confirm('确认退出登录？')) return;
    logout();
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">设置</h2>

      {/* 用户信息 */}
      <section className="card-container p-6 space-y-4">
        <h3 className="font-semibold">账号</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xl font-bold">
              {user?.username?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="font-medium">{user?.username ?? '未知用户'}</p>
              <p className="text-xs text-slate-400">已登录</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowChangePassword((v) => !v)}>
              修改密码
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              退出登录
            </Button>
          </div>
        </div>
        {showChangePassword && (
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700 animate-fadeInUp">
            <input
              type="password"
              placeholder="当前密码"
              value={passwordForm.current}
              onChange={(e) => setPasswordForm((f) => ({ ...f, current: e.target.value }))}
              className="input-base w-full"
              autoComplete="current-password"
            />
            <input
              type="password"
              placeholder="新密码 (至少6位)"
              value={passwordForm.next}
              onChange={(e) => setPasswordForm((f) => ({ ...f, next: e.target.value }))}
              className="input-base w-full"
              autoComplete="new-password"
            />
            <input
              type="password"
              placeholder="确认新密码"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
              className="input-base w-full"
              autoComplete="new-password"
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleChangePassword}
                disabled={changingPassword}
              >
                {changingPassword ? '提交中...' : '确认修改'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowChangePassword(false);
                  setPasswordForm({ current: '', next: '', confirm: '' });
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 当前词书 */}
      <section className="card-container p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">当前词书</h3>
          <button
            onClick={() => setShowBookSwitcher((v) => !v)}
            className="text-sm text-brand-600 hover:text-brand-700 transition flex items-center gap-1"
          >
            {showBookSwitcher ? '收起' : '切换词书'}
            <svg
              className={clsx('w-4 h-4 transition-transform duration-300', showBookSwitcher && 'rotate-180')}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {bookMeta ? (
          <div className="flex items-center gap-3">
            <div className={clsx(
              'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-base font-bold text-white shadow-sm',
              (BOOK_COVERS[activeBookId ?? ''] ?? BOOK_COVERS.ielts).bg,
            )}>
              {bookMeta.title.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{bookMeta.title}</p>
              <p className="text-sm text-slate-500 truncate">{bookMeta.description}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">未选择词书</p>
        )}

        {/* 内联词书切换面板 */}
        <BookSwitcherPanel
          activeBookId={activeBookId}
          onSelect={handleSwitchBook}
          expanded={showBookSwitcher}
        />
        {showBookSwitcher && (
          <p className="text-xs text-center text-slate-400 pt-1">
            切换词书不会丢失已有学习进度
          </p>
        )}
      </section>

      {/* 学习设置 */}
      <section className="card-container p-6 space-y-4">
        <h3 className="font-semibold">学习</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm">键盘布局</span>
          <select
            className="input-base w-40"
            value={settings.keyboardLayout}
            onChange={(e) => settings.patch({ keyboardLayout: e.target.value as '3key' | '4key' })}
          >
            <option value="3key">{isMobile ? '三键' : '三键 (1/2/3)'}</option>
            <option value="4key">{isMobile ? '四键' : '四键 (1/2/3/4)'}</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">自动朗读发音</span>
          <input
            type="checkbox"
            checked={settings.autoPlayAudio}
            onChange={(e) => settings.patch({ autoPlayAudio: e.target.checked })}
            className="w-4 h-4"
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">打乱单词顺序</span>
            <p className="text-xs text-slate-400 mt-0.5">复习时随机打乱单词出现顺序</p>
          </div>
          <input
            type="checkbox"
            checked={settings.shuffleWords}
            onChange={(e) => settings.patch({ shuffleWords: e.target.checked })}
            className="w-4 h-4"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">SRS 目标保留率</span>
          <select
            className="input-base w-32"
            value={settings.srsRetention}
            onChange={(e) => handleRetentionChange(Number(e.target.value))}
          >
            {RETENTION_OPTIONS.map((r) => (
              <option key={r} value={r}>{Math.round(r * 100)}%</option>
            ))}
          </select>
        </div>
      </section>

      {/* 学习目标 — 2.3.2 */}
      <section className="card-container p-6 space-y-4">
        <h3 className="font-semibold">学习目标</h3>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">每日新词目标</span>
            <p className="text-xs text-slate-400 mt-0.5">每天计划学习的新词数量</p>
          </div>
          <select
            className="input-base w-24"
            value={settings.dailyNewGoal}
            onChange={(e) => settings.patch({ dailyNewGoal: Number(e.target.value) })}
          >
            {DAILY_NEW_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">每日复习目标</span>
            <p className="text-xs text-slate-400 mt-0.5">每天计划复习的单词数量</p>
          </div>
          <select
            className="input-base w-24"
            value={settings.dailyReviewGoal}
            onChange={(e) => settings.patch({ dailyReviewGoal: Number(e.target.value) })}
          >
            {DAILY_REVIEW_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </section>

      {/* 外观 */}
      <section className="card-container p-6 space-y-4">
        <h3 className="font-semibold">外观</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm">主题</span>
          <select
            className="input-base w-32"
            value={settings.theme}
            onChange={(e) => settings.patch({ theme: e.target.value as 'light' | 'dark' | 'system' })}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
        {/* 卡片皮肤 — 2.5.1 */}
        <div className="space-y-2">
          <span className="text-sm">卡片风格</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CARD_THEMES.map((ct) => (
              <button
                key={ct.value}
                onClick={() => settings.patch({ cardTheme: ct.value })}
                className={clsx(
                  'p-3 rounded-xl border-2 transition text-left',
                  settings.cardTheme === ct.value
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                    : 'border-slate-200 dark:border-slate-600 hover:border-brand-300',
                )}
              >
                <div className={clsx(
                  'w-full h-8 rounded-lg mb-1.5 border',
                  ct.value === 'default' && 'bg-white border-slate-300',
                  ct.value === 'green' && 'bg-[rgb(237,247,237)] border-[rgb(198,226,199)]',
                  ct.value === 'parchment' && 'bg-[rgb(250,240,218)] border-[rgb(218,200,168)]',
                  ct.value === 'minimal' && 'bg-white border-slate-100',
                )} />
                <p className="text-xs font-medium">{ct.label}</p>
                <p className="text-[10px] text-slate-400">{ct.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
