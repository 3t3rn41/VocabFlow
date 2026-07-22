import { useEffect, useState, useRef, useCallback } from 'react';
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
import { generateReviewQueue, reviewAndPersist } from '@/srs/engine';
import { speakWithBrowserTts, isAudioUnlocked, onAudioUnlock } from '@/api/tts';
import { clsx } from 'clsx';

type Phase = 'listening' | 'revealed' | 'correct' | 'wrong';

export function Dictation() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const keyboardLayout = useSettingsStore((s) => s.keyboardLayout);
  const shuffleWords = useSettingsStore((s) => s.shuffleWords);
  const navigate = useNavigate();

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('listening');
  const [typed, setTyped] = useState('');
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [hintCount, setHintCount] = useState(0);
  const [wordsAttempted, setWordsAttempted] = useState(0);
  const [firstAttemptDone, setFirstAttemptDone] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // 生成听写队列
  useEffect(() => {
    if (!activeBookId) {
      setLoading(false);
      return;
    }
    setIdx(0);
    setPhase('listening');
    setTyped('');
    setFinished(false);
    setHintCount(0);
    setWordsAttempted(0);
    setFirstAttemptDone(false);
    setCorrectCount(0);
    setStreak(0);
    setLoading(true);
    (async () => {
      try {
        const queue = await generateReviewQueue(activeBookId, 200, shuffleWords);
        setItems(queue);
      } catch (e) {
        console.error('[dictation] generate queue failed', e);
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

  // 新词加载时自动播放
  useEffect(() => {
    if (!currentItem || finished) return;
    setPhase('listening');
    setTyped('');
    setHintCount(0);
    setFirstAttemptDone(false);
    const cleanup = playAudio(currentItem.word);
    setTimeout(() => inputRef.current?.focus(), 100);
    return cleanup;
  }, [currentItem, finished, playAudio]);

  // 键盘快捷键
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (currentItem) playAudio(currentItem.word);
        return;
      }
      if (phase === 'revealed' || phase === 'correct' || phase === 'wrong') {
        if (grading) return;
        if (e.key === '1') handleGrade(Grade.Again);
        else if (e.key === '2') handleGrade(Grade.Hard);
        else if (e.key === '3') handleGrade(Grade.Good);
        else if (keyboardLayout === '4key' && e.key === '4') handleGrade(Grade.Easy);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, grading, keyboardLayout, currentItem]);

  function handleSubmit() {
    if (!currentItem || phase !== 'listening') return;
    const userWord = typed.trim().toLowerCase();
    const targetWord = currentItem.word.toLowerCase();
    const isFirstAttempt = !firstAttemptDone;

    if (isFirstAttempt) {
      setFirstAttemptDone(true);
      setWordsAttempted((w) => w + 1);
    }

    if (userWord === targetWord) {
      setPhase('correct');
      if (isFirstAttempt) {
        setCorrectCount((c) => c + 1);
      }
      setStreak((s) => s + 1);
    } else {
      setPhase('wrong');
      setStreak(0);
    }
  }

  function handleReveal() {
    if (!currentItem) return;
    if (!firstAttemptDone) {
      setFirstAttemptDone(true);
      setWordsAttempted((w) => w + 1);
    }
    setPhase('revealed');
    setStreak(0);
  }

  function handleHint() {
    if (!currentItem || phase !== 'listening') return;
    const word = currentItem.word;
    const nextLen = Math.min(hintCount + 1, word.length);
    setHintCount(nextLen);
    setTyped(word.slice(0, nextLen));
    inputRef.current?.focus();
  }

  async function handleGrade(g: Grade) {
    if (grading) return;
    if (idx >= items.length) return;
    if (phase === 'listening') return;

    setGrading(true);
    try {
      await reviewAndPersist(currentItem!.wordId, currentItem!.bookId, g);
    } catch (e) {
      console.error('[dictation] review failed', e);
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
    setPhase('listening');
    setTyped('');
    setHintCount(0);
    playAudio(currentItem.word);
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
        <p className="text-slate-500">暂无需要听写的单词</p>
        <Button variant="primary" onClick={() => navigate('/today')}>
          返回今日
        </Button>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="max-w-md mx-auto mt-12">
        <ReviewComplete total={items.length} onBack={() => navigate('/today')} />
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="card-container p-3">
            <p className="text-xl font-bold text-green-500">{correctCount}</p>
            <p className="text-xs text-slate-500">正确</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-orange-500">{items.length - correctCount}</p>
            <p className="text-xs text-slate-500">错误</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-brand-600">
              {Math.round((correctCount / items.length) * 100)}%
            </p>
            <p className="text-xs text-slate-500">正确率</p>
          </div>
        </div>
      </div>
    );
  }

  const showGradeButtons = phase === 'revealed' || phase === 'correct' || phase === 'wrong';

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
              Streak {streak}
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

      {/* 听写卡片 */}
      <div
        key={idx}
        className={clsx(
          'card-container p-6 md:p-8 relative overflow-hidden animate-fadeInUp',
          phase === 'correct' && 'ring-2 ring-emerald-500/40',
          phase === 'wrong' && 'ring-2 ring-red-500/40',
          phase === 'revealed' && 'ring-2 ring-amber-500/40',
        )}
      >
        {/* 音频播放区 */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => currentItem && playAudio(currentItem.word)}
              className={clsx(
                'p-4 rounded-full transition active:scale-90',
                'bg-brand-100 dark:bg-brand-900/30 hover:bg-brand-200 dark:hover:bg-brand-900/50',
              )}
              title="再听一遍 (空格键)"
            >
              <span className="text-3xl font-bold text-brand-600">A</span>
            </button>
          </div>
          <p className="text-sm text-slate-400">
            {phase === 'listening'
              ? '听音频，拼写单词'
              : phase === 'correct'
                ? '拼写正确'
                : phase === 'wrong'
                  ? '拼写错误'
                  : '答案已显示'}
          </p>
        </div>

        {/* 输入区 / 结果区 */}
        {phase === 'listening' ? (
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
              placeholder="输入听到的单词..."
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={50}
            />
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!typed.trim()}>
                确认
              </Button>
              <button
                onClick={handleHint}
                className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-sm hover:bg-amber-100 dark:hover:bg-amber-900/40 transition active:scale-95"
              >
                提示
              </button>
              <button
                onClick={handleReveal}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-95"
              >
                看答案
              </button>
              <button
                onClick={() => currentItem && playAudio(currentItem.word)}
                className="px-3 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-sm hover:bg-brand-100 dark:hover:bg-brand-900/40 transition active:scale-95"
              >
                重听
              </button>
            </div>
            {!isAudioUnlocked() && (
              <p className="text-center text-xs text-amber-500">
                点击页面任意位置以解锁音频
              </p>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4 animate-slideUpFade">
            {/* 单词显示 */}
            <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-2">
                <p className={clsx(
                  'text-3xl md:text-4xl font-bold',
                  phase === 'correct' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100',
                )}>
                  {currentItem?.word}
                </p>
                <button
                  onClick={() => currentItem && playAudio(currentItem.word)}
                  className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-lg"
                  title="朗读"
                >
                  🔊
                </button>
              </div>
              {currentItem?.phonetic && (
                <p className="text-sm text-slate-500">{currentItem.phonetic}</p>
              )}
              {phase === 'wrong' && typed && (
                <p className="text-sm text-red-400">
                  你的拼写: <span className="font-mono font-bold">{typed}</span>
                </p>
              )}
            </div>

            {/* 释义 */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
              <p className="text-xs text-slate-400 font-medium">
                {currentItem?.pos ? currentItem.pos : '释义'}
              </p>
              <p className="text-base text-slate-700 dark:text-slate-200">
                {currentItem?.meaning_cn}
              </p>
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
                  重新听写
                </Button>
              </div>
            )}

            {/* 评分按钮 */}
            {showGradeButtons && (
              <div className="pt-2">
                <GradeButtons
                  layout={keyboardLayout}
                  onGrade={handleGrade}
                  disabled={grading}
                />
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
