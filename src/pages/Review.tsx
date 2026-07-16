import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlashCard } from '@/components/review/FlashCard';
import { GradeButtons } from '@/components/review/GradeButtons';
import { ReviewComplete } from '@/components/review/ReviewComplete';
import { useSettingsStore } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { Grade } from '@/types';
import type { ReviewItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { generateReviewQueue, reviewAndPersist, undoReview } from '@/srs/engine';
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
        const queue = await generateReviewQueue(activeBookId, 200, shuffleWords);
        setItems(queue);
      } catch (e) {
        console.error('[review] generate queue failed', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeBookId, shuffleWords]);

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
        <button
          className="text-sm text-slate-400 hover:text-slate-600 disabled:opacity-30"
          onClick={handleUndo}
          disabled={!history.length || grading}
        >
          ↩ 撤销
        </button>
      </div>

      {/* 卡片区域 — flex-1 填满剩余空间 */}
      <div className="flex-1 flex items-center justify-center min-h-0 py-4">
        <div key={current.wordId} className="w-full h-full animate-cardSlideIn">
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
