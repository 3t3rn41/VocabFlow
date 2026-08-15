import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { Grade } from '@/types';
import type { ReviewItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { generateReviewQueue, reviewAndPersist } from '@/srs/engine';
import { getWordsByBook } from '@/data/wordbooks';
import { speakWithBrowserTts, isAudioUnlocked, onAudioUnlock } from '@/api/tts';
import { clsx } from 'clsx';

type Phase = 'choosing' | 'correct' | 'wrong';

interface QuizOption {
  /** 选项对应的 meaning_cn 文本 */
  text: string;
  /** 是否为正确答案 */
  correct: boolean;
}

/** 从同一词书随机抽取干扰项，与正确释义合并后洗牌 */
function buildOptions(correctItem: ReviewItem, allWords: { meaning_cn: string }[]): QuizOption[] {
  const distractorPool = allWords.filter((w) => w.meaning_cn !== correctItem.meaning_cn);
  // Fisher-Yates 抽取 3 个干扰项
  const distractors: string[] = [];
  const pool = [...distractorPool];
  while (distractors.length < 3 && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    const picked = pool.splice(i, 1)[0];
    if (!distractors.includes(picked.meaning_cn)) {
      distractors.push(picked.meaning_cn);
    }
  }
  const options: QuizOption[] = [
    { text: correctItem.meaning_cn, correct: true },
    ...distractors.map((t) => ({ text: t, correct: false })),
  ];
  // 洗牌
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

export function Quiz() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const shuffleWords = useSettingsStore((s) => s.shuffleWords);
  const autoPlayAudio = useSettingsStore((s) => s.autoPlayAudio);
  const navigate = useNavigate();

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('choosing');
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<QuizOption[]>([]);

  /** 词书全部单词，用于生成干扰项 */
  const allWordsRef = useRef<{ meaning_cn: string }[]>([]);
  /** 防止重复进入下一题 */
  const advancingRef = useRef(false);

  // 生成选择题队列
  useEffect(() => {
    if (!activeBookId) {
      setLoading(false);
      return;
    }
    setIdx(0);
    setSelectedIdx(null);
    setPhase('choosing');
    setCorrectCount(0);
    setWrongCount(0);
    setStreak(0);
    setFinished(false);
    setLoading(true);
    (async () => {
      try {
        allWordsRef.current = getWordsByBook(activeBookId).map((w) => ({
          meaning_cn: w.meaning_cn,
        }));
        const queue = await generateReviewQueue(activeBookId, 200, shuffleWords);
        setItems(queue);
      } catch (e) {
        console.error('[quiz] generate queue failed', e);
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

  // 新题加载：生成选项 + 自动播放
  useEffect(() => {
    if (!currentItem || finished) return;
    setPhase('choosing');
    setSelectedIdx(null);
    setOptions(buildOptions(currentItem, allWordsRef.current));
    advancingRef.current = false;
    if (autoPlayAudio) {
      const cleanup = playAudio(currentItem.word);
      return cleanup;
    }
  }, [currentItem, finished, autoPlayAudio, playAudio]);

  // 键盘 1-4 选答
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (phase !== 'choosing') return;
      const num = Number(e.key);
      if (num >= 1 && num <= options.length) {
        e.preventDefault();
        handleSelect(num - 1);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, options]);

  async function handleSelect(optionIdx: number) {
    if (phase !== 'choosing' || !currentItem) return;
    setSelectedIdx(optionIdx);
    const option = options[optionIdx];
    if (!option) return;

    if (option.correct) {
      setPhase('correct');
      setCorrectCount((c) => c + 1);
      setStreak((s) => s + 1);
      try {
        await reviewAndPersist(currentItem.wordId, currentItem.bookId, Grade.Good);
      } catch (e) {
        console.error('[quiz] review (correct) failed', e);
      }
    } else {
      setPhase('wrong');
      setWrongCount((w) => w + 1);
      setStreak(0);
      try {
        await reviewAndPersist(currentItem.wordId, currentItem.bookId, Grade.Again);
      } catch (e) {
        console.error('[quiz] review (wrong) failed', e);
      }
    }

    // 2 秒后自动进入下一题
    window.setTimeout(() => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      if (idx < items.length - 1) {
        setIdx((i) => i + 1);
      } else {
        setFinished(true);
      }
    }, 2000);
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
        <p className="text-slate-500">暂无需要练习的单词</p>
        <Button variant="primary" onClick={() => navigate('/today')}>
          返回今日
        </Button>
      </div>
    );
  }

  if (finished) {
    const total = correctCount + wrongCount;
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <div className="max-w-md mx-auto mt-12 space-y-4 animate-fadeInScale">
        <div className="card-container p-6 md:p-8 text-center space-y-4">
          <div className="text-5xl animate-emptyBounce">🎉</div>
          <h2 className="text-xl md:text-2xl font-bold">选择题练习完成</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="card-container p-3">
            <p className="text-xl font-bold text-green-500">{correctCount}</p>
            <p className="text-xs text-slate-500">答对</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-orange-500">{wrongCount}</p>
            <p className="text-xs text-slate-500">答错</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-brand-600">{accuracy}%</p>
            <p className="text-xs text-slate-500">正确率</p>
          </div>
        </div>
        <Button variant="primary" size="lg" onClick={() => navigate('/today')} className="w-full">
          返回今日
        </Button>
      </div>
    );
  }

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

      {/* 题目卡片 */}
      <div
        key={idx}
        className={clsx(
          'card-container p-6 md:p-8 relative overflow-hidden animate-fadeInUp',
          phase === 'correct' && 'ring-2 ring-emerald-500/40',
          phase === 'wrong' && 'ring-2 ring-red-500/40',
        )}
      >
        {/* 单词展示 */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <p className="text-3xl md:text-4xl font-bold text-slate-800 dark:text-slate-100">
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
          <p className="text-sm text-slate-400">选择正确的中文释义</p>
        </div>

        {/* 选项区 */}
        <div className="mt-6 grid gap-2 md:gap-3">
          {options.map((opt, i) => {
            const isSelected = selectedIdx === i;
            const showCorrect = phase !== 'choosing' && opt.correct;
            const showWrong = phase === 'wrong' && isSelected && !opt.correct;
            return (
              <button
                key={`${idx}-${i}`}
                disabled={phase !== 'choosing'}
                onClick={() => handleSelect(i)}
                className={clsx(
                  'rounded-xl py-3 md:py-4 px-3 md:px-4 text-left transition active:scale-[0.98]',
                  'flex items-center gap-3 disabled:cursor-default',
                  phase === 'choosing' &&
                    'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200',
                  showCorrect && 'bg-green-500 text-white animate-scaleBounce',
                  showWrong && 'bg-red-500 text-white animate-scaleBounce',
                  phase !== 'choosing' && !showCorrect && !showWrong &&
                    'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 opacity-70',
                )}
              >
                <span
                  className={clsx(
                    'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold',
                    phase === 'choosing' &&
                      'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300',
                    showCorrect && 'bg-white/30 text-white',
                    showWrong && 'bg-white/30 text-white',
                    phase !== 'choosing' && !showCorrect && !showWrong &&
                      'bg-white dark:bg-slate-800 text-slate-400',
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-base">{opt.text}</span>
                {showCorrect && <span className="text-lg">✓</span>}
                {showWrong && <span className="text-lg">✗</span>}
              </button>
            );
          })}
        </div>

        {/* 反馈提示 */}
        {phase !== 'choosing' && (
          <div className="mt-4 text-center animate-slideUpFade">
            <p
              className={clsx(
                'text-sm font-medium',
                phase === 'correct' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500',
              )}
            >
              {phase === 'correct' ? '正确' : '错误'}
              <span className="ml-2 text-slate-400">2 秒后进入下一题...</span>
            </p>
          </div>
        )}
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="card-container p-3 text-center">
          <p className="text-lg font-bold text-green-500">{correctCount}</p>
          <p className="text-xs text-slate-500">答对</p>
        </div>
        <div className="card-container p-3 text-center">
          <p className="text-lg font-bold text-orange-500">{wrongCount}</p>
          <p className="text-xs text-slate-500">答错</p>
        </div>
        <div className="card-container p-3 text-center">
          <p className="text-lg font-bold text-brand-600">
            {Math.round((correctCount / Math.max(correctCount + wrongCount, 1)) * 100)}%
          </p>
          <p className="text-xs text-slate-500">正确率</p>
        </div>
      </div>
    </div>
  );
}
