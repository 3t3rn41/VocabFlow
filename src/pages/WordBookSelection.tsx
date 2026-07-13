import { useNavigate } from 'react-router-dom';
import { useWordBookStore } from '@/stores/wordBook';
import { WORD_BOOKS } from '@/data/wordbooks';
import { useUiStore } from '@/stores/ui';
import { clsx } from 'clsx';
import type { BookKind } from '@/types';

/* 书籍封面配色方案 */
const BOOK_COVERS: Record<string, { gradient: string; icon: string; accent: string }> = {
  gaokao: {
    gradient: 'from-rose-400 via-pink-500 to-purple-500',
    icon: '🎓',
    accent: 'text-pink-500',
  },
  ielts: {
    gradient: 'from-blue-400 via-indigo-500 to-violet-500',
    icon: '🌍',
    accent: 'text-indigo-500',
  },
  'ielts-sentences': {
    gradient: 'from-emerald-400 via-teal-500 to-cyan-500',
    icon: '💬',
    accent: 'text-emerald-500',
  },
};

function kindLabel(kind: BookKind): string {
  return kind === 'word' ? '单词' : '句子';
}

function kindBg(kind: BookKind): string {
  return kind === 'word'
    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300'
    : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-300';
}

export function WordBookSelection() {
  const setBook = useWordBookStore((s) => s.setBook);
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const pushToast = useUiStore((s) => s.pushToast);
  const navigate = useNavigate();

  async function handleSelect(bookId: string) {
    await setBook(bookId);
    pushToast('词书已切换，继续学习吧！', 'success');
    navigate('/today');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-50 via-brand-50/30 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="w-full max-w-3xl">
        {/* 标题区 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-300 text-xs font-medium mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            选择词书
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-600 to-indigo-600 dark:from-brand-400 dark:to-indigo-400 bg-clip-text text-transparent mb-3">
            VocabFlow
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            选择一本词书，开始你的学习之旅
          </p>
        </div>

        {/* 词书卡片 */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {WORD_BOOKS.map((book) => {
            const cover = BOOK_COVERS[book.id] ?? BOOK_COVERS.ielts;
            const isActive = book.id === activeBookId;

            return (
              <button
                key={book.id}
                onClick={() => handleSelect(book.id)}
                className={clsx(
                  'group relative overflow-hidden rounded-2xl text-left transition-all duration-300',
                  'hover:shadow-2xl hover:-translate-y-1',
                  isActive
                    ? 'ring-2 ring-brand-500 shadow-xl'
                    : 'ring-1 ring-slate-200 dark:ring-slate-700 shadow-md',
                )}
              >
                {/* 封面渐变区 */}
                <div className={clsx('relative h-28 bg-gradient-to-br', cover.gradient)}>
                  <div className="absolute inset-0 opacity-20" style={{
                    backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 30%, white 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                  }} />
                  <div className="absolute top-3 right-3">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/90 text-brand-600 text-xs font-bold backdrop-blur">
                        ✓ 当前
                      </span>
                    ) : (
                      <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium backdrop-blur')}>
                        {kindLabel(book.kind)}
                      </span>
                    )}
                  </div>
                  <div className="absolute bottom-3 left-4 text-4xl drop-shadow-lg">
                    {cover.icon}
                  </div>
                </div>

                {/* 内容区 */}
                <div className="p-5 bg-white dark:bg-slate-800 space-y-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition">
                      {book.title}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                      {book.description}
                    </p>
                  </div>

                  {/* 底部信息栏 */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center gap-1.5">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', kindBg(book.kind))}>
                        {kindLabel(book.kind)}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold text-slate-700 dark:text-slate-200 font-mono">
                        {book.total.toLocaleString()}
                      </span>
                      <span className="text-xs text-slate-400">
                        {book.kind === 'word' ? '词' : '句'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 悬停时底部高亮条 */}
                <div className={clsx(
                  'absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r transition-opacity duration-300',
                  cover.gradient,
                  isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )} />
              </button>
            );
          })}
        </div>

        {/* 底部提示 */}
        <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-8">
          切换词书不会丢失已有学习进度 · 数据安全存储在本地数据库
        </p>
      </div>
    </div>
  );
}
