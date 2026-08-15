import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWordBookStore } from '@/stores/wordBook';
import { Grade } from '@/types';
import type { ReviewItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { generateReviewQueue, reviewAndPersist } from '@/srs/engine';
import { speakWithBrowserTts } from '@/api/tts';
import { clsx } from 'clsx';

/** 每轮配对的单词数量 */
const ROUND_SIZE = 6;
/** 游戏总时长 (秒) */
const GAME_DURATION = 60;

type Phase = 'loading' | 'playing' | 'finished';

interface Card {
  wordId: string;
  text: string;
}

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从当前 batch 构建单词卡片与释义卡片 */
function buildCards(batch: ReviewItem[]): { wordCards: Card[]; meaningCards: Card[] } {
  const wordCards: Card[] = batch.map((item) => ({
    wordId: item.wordId,
    text: item.word,
  }));
  const meaningCards: Card[] = shuffle(
    batch.map((item) => ({
      wordId: item.wordId,
      text: item.meaning_cn,
    })),
  );
  return { wordCards, meaningCards };
}

export function MatchGame() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const navigate = useNavigate();

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [currentBatch, setCurrentBatch] = useState<ReviewItem[]>([]);
  const [wordCards, setWordCards] = useState<Card[]>([]);
  const [meaningCards, setMeaningCards] = useState<Card[]>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedMeaning, setSelectedMeaning] = useState<string | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<Set<string>>(new Set());
  const [wrongPair, setWrongPair] = useState<[string, string] | null>(null);
  const [timer, setTimer] = useState(GAME_DURATION);
  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState(1);
  const [correctMatches, setCorrectMatches] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 已配对成功需要持久化的词（轮次切换或结束时统一提交） */
  const pendingReviewRef = useRef<{ item: ReviewItem; grade: Grade }[]>([]);
  /** 已处理的全部词数（用于结束统计） */
  const totalWordsRef = useRef(0);
  /** 防止重复触发下一轮 */
  const advancingRef = useRef(false);
  /** 防止重复结束 */
  const finishedRef = useRef(false);

  // 生成游戏队列
  useEffect(() => {
    if (!activeBookId) {
      setPhase('playing');
      return;
    }
    setPhase('loading');
    (async () => {
      try {
        const queue = await generateReviewQueue(activeBookId, 200, true);
        setItems(queue);
        setPhase('playing');
      } catch (e) {
        console.error('[match] generate queue failed', e);
        setPhase('playing');
      }
    })();
  }, [activeBookId]);

  // 取出下一批 6 个词
  const loadNextBatch = useCallback((allItems: ReviewItem[], roundIdx: number) => {
    const start = (roundIdx - 1) * ROUND_SIZE;
    const batch = allItems.slice(start, start + ROUND_SIZE);
    if (batch.length === 0) {
      // 没有更多词，结束游戏
      if (!finishedRef.current) {
        finishedRef.current = true;
        setPhase('finished');
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
      return;
    }
    setCurrentBatch(batch);
    const { wordCards: wc, meaningCards: mc } = buildCards(batch);
    setWordCards(wc);
    setMeaningCards(mc);
    setMatchedPairs(new Set());
    setSelectedWord(null);
    setSelectedMeaning(null);
    setWrongPair(null);
    advancingRef.current = false;
  }, []);

  // 开始游戏 / 重置游戏
  const startGame = useCallback(
    (allItems: ReviewItem[]) => {
      if (allItems.length === 0) return;
      finishedRef.current = false;
      advancingRef.current = false;
      totalWordsRef.current = 0;
      pendingReviewRef.current = [];
      setRound(1);
      setCorrectMatches(0);
      setTotalAttempts(0);
      setTimer(GAME_DURATION);
      setPhase('playing');
      loadNextBatch(allItems, 1);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimer((t) => {
          if (t <= 1) {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            if (!finishedRef.current) {
              finishedRef.current = true;
              setPhase('finished');
            }
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    },
    [loadNextBatch],
  );

  // 队列就绪后自动开始
  useEffect(() => {
    if (items.length > 0 && phase === 'playing' && currentBatch.length === 0) {
      startGame(items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 游戏结束：按正确率统一评分，对所有已配对的词调 reviewAndPersist
  useEffect(() => {
    if (phase !== 'finished') return;
    const accuracy = totalAttempts > 0 ? correctMatches / totalAttempts : 0;
    const grade: Grade = accuracy >= 0.8 ? Grade.Good : accuracy >= 0.5 ? Grade.Hard : Grade.Again;
    // 当前批次中已配对的也算入待持久化列表
    const toReview = [...pendingReviewRef.current];
    for (const item of currentBatch) {
      if (matchedPairs.has(item.wordId)) {
        toReview.push({ item, grade });
      }
    }
    // 去重 (按 wordId)
    const seen = new Set<string>();
    const deduped = toReview.filter((r) => {
      if (seen.has(r.item.wordId)) return false;
      seen.add(r.item.wordId);
      return true;
    });
    // 异步提交，不阻塞 UI
    (async () => {
      for (const { item, grade } of deduped) {
        try {
          await reviewAndPersist(item.wordId, item.bookId, grade);
        } catch (e) {
          console.error('[match] review failed', e);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 当前 batch 全部配对 → 进入下一轮
  useEffect(() => {
    if (phase !== 'playing') return;
    if (currentBatch.length === 0) return;
    if (matchedPairs.size < currentBatch.length) return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    // 当前批次所有词全部配对，记录待持久化
    const grade = Grade.Good;
    for (const item of currentBatch) {
      pendingReviewRef.current.push({ item, grade });
    }
    totalWordsRef.current += currentBatch.length;
    // 短暂延迟后进入下一轮
    window.setTimeout(() => {
      const nextRound = round + 1;
      setRound(nextRound);
      loadNextBatch(items, nextRound);
    }, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedPairs, currentBatch, phase]);

  const playAudio = useCallback((word: string) => {
    speakWithBrowserTts(word, 'en-US').catch(() => {});
  }, []);

  function handleWordClick(wordId: string) {
    if (phase !== 'playing') return;
    if (matchedPairs.has(wordId)) return;
    if (wrongPair) return;
    setSelectedWord(wordId);
    // 若已选中 meaning，立即尝试匹配
    if (selectedMeaning) {
      tryMatch(wordId, selectedMeaning);
    }
  }

  function handleMeaningClick(wordId: string) {
    if (phase !== 'playing') return;
    if (matchedPairs.has(wordId)) return;
    if (wrongPair) return;
    setSelectedMeaning(wordId);
    // 若已选中 word，立即尝试匹配
    if (selectedWord) {
      tryMatch(selectedWord, wordId);
    }
  }

  function tryMatch(wordId: string, meaningId: string) {
    setTotalAttempts((t) => t + 1);
    if (wordId === meaningId) {
      // 配对正确
      setCorrectMatches((c) => c + 1);
      setMatchedPairs((prev) => {
        const next = new Set(prev);
        next.add(wordId);
        return next;
      });
      setSelectedWord(null);
      setSelectedMeaning(null);
      // 朗读配对的单词
      const matched = currentBatch.find((i) => i.wordId === wordId);
      if (matched) playAudio(matched.word);
    } else {
      // 配对错误：500ms 红色高亮后复位
      setWrongPair([wordId, meaningId]);
      window.setTimeout(() => {
        setWrongPair(null);
        setSelectedWord(null);
        setSelectedMeaning(null);
      }, 500);
    }
  }

  // 加载中
  if (phase === 'loading') {
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

  // 游戏结束
  if (phase === 'finished') {
    const accuracy = totalAttempts > 0 ? Math.round((correctMatches / totalAttempts) * 100) : 0;
    const totalWords = totalWordsRef.current + matchedPairs.size;
    return (
      <div className="max-w-md mx-auto mt-12 space-y-4 animate-fadeInScale">
        <div className="card-container p-6 md:p-8 text-center space-y-4">
          <div className="text-5xl animate-emptyBounce">⏱️</div>
          <h2 className="text-xl md:text-2xl font-bold">配对游戏结束</h2>
          <p className="text-sm text-slate-500">
            共练习 <span className="font-bold text-brand-600">{totalWords}</span> 个单词，完成{' '}
            <span className="font-bold text-brand-600">{round}</span> 轮
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="card-container p-3">
            <p className="text-xl font-bold text-green-500">{correctMatches}</p>
            <p className="text-xs text-slate-500">配对正确</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-orange-500">
              {Math.max(totalAttempts - correctMatches, 0)}
            </p>
            <p className="text-xs text-slate-500">配对错误</p>
          </div>
          <div className="card-container p-3">
            <p className="text-xl font-bold text-brand-600">{accuracy}%</p>
            <p className="text-xs text-slate-500">正确率</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => navigate('/today')}>
            返回今日
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => startGame(items)}
            disabled={items.length === 0}
          >
            再玩一轮
          </Button>
        </div>
      </div>
    );
  }

  // 游戏进行中
  const timerColor =
    timer > 20 ? 'text-brand-600' : timer > 10 ? 'text-orange-500' : 'text-red-500';

  return (
    <div className="max-w-3xl mx-auto space-y-4 md:space-y-5">
      {/* 顶部导航 + 倒计时 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/today')}
          className="text-sm text-slate-500 hover:text-slate-700 transition"
        >
          ← 返回
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">轮次 {round}</span>
          <span className={clsx('text-2xl font-bold tabular-nums', timerColor)}>
            {timer}s
          </span>
        </div>
      </div>

      {/* 提示 */}
      <div className="card-container p-3 text-center">
        <p className="text-sm text-slate-500">
          点击单词，再点击对应的中文释义进行配对
        </p>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-slate-400">
          <span>已配对: {matchedPairs.size}/{currentBatch.length}</span>
          <span>正确: {correctMatches}</span>
          <span>错误: {Math.max(totalAttempts - correctMatches, 0)}</span>
        </div>
      </div>

      {/* 配对区：左侧单词列 + 右侧释义列 */}
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        {/* 单词列 */}
        <div className="space-y-2 md:space-y-3">
          <p className="text-xs text-slate-400 font-medium text-center">English</p>
          {wordCards.map((card) => {
            const matched = matchedPairs.has(card.wordId);
            const selected = selectedWord === card.wordId;
            const wrong = wrongPair?.[0] === card.wordId;
            return (
              <button
                key={`word-${card.wordId}`}
                disabled={matched}
                onClick={() => handleWordClick(card.wordId)}
                className={clsx(
                  'card-container w-full p-3 md:p-4 text-center transition active:scale-[0.98]',
                  'text-sm md:text-base font-medium break-all',
                  !matched && !selected && !wrong &&
                    'hover:ring-2 hover:ring-brand-400/40 hover:-translate-y-0.5',
                  selected && 'ring-2 ring-brand-500 bg-brand-50 dark:bg-brand-900/20 -translate-y-0.5',
                  matched && 'opacity-40 bg-green-50 dark:bg-green-900/20 text-green-600',
                  wrong && 'ring-2 ring-red-500 bg-red-50 dark:bg-red-900/20 animate-scaleBounce',
                )}
              >
                {card.text}
                {matched && <span className="ml-1 text-xs">✓</span>}
              </button>
            );
          })}
        </div>

        {/* 释义列 */}
        <div className="space-y-2 md:space-y-3">
          <p className="text-xs text-slate-400 font-medium text-center">中文</p>
          {meaningCards.map((card) => {
            const matched = matchedPairs.has(card.wordId);
            const selected = selectedMeaning === card.wordId;
            const wrong = wrongPair?.[1] === card.wordId;
            return (
              <button
                key={`meaning-${card.wordId}`}
                disabled={matched}
                onClick={() => handleMeaningClick(card.wordId)}
                className={clsx(
                  'card-container w-full p-3 md:p-4 text-center transition active:scale-[0.98]',
                  'text-sm md:text-base break-all',
                  !matched && !selected && !wrong &&
                    'hover:ring-2 hover:ring-brand-400/40 hover:-translate-y-0.5',
                  selected && 'ring-2 ring-brand-500 bg-brand-50 dark:bg-brand-900/20 -translate-y-0.5',
                  matched && 'opacity-40 bg-green-50 dark:bg-green-900/20 text-green-600',
                  wrong && 'ring-2 ring-red-500 bg-red-50 dark:bg-red-900/20 animate-scaleBounce',
                )}
              >
                {card.text}
                {matched && <span className="ml-1 text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
