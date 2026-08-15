import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GradeButtons } from '@/components/review/GradeButtons';
import { useSettingsStore } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { Grade } from '@/types';
import type { ReviewItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { generateReviewQueue, reviewAndPersist } from '@/srs/engine';
import { speakWithBrowserTts, isAudioUnlocked, onAudioUnlock } from '@/api/tts';
import { clsx } from 'clsx';

type Phase = 'typing' | 'correct' | 'wrong' | 'revealed';
type Direction = 'en2cn' | 'cn2en';

/**
 * 模糊匹配：input 与 target 任一方 trim 后包含对方即视为匹配。
 * 用于 en→cn 方向的中文释义匹配（用户输入可能只是释义的一部分）。
 */
function fuzzyMatch(input: string, target: string): boolean {
  const a = input.trim();
  const b = target.trim();
  if (!a || !b) return false;
  return b.includes(a) || a.includes(b);
}

export function Translate() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const keyboardLayout = useSettingsStore((s) => s.keyboardLayout);
  const shuffleWords = useSettingsStore((s) => s.shuffleWords);
  const autoPlayAudio = useSettingsStore((s) => s.autoPlayAudio);
  const navigate = useNavigate();

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>('typing');
  const [direction, setDirection] = useState<Direction>('en2cn');
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [wordsAttempted, setWordsAttempted] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // 生成翻译队列
  useEffect(() => {
    if (!activeBookId) {
      setLoading(false);
      return;
    }
    setIdx(0);
    setTyped('');
    setPhase('typing');
    setFinished(false);
    setCorrectCount(0);
    setStreak(0);
    setWordsAttempted(0);
    setLoading(true);
    (async () => {
      try {
        const queue = await generateReviewQueue(activeBookId, 200, shuffleWords);
        setItems(queue);
      } catch (e) {
        console.error('[translate] generate queue failed', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeBookId, shuffleWords]);

  const currentItem = items[idx] ?? null;

  // 自动播放音频
  const playAudio = useCallback((word: string) => {
    if (isAudioUnlocked()) {
      speakWithBrowserTts(word, 'en-US').catch(() => {});
    } else {
      const cleanup = onAudioUnlock(() => {
        speakWithBrowserTts(word, 'en-US').catch(() => {});
      });
      return cleanup;
    }
  }, []);

  // 新词加载：随机方向 + 自动播放(en→cn 时)
  useEffect(() => {
    if (!currentItem || finished) return;
    setPhase('typing');
    setTyped('');
    const dir: Direction = Math.random() < 0.5 ? 'en2cn' : 'cn2en';
    setDirection(dir);
    if (dir === 'en2cn' && autoPlayAudio) {
      const cleanup = playAudio(currentItem.word);
      return cleanup;
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [currentItem, finished, autoPlayAudio, playAudio]);

  // 键盘快捷键（评分阶段）
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (phase === 'typing') return;
      if (grading) return;
      if (e.key === '1') handleGrade(Grade.Again);
      else if (e.key === '2') handleGrade(Grade.Hard);
      else if (e.key === '3') handleGrade(Grade.Good);
      else if (keyboardLayout === '4key' && e.key === '4') handleGrade(Grade.Easy);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, grading, keyboardLayout]);

  function handleSubmit() {
    if (!currentItem || phase !== 'typing') return;
    const userInput = typed.trim();
    if (!userInput) return;
    setWordsAttempted((w) => w + 1);

    const isCorrect =
      direction === 'en2cn'
        ? fuzzyMatch(userInput, currentItem.meaning_cn)
        : userInput.toLowerCase() === currentItem.word.toLowerCase();

    if (isCorrect) {
      setPhase('correct');
      setCorrectCount((c) => c + 1);
      setStreak((s) => s + 1);
    } else {
      setPhase('wrong');
      setStreak(0);
    }
  }

  function handleReveal() {
    if (!currentItem) return;
    if (phase === 'typing') setWordsAttempted((w) => w + 1);
    setPhase('revealed');
    setStreak(0);
  }

  async function handleGrade(g: Grade) {
    if (grading) return;
    if (!currentItem) return;
    if (phase === 'typing') return;
    setGrading(true);
    try {
      await reviewAndPersist(currentItem.wordId, currentItem.bookId, g);
    } catch (e) {
      console.error('[translate] review failed', e);
    } finally {
      setGrading(false);
      if (idx < items.length - 1) {
        setIdx((i) => i + 1);
      } else {
        setFinished(true);
      }
    }
  }

  function handleRetry() {
    if (!currentItem) return;
    setPhase('typing');
    setTyped('');
    if (direction === 'en2cn') playAudio(currentItem.word);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-slate-500">加载中...</span>
      </div>
    );
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

  if (items.length === 0) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-4 animate-fadeInUp">
        <div className="text-5xl animate-scaleBounce">Done</div>
        <p className="text-slate-500">暂无需要翻译的单词</p>
        <Button variant="primary" onClick={() => navigate('/today')}>
          返回今日
        </Button>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="max-w-md mx-auto mt-12 space-y-4 animate-fadeInScale">
        <div className="card-container p-6 md:p-8 text-center space-y-4">
          <div className="text-5xl animate-emptyBounce">🎉</div>
          <h2 className="text-xl md:text-2xl font-bold">翻译练习完成</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="card-container p-3">
            <p className="text-xl font-bold text-green-500">{correctCount}</p>
            <p className="text-xs text-slate-500">答对</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-orange-500">
              {Math.max(wordsAttempted - correctCount, 0)}
            </p>
            <p className="text-xs text-slate-500">答错</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-brand-600">
              {Math.round((correctCount / Math.max(wordsAttempted, 1)) * 100)}%
            </p>
            <p className="text-xs text-slate-500">正确率</p>
          </div>
        </div>
        <Button variant="primary" size="lg" onClick={() => navigate('/today')} className="w-full">
          返回今日
        </Button>
      </div>
    );
  }

  const showGradeButtons = phase === 'correct' || phase === 'wrong' || phase === 'revealed';

  return (
    <div className="max-w-2xl mx-auto space-y-4 md:space-y-5">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/today')}
          className="text-sm text-slate-500 hover:text-slate-700 transition"
        >
          ← 返回
        </button>
        <div className="flex items-center gap-3">
          {streak > 0 && (
            <span className="text-sm text-orange-500 font-bold animate-scaleBounce">
              连击 {streak}
            </span>
          )}
          <span className="text-sm text-slate-500">
            {idx + 1} / {items.length}
          </span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-500 to-purple-500 rounded-full sentence-progress-bar"
          style={{ width: `${(idx / items.length) * 100}%` }}
        />
      </div>

      {/* 翻译卡片 */}
      <div
        key={idx}
        className={clsx(
          'card-container p-6 md:p-8 relative overflow-hidden animate-fadeInUp',
          phase === 'correct' && 'ring-2 ring-emerald-500/40',
          phase === 'wrong' && 'ring-2 ring-red-500/40',
          phase === 'revealed' && 'ring-2 ring-amber-500/40',
        )}
      >
        {/* 题目展示 */}
        <div className="text-center space-y-3">
          <p className="text-xs text-slate-400 font-medium">
            {direction === 'en2cn' ? '英文 → 中文' : '中文 → 英文'}
          </p>
          <div className="flex items-center justify-center gap-2">
            <p className="text-3xl md:text-4xl font-bold text-slate-800 dark:text-slate-100">
              {direction === 'en2cn' ? currentItem?.word : currentItem?.meaning_cn}
            </p>
            {direction === 'en2cn' && (
              <button
                onClick={() => currentItem && playAudio(currentItem.word)}
                className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-lg"
                title="朗读"
              >
                🔊
              </button>
            )}
          </div>
          {direction === 'en2cn' && currentItem?.phonetic && (
            <p className="text-sm text-slate-500">{currentItem.phonetic}</p>
          )}
          <p className="text-sm text-slate-400">
            {direction === 'en2cn' ? '英文' : '中文'}
          </p>
        </div>

        {/* 输入区 / 结果区 */}
        {phase === 'typing' ? (
          <div className="mt-6 space-y-4">
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="input-base text-center text-2xl font-bold tracking-wider"
              placeholder={direction === 'en2cn' ? '输入中文翻译...' : '输入英文单词...'}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={100}
            />
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!typed.trim()}>
                确认
              </Button>
              <button
                onClick={handleReveal}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-95"
              >
                看答案
              </button>
              {direction === 'en2cn' && (
                <button
                  onClick={() => currentItem && playAudio(currentItem.word)}
                  className="px-3 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-sm hover:bg-brand-100 dark:hover:bg-brand-900/40 transition active:scale-95"
                >
                  重听
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4 animate-slideUpFade">
            {/* 结果提示 */}
            <div className="text-center space-y-2">
              <p
                className={clsx(
                  'text-base font-medium',
                  phase === 'correct'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : phase === 'wrong'
                      ? 'text-red-500'
                      : 'text-amber-600 dark:text-amber-400',
                )}
              >
                {phase === 'correct'
                  ? '翻译正确'
                  : phase === 'wrong'
                    ? '翻译错误'
                    : '答案已显示'}
              </p>
              {typed && (
                <p className="text-sm text-slate-500">
                  你的答案: <span className="font-mono font-bold">{typed}</span>
                </p>
              )}
            </div>

            {/* 标准答案 */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
              <p className="text-xs text-slate-400 font-medium">
                {direction === 'en2cn' ? '中文释义' : '英文单词'}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  {direction === 'en2cn' ? currentItem?.meaning_cn : currentItem?.word}
                </p>
                {direction === 'cn2en' && (
                  <button
                    onClick={() => currentItem && playAudio(currentItem.word)}
                    className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-sm"
                    title="朗读"
                  >
                    🔊
                  </button>
                )}
              </div>
              {direction === 'cn2en' && currentItem?.phonetic && (
                <p className="text-sm text-slate-500">{currentItem.phonetic}</p>
              )}
              {currentItem?.example && (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                  <p className="text-sm text-slate-700 dark:text-slate-200">{currentItem.example}</p>
                  {currentItem.example_cn && (
                    <p className="text-xs text-slate-500 mt-1">{currentItem.example_cn}</p>
                  )}
                </div>
              )}
            </div>

            {/* 重试按钮 (错误时) */}
            {phase === 'wrong' && (
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={handleRetry}>
                  重新翻译
                </Button>
              </div>
            )}

            {/* 评分按钮 */}
            {showGradeButtons && (
              <div className="pt-2">
                <GradeButtons layout={keyboardLayout} onGrade={handleGrade} disabled={grading} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="card-container p-3 text-center">
          <p className="text-lg font-bold text-green-500">{correctCount}</p>
          <p className="text-xs text-slate-500">正确</p>
        </div>
        <div className="card-container p-3 text-center">
          <p className="text-lg font-bold text-orange-500">{streak}</p>
          <p className="text-xs text-slate-500">连击</p>
        </div>
        <div className="card-container p-3 text-center">
          <p className="text-lg font-bold text-brand-600">
            {Math.round((correctCount / Math.max(wordsAttempted, 1)) * 100)}%
          </p>
          <p className="text-xs text-slate-500">正确率</p>
        </div>
      </div>
    </div>
  );
}
