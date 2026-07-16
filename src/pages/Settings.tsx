import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settings';
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

/* ================================================================
   词书切换弹窗
   ================================================================ */

const BOOK_COVERS: Record<string, { gradient: string; icon: string }> = {
  zhongkao: { gradient: 'from-amber-400 via-orange-500 to-red-500', icon: '📘' },
  gaokao: { gradient: 'from-rose-400 via-pink-500 to-purple-500', icon: '🎓' },
  cet4: { gradient: 'from-green-400 via-emerald-500 to-teal-500', icon: '📗' },
  cet6: { gradient: 'from-violet-400 via-purple-500 to-indigo-500', icon: '📕' },
  ielts: { gradient: 'from-blue-400 via-indigo-500 to-violet-500', icon: '🌍' },
  'ielts-sentences': { gradient: 'from-emerald-400 via-teal-500 to-cyan-500', icon: '💬' },
  'language-sense': { gradient: 'from-fuchsia-400 via-pink-500 to-rose-500', icon: '✨' },
};

function kindLabel(kind: BookKind): string {
  return kind === 'word' ? '单词' : '句子';
}

function kindBg(kind: BookKind): string {
  return kind === 'word'
    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300'
    : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-300';
}

interface BookSwitcherModalProps {
  activeBookId: string | null;
  onSelect: (bookId: string) => void;
  onClose: () => void;
}

function BookSwitcherModal({ activeBookId, onSelect, onClose }: BookSwitcherModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-white dark:bg-slate-800 shadow-2xl animate-fadeInUp safe-area-pb"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-bold">切换词书</h3>
            <p className="text-xs text-slate-400 mt-0.5">学习进度不会丢失</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 词书列表 */}
        <div className="p-4 space-y-3">
          {WORD_BOOKS.map((book) => {
            const cover = BOOK_COVERS[book.id] ?? BOOK_COVERS.ielts;
            const isActive = book.id === activeBookId;

            return (
              <button
                key={book.id}
                onClick={() => onSelect(book.id)}
                className={clsx(
                  'w-full flex items-center gap-4 p-3 rounded-xl transition-all',
                  isActive
                    ? 'bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 ring-1 ring-slate-200 dark:ring-slate-700',
                )}
              >
                {/* 封面缩略图 */}
                <div className={clsx(
                  'flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center text-2xl shadow-md',
                  cover.gradient,
                )}>
                  {cover.icon}
                </div>

                {/* 书籍信息 */}
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 truncate">
                      {book.title}
                    </h4>
                    {isActive && (
                      <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-brand-500 text-white text-xs font-bold">
                        ✓ 当前
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {book.description}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium', kindBg(book.kind))}>
                      {kindLabel(book.kind)}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {book.total.toLocaleString()} {book.kind === 'word' ? '词' : '句'}
                    </span>
                  </div>
                </div>

                {/* 右侧箭头 */}
                <div className={clsx(
                  'flex-shrink-0 transition-transform',
                  isActive ? 'text-brand-500' : 'text-slate-300 dark:text-slate-600',
                )}>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>

        {/* 弹窗底部 */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-center text-slate-400">
            切换词书不会丢失已有学习进度
          </p>
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
  const { user, logout } = useAuthStore();
  const isMobile = useIsMobile();

  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;

  const [showBookSwitcher, setShowBookSwitcher] = useState(false);

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
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
              {user?.username?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="font-medium">{user?.username ?? '未知用户'}</p>
              <p className="text-xs text-slate-400">已登录</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </section>

      {/* 当前词书 */}
      <section className="card-container p-6 space-y-4">
        <h3 className="font-semibold">当前词书</h3>
        {bookMeta ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{bookMeta.kind === 'word' ? '📚' : '💬'}</span>
              <div>
                <p className="font-medium">{bookMeta.title}</p>
                <p className="text-sm text-slate-500">{bookMeta.description}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowBookSwitcher(true)}>
              切换
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">未选择词书</p>
        )}
      </section>

      {/* 词书切换弹窗 */}
      {showBookSwitcher && (
        <BookSwitcherModal
          activeBookId={activeBookId}
          onSelect={handleSwitchBook}
          onClose={() => setShowBookSwitcher(false)}
        />
      )}

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
      </section>

    </div>
  );
}
