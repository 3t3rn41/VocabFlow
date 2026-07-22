import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlashCard } from '@/components/review/FlashCard';
import { GradeButtons } from '@/components/review/GradeButtons';
import { ReviewComplete } from '@/components/review/ReviewComplete';
import { useSettingsStore } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { useSwipe } from '@/hooks/useSwipe';
import { Grade } from '@/types';
import type { ReviewItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { generateReviewQueue, reviewAndPersist, undoReview } from '@/srs/engine';
import type { ReviewFilter } from '@/srs/engine';
import { clsx } from 'clsx';

export function Review() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const keyboardLayout = useSettingsStore((s) => s.keyboardLayout);
  const shuffleWords = useSettingsStore((s) => s.shuffleWords);
  const navigate = useNavigate();

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);

  // 手势支持：左滑 Again, 右滑 Good, 上滑翻卡, 下滑跳过
  useSwipe(cardRef, {
    onSwipeLeft: () => { if (flipped) handleGrade(Grade.Again); },
    onSwipeRight: () => { if (flipped) handleGrade(Grade.Good); },
    onSwipeUp: () => { if (!flipped) setFlipped(true); },
    onSwipeDown: () => { handleSkip(); },
  });

  // 生成复习队列
  useEffect(() => {
    if (!activeBookId) {
      setLoading(false);
      return;
    }
    // 切换词书时重置所有状态
    setIdx(0);
    setFlipped(false);
    setHistory([]);
    setFinished(false);
    setLoading(true);
    (async () => {
      try {
        const queue = await generateReviewQueue(activeBookId, 200, shuffleWords, filter);
        setItems(queue);
      } catch (e) {
        console.error('[review] generate queue failed', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeBookId, shuffleWords, filter]);

  // 键盘快捷键
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!flipped) setFlipped(true);
        return;
      }
      if (grading) return;
      if (e.key === '1') handleGrade(Grade.Again);
      else if (e.key === '2') handleGrade(Grade.Hard);
      else if (e.key === '3') handleGrade(Grade.Good);
      else if (keyboardLayout === '4key' && e.key === '4') handleGrade(Grade.Easy);
      else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, flipped, items, history, keyboardLayout, grading]);

  async function handleGrade(g: Grade) {
    if (!flipped) { setFlipped(true); return; }
    if (grading) return;
    if (idx >= items.length) return;

    const current = items[idx];
    if (!current) return;
    setGrading(true);

    try {
      await reviewAndPersist(current.wordId, current.bookId, g);
      setHistory((h) => [...h, current.wordId]);

      const nextIdx = idx + 1;
      if (nextIdx >= items.length) {
        setFinished(true);
      } else {
        setIdx(nextIdx);
        setFlipped(false);
      }
    } catch (e) {
      console.error('[review] grade failed', e);
    } finally {
      setGrading(false);
    }
  }

  function handleSkip() {
    if (idx < items.length - 1) {
      setIdx((i) => i + 1);
      setFlipped(false);
    }
  }

  async function handleUndo() {
    if (!history.length || grading) return;
    const lastWordId = history[history.length - 1];
    setGrading(true);

    try {
      await undoReview(lastWordId);
      setHistory((h) => h.slice(0, -1));
      setIdx((i) => Math.max(0, i - 1));
      setFlipped(false);
      setFinished(false);
    } catch (e) {
      console.error('[review] undo failed', e);
    } finally {
      setGrading(false);
    }
  }

  if (!activeBookId) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-4">
        <p className="text-slate-500">请先选择一本词书</p>
        <Button variant="primary" onClick={() => navigate('/select-book')}>
          选择词书
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-3">
        <Spinner size="md" />
        <span className="text-slate-500">生成复习队列...</span>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <div className="card-container p-6 md:p-12 text-center space-y-4 animate-fadeInScale">
          <div className="text-5xl animate-emptyBounce">🎉</div>
          <p className="text-xl">今日学习已完成</p>
          <p className="text-sm text-slate-500">没有更多待复习的单词</p>
          <Button variant="primary" onClick={() => navigate('/today')}>
            返回今日
          </Button>
        </div>
      </div>
    );
  }

  if (finished) {
    return <ReviewComplete total={items.length} onBack={() => navigate('/today')} />;
  }

  const current = items[idx];

  return (
    <div className="max-w-2xl mx-auto h-full flex flex-col">
      {/* 进度条 */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-sm text-slate-500">
          {idx + 1} / {items.length}
        </span>
        <div className="flex items-center gap-3">
          <button
            className="text-sm text-slate-400 hover:text-slate-600"
            onClick={() => setShowFilter((v) => !v)}
          >
            筛选
          </button>
          <button
            className="text-sm text-slate-400 hover:text-slate-600 disabled:opacity-30"
            onClick={handleUndo}
            disabled={!history.length || grading}
          >
            ↩ 撤销
          </button>
        </div>
      </div>

      {/* 筛选面板 */}
      {showFilter && (
        <div className="card-container p-4 space-y-3 animate-fadeInUp shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">定向复习筛选</h3>
            <button
              className="text-xs text-slate-400 hover:text-slate-600"
              onClick={() => { setFilter(undefined); setShowFilter(false); }}
            >
              清除筛选
            </button>
          </div>
          {/* 首字母范围 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-16">首字母</span>
            <select
              className="input-base w-20 text-sm"
              value={filter?.letterRange?.[0] ?? ''}
              onChange={(e) => {
                const start = e.target.value;
                const end = filter?.letterRange?.[1] ?? 'Z';
                setFilter({ ...filter, letterRange: start ? [start, end] : undefined });
              }}
            >
              <option value="">全部</option>
              {['A','E','I','M','Q','U'].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <span className="text-xs text-slate-400">~</span>
            <select
              className="input-base w-20 text-sm"
              value={filter?.letterRange?.[1] ?? ''}
              onChange={(e) => {
                const end = e.target.value;
                const start = filter?.letterRange?.[0] ?? 'A';
                setFilter({ ...filter, letterRange: end ? [start, end] : undefined });
              }}
            >
              <option value="">全部</option>
              {['D','H','L','P','T','Z'].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          {/* 学习状态 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-16">学习状态</span>
            <select
              className="input-base flex-1 text-sm"
              value={filter?.state ?? ''}
              onChange={(e) => {
                const state = e.target.value as 'new' | 'learning' | 'mastered' | '';
                setFilter({ ...filter, state: state || undefined });
              }}
            >
              <option value="">全部</option>
              <option value="new">新词</option>
              <option value="learning">学习中</option>
              <option value="mastered">已掌握</option>
            </select>
          </div>
          {/* 错误次数 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-16">错误≥</span>
            <select
              className="input-base w-20 text-sm"
              value={filter?.minLapses ?? ''}
              onChange={(e) => {
                const n = e.target.value ? Number(e.target.value) : undefined;
                setFilter({ ...filter, minLapses: n });
              }}
            >
              <option value="">不限</option>
              <option value="1">1次</option>
              <option value="3">3次</option>
              <option value="5">5次</option>
            </select>
          </div>
          {/* 上次评分 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-16">上次评分</span>
            <select
              className="input-base flex-1 text-sm"
              value={filter?.lastGrade ?? ''}
              onChange={(e) => {
                const g = e.target.value ? Number(e.target.value) : undefined;
                setFilter({ ...filter, lastGrade: g });
              }}
            >
              <option value="">全部</option>
              <option value="0">忘记 (Again)</option>
              <option value="1">困难 (Hard)</option>
              <option value="2">良好 (Good)</option>
              <option value="3">简单 (Easy)</option>
            </select>
          </div>
          {filter && (
            <p className="text-xs text-brand-500">已应用筛选，共 {items.length} 词</p>
          )}
        </div>
      )}

      {/* 卡片区域 — flex-1 填满剩余空间 */}
      <div className="flex-1 flex items-center justify-center min-h-0 py-4">
        <div key={current.wordId} ref={cardRef} className="w-full h-full animate-cardSlideIn">
          <FlashCard
            item={current}
            flipped={flipped}
            onFlip={() => setFlipped(true)}
          />
        </div>
      </div>

      {/* 评分按钮 — 翻转后从底部冒出 */}
      <div
        className="shrink-0"
        style={{
          display: 'grid',
          gridTemplateRows: flipped ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="overflow-hidden">
          <div className={clsx(
            flipped
              ? 'animate-gradeEmerge'
              : 'opacity-0 translate-y-6 pointer-events-none transition-all duration-200 ease-out',
          )}>
            <GradeButtons layout={keyboardLayout} onGrade={handleGrade} disabled={grading} />
          </div>
        </div>
      </div>
    </div>
  );
}
