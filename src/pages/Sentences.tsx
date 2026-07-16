import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSentenceBands, getBookMeta } from '@/data/wordbooks';
import { speakWithBrowserTts } from '@/api/tts';
import {
  sentenceApi,
  type SentenceProgress,
  type SentencePosition,
} from '@/api/client';
import { useUiStore } from '@/stores/ui';
import { useSettingsStore } from '@/stores/settings';
import { useWordBookStore } from '@/stores/wordBook';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { scorePronunciation, type PronunciationResult } from '@/utils/pronunciationScore';
import { PronunciationResultPanel } from '@/components/review/PronunciationResultPanel';
import {
  proficiencyToGrade,
  reviewSentence,
  generateSentenceReviewQueue,
  generateUnmasteredReviewQueue,
  type SentenceReviewItem,
} from '@/utils/sentenceSrs';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { clsx } from 'clsx';
import type { SentenceBand, SentenceTopic } from '@/types';

/* ================================================================
   类型定义
   ================================================================ */

type MasteryMap = Record<string, number[]>;

/** 当前句子的熟练度追踪数据 */
interface ProficiencyTracker {
  startTime: number;        // 开始输入时间戳
  lastInputTime: number;    // 上次输入时间戳
  totalPauseMs: number;     // 总停顿时间
  tabCount: number;         // Tab 提示次数
  typoCount: number;        // 拼错次数
  started: boolean;         // 是否已开始输入
}

function createTracker(): ProficiencyTracker {
  return {
    startTime: 0,
    lastInputTime: 0,
    totalPauseMs: 0,
    tabCount: 0,
    typoCount: 0,
    started: false,
  };
}

/** 计算熟练度评分 (0-100) */
function calcProficiency(t: ProficiencyTracker, wordCount: number): number {
  if (!t.started) return 0;
  // 基础分 100，每次扣分
  let score = 100;
  // Tab 提示：每次扣 15 分
  score -= t.tabCount * 15;
  // 拼错：每次扣 5 分
  score -= t.typoCount * 5;
  // 停顿：每秒停顿扣 2 分（超过 1.5s 算停顿）
  const pauseSeconds = t.totalPauseMs / 1000;
  score -= Math.max(0, pauseSeconds - wordCount) * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** 判断是否自动标记熟知 (proficiency >= 85) */
function shouldAutoMarkMastery(proficiency: number): boolean {
  return proficiency >= 85;
}

/* ================================================================
   工具函数
   ================================================================ */

function splitPunct(token: string): { leading: string; word: string; trailing: string } {
  const isWordChar = (ch: string) => /[a-zA-Z0-9'\u2019-]/.test(ch);
  let start = 0;
  let end = token.length;
  while (start < end && !isWordChar(token[start])) start++;
  while (end > start && !isWordChar(token[end - 1])) end--;
  if (start >= end) return { leading: '', word: '', trailing: token };
  return {
    leading: token.slice(0, start),
    word: token.slice(start, end),
    trailing: token.slice(end),
  };
}

function wordsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** 构建 band/topic 结构供后端 position 查询使用 */
function buildBandStructure(bands: SentenceBand[]): Array<{ band: number; topics: number[] }> {
  return bands.map((b) => ({
    band: b.band,
    topics: b.topics.map((t) => t.dialogues.length),
  }));
}

/* ================================================================
   子组件
   ================================================================ */

function Confetti() {
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const pieces = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${(i / 20) * 100 + Math.random() * 4}%`,
    color: colors[i % colors.length],
    delay: `${Math.random() * 0.4}s`,
    duration: `${1.0 + Math.random() * 0.8}s`,
    size: `${6 + Math.random() * 8}px`,
  }));
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            backgroundColor: p.color,
            width: p.size,
            height: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
    </div>
  );
}

function SuccessCheckmark() {
  return (
    <svg viewBox="0 0 52 52" className="w-16 h-16 animate-scaleBounce">
      <circle cx="26" cy="26" r="25" fill="none" stroke="#10b981" strokeWidth="2" className="checkmark-circle" />
      <path fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14 27l5.917 4.917L37 13" className="checkmark-check" />
    </svg>
  );
}

/* ================================================================
   词槽渲染
   ================================================================ */

interface WordSlotProps {
  targetWord: string;
  typedWord: string | undefined;
  state: 'empty' | 'typing' | 'completed';
  slotIdx: number;
}

function WordSlot({ targetWord, typedWord, state, slotIdx }: WordSlotProps) {
  const { leading, word: wordPart, trailing } = splitPunct(targetWord);
  if (!wordPart) {
    return (
      <span className="word-slot-group">
        <span className="word-punct">{targetWord}</span>
      </span>
    );
  }
  const typed = typedWord ?? '';
  return (
    <span className="word-slot-group">
      {leading && <span className="word-punct">{leading}</span>}
      {state === 'empty' && (
        <span className="word-slot word-slot-empty slot-pop-in" style={{ animationDelay: `${Math.min(slotIdx * 30, 400)}ms` }}>
          {'\u200B'}
        </span>
      )}
      {state === 'typing' && (
        <span className="word-slot word-slot-typing">
          {typed.length > 0 ? (
            typed.split('').map((char, i) => {
              const targetChar = wordPart[i];
              const isCorrect = targetChar && char.toLowerCase() === targetChar.toLowerCase();
              return (
                <span key={i} className={clsx('transition-colors duration-100', isCorrect ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')}>
                  {char}
                </span>
              );
            })
          ) : (
            <span className="opacity-0">{'\u200B'}</span>
          )}
          <span className="word-cursor" />
        </span>
      )}
      {state === 'completed' && (
        <span className={clsx('word-slot', wordsMatch(typed, wordPart) ? 'word-slot-correct' : 'word-slot-wrong')}>
          {typed || '\u200B'}
        </span>
      )}
      {trailing && <span className="word-punct">{trailing}</span>}
    </span>
  );
}

/* ================================================================
   主组件
   ================================================================ */

export function Sentences() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  const bands = getSentenceBands(activeBookId ?? undefined);

  const [selectedBand, setSelectedBand] = useState<SentenceBand | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<SentenceTopic | null>(null);
  const [dialogueIdx, setDialogueIdx] = useState(0);

  // 逐词输入模型
  const [typedWords, setTypedWords] = useState<Record<number, string>>({});
  const [activeSlotIdx, setActiveSlotIdx] = useState(0);

  const [status, setStatus] = useState<'typing' | 'success' | 'revealed'>('typing');
  const [shake, setShake] = useState(false);
  const [streak, setStreak] = useState(0);
  const [progress, setProgress] = useState<SentenceProgress>({});
  const [mastery, setMastery] = useState<MasteryMap>({});
  const [restored, setRestored] = useState(false);
  const [reviewAll, setReviewAll] = useState(false); // 是否复习全部（包括熟知）
  const [lastProficiency, setLastProficiency] = useState<number | null>(null);

  // SRS 复习模式
  const [srsReviewQueue, setSrsReviewQueue] = useState<SentenceReviewItem[] | null>(null);
  const [srsReviewIdx, setSrsReviewIdx] = useState(0);
  const [srsDueCount, setSrsDueCount] = useState(0);
  const [srsLoading, setSrsLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState<'srs' | 'unmastered' | null>(null);

  // 语音识别状态
  const [pronunciationResult, setPronunciationResult] = useState<PronunciationResult | null>(null);
  const [showPronunciationPanel, setShowPronunciationPanel] = useState(false);
  const [pronunciationAccepted, setPronunciationAccepted] = useState(false);

  // 熟练度追踪
  const trackerRef = useRef<ProficiencyTracker>(createTracker());

  const inputRef = useRef<HTMLInputElement>(null);
const slotsContainerRef = useRef<HTMLDivElement>(null);

  const pushToast = useUiStore((s) => s.pushToast);
  const autoPlayAudio = useSettingsStore((s) => s.autoPlayAudio);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  // === 加载 SRS 到期句子数量 ===
  useEffect(() => {
    if (!activeBookId || !bookMeta || bookMeta.kind !== 'sentence') return;
    generateSentenceReviewQueue(activeBookId, bands)
      .then((queue) => {
        setSrsDueCount(queue.length);
      })
      .catch(() => {});
  }, [activeBookId, bands, bookMeta, restored]);

  // === 进入 SRS 复习模式 ===
  const enterSrsReview = useCallback(async () => {
    if (!activeBookId) return;
    setSrsLoading(true);
    try {
      const queue = await generateSentenceReviewQueue(activeBookId, bands);
      if (queue.length === 0) {
        pushToast('暂无到期句子需要复习', 'info');
        return;
      }
      setReviewMode('srs');
      setSrsReviewQueue(queue);
      setSrsReviewIdx(0);
      const first = queue[0];
      const band = bands.find((b) => b.band === first.band);
      if (band && first.topicIdx < band.topics.length) {
        setSelectedBand(band);
        setSelectedTopic(band.topics[first.topicIdx]);
        setDialogueIdx(first.dialogueIdx);
        setStreak(0);
      }
    } catch (e) {
      pushToast(`加载复习队列失败: ${(e as Error).message}`, 'error');
    } finally {
      setSrsLoading(false);
    }
  }, [activeBookId, bands, pushToast]);

  // === 进入未熟知复习模式 ===
  const enterUnmasteredReview = useCallback(async () => {
    setSrsLoading(true);
    try {
      const queue = await generateUnmasteredReviewQueue(bands);
      if (queue.length === 0) {
        pushToast('暂无需要复习的未熟知句子', 'info');
        return;
      }
      setReviewMode('unmastered');
      setSrsReviewQueue(queue);
      setSrsReviewIdx(0);
      const first = queue[0];
      const band = bands.find((b) => b.band === first.band);
      if (band && first.topicIdx < band.topics.length) {
        setSelectedBand(band);
        setSelectedTopic(band.topics[first.topicIdx]);
        setDialogueIdx(first.dialogueIdx);
        setStreak(0);
      }
    } catch (e) {
      pushToast(`加载复习队列失败: ${(e as Error).message}`, 'error');
    } finally {
      setSrsLoading(false);
    }
  }, [bands, pushToast]);

  // === 退出 SRS 复习模式 ===
  const exitSrsReview = useCallback(() => {
    setSrsReviewQueue(null);
    setSrsReviewIdx(0);
    setReviewMode(null);
    setSelectedBand(null);
    setSelectedTopic(null);
    setDialogueIdx(0);
    setStreak(0);
  }, []);

  // === 从 URL 查询参数进入未熟知复习模式 ===
  useEffect(() => {
    if (!restored) return;
    const reviewParam = searchParams.get('review');
    if (reviewParam === 'unmastered' && !srsReviewQueue) {
      // 清除查询参数，避免刷新后重复触发
      setSearchParams({}, { replace: true });
      enterUnmasteredReview();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // === 初始化：加载进度 + mastery + 恢复位置 ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [prog, masteryResult, pos] = await Promise.all([
        sentenceApi.getProgress(),
        sentenceApi.getMastery(),
        sentenceApi.getPosition(buildBandStructure(bands)),
      ]);
      if (cancelled) return;
      setProgress(prog);
      setMastery(masteryResult.mastery);

      // 恢复到下一个未完成的句子
      if (pos) {
        const band = bands.find((b) => b.band === pos.band);
        if (band && pos.topicIdx < band.topics.length) {
          const topic = band.topics[pos.topicIdx];
          const dIdx = Math.min(pos.dialogueIdx, topic.dialogues.length - 1);
          setSelectedBand(band);
          setSelectedTopic(topic);
          setDialogueIdx(dIdx);
        }
      }
      setRestored(true);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topicIdx = selectedBand && selectedTopic
    ? selectedBand.topics.indexOf(selectedTopic)
    : -1;

  const currentDialogue =
    selectedTopic && dialogueIdx < selectedTopic.dialogues.length
      ? selectedTopic.dialogues[dialogueIdx]
      : null;

  const target = currentDialogue?.en ?? '';

  // === 词槽计算 ===
  const targetWords = target.trim() ? target.trim().split(' ') : [];
  const wordSlots = targetWords
    .map((token, idx) => ({ idx, token, ...splitPunct(token) }))
    .filter((t) => t.word.length > 0);
  const tokenToSlotIdx = new Map<number, number>();
  wordSlots.forEach((ws, slotIdx) => tokenToSlotIdx.set(ws.idx, slotIdx));
  const currentInput = typedWords[activeSlotIdx] ?? '';

  // === 状态计算 ===
  const isComplete = wordSlots.length > 0 && wordSlots.every((ws, i) => {
    const typed = typedWords[i] ?? '';
    return wordsMatch(typed, ws.word);
  });
  const hasInput = Object.values(typedWords).some((w) => w && w.length > 0);

  // === 当前句子是否已熟知 ===
  const masteryKey = selectedBand ? `${selectedBand.band}:${topicIdx}` : '';
  const isMastered = masteryKey && mastery[masteryKey]?.includes(dialogueIdx);

  // === 保存当前位置 ===
  useEffect(() => {
    if (!restored) return;
    if (selectedBand && topicIdx >= 0) {
      sentenceApi.savePosition({
        band: selectedBand.band,
        topicIdx,
        dialogueIdx,
      });
    }
  }, [selectedBand, topicIdx, dialogueIdx, restored]);

  // === 跳过熟知句子 ===
  const skipMastered = useCallback((fromIdx: number) => {
    if (!selectedTopic || reviewAll) return false;
    const mKey = `${selectedBand?.band}:${topicIdx}`;
    const masteredIndices = mastery[mKey] ?? [];
    for (let i = fromIdx; i < selectedTopic.dialogues.length; i++) {
      if (!masteredIndices.includes(i)) {
        if (i !== fromIdx) {
          setDialogueIdx(i);
        }
        return true;
      }
    }
    return false;
  }, [selectedTopic, selectedBand, topicIdx, mastery, reviewAll]);

  // === handleNext ===
  const handleNext = useCallback(() => {
    // SRS 复习模式：进入队列下一句
    if (srsReviewQueue) {
      if (srsReviewIdx < srsReviewQueue.length - 1) {
        const nextIdx = srsReviewIdx + 1;
        setSrsReviewIdx(nextIdx);
        const item = srsReviewQueue[nextIdx];
        const band = bands.find((b) => b.band === item.band);
        if (band && item.topicIdx < band.topics.length) {
          setSelectedBand(band);
          setSelectedTopic(band.topics[item.topicIdx]);
          setDialogueIdx(item.dialogueIdx);
        }
      } else {
        pushToast(reviewMode === 'unmastered' ? '🎉 未熟知复习完成！' : '🎉 SRS 复习完成！', 'success');
        exitSrsReview();
      }
      return;
    }

    if (!selectedTopic) return;
    if (dialogueIdx < selectedTopic.dialogues.length - 1) {
      const nextIdx = dialogueIdx + 1;
      // 检查是否需要跳过熟知句子
      if (!reviewAll) {
        const mKey = `${selectedBand?.band}:${topicIdx}`;
        const masteredIndices = mastery[mKey] ?? [];
        let target = nextIdx;
        while (target < selectedTopic.dialogues.length && masteredIndices.includes(target)) {
          target++;
        }
        if (target >= selectedTopic.dialogues.length) {
          pushToast('🎉 本话题已全部完成（含熟知跳过）！', 'success');
          setSelectedTopic(null);
          setDialogueIdx(0);
          setStreak(0);
          return;
        }
        setDialogueIdx(target);
      } else {
        setDialogueIdx(nextIdx);
      }
    } else {
      pushToast('🎉 本话题已全部完成！', 'success');
      setSelectedTopic(null);
      setDialogueIdx(0);
      setStreak(0);
    }
  }, [selectedTopic, dialogueIdx, selectedBand, topicIdx, mastery, reviewAll, pushToast, srsReviewQueue, srsReviewIdx, bands, exitSrsReview]);

  // === 成功触发 ===
  const triggerSuccess = useCallback(() => {
    setStatus('success');
    setStreak((s) => s + 1);

    // 计算并保存熟练度
    const proficiency = calcProficiency(trackerRef.current, wordSlots.length);
    setLastProficiency(proficiency);

    if (selectedBand && topicIdx >= 0) {
      const t = trackerRef.current;

      // 标记完成
      sentenceApi.markComplete(selectedBand.band, topicIdx, dialogueIdx).then(() => {
        sentenceApi.getProgress().then(setProgress).catch(() => {});
      });

      // 记录本次练习 (含熟练度数据)
      sentenceApi.logPractice({
        band: selectedBand.band,
        topicIdx,
        dialogueIdx,
        proficiency,
        pauseMs: t.totalPauseMs,
        tabCount: t.tabCount,
        typoCount: t.typoCount,
      }).catch(() => {});

      // SRS 评分（将熟练度映射为 Grade 并持久化）
      const grade = proficiencyToGrade(proficiency);
      reviewSentence(activeBookId, { band: selectedBand.band, topicIdx, dialogueIdx }, grade).catch(() => {});

      // 如果熟练度足够高，自动标记熟知
      if (shouldAutoMarkMastery(proficiency)) {
        sentenceApi.markMastery({
          band: selectedBand.band,
          topicIdx,
          dialogueIdx,
          source: 'auto',
          proficiency,
          pauseMs: t.totalPauseMs,
          tabCount: t.tabCount,
          typoCount: t.typoCount,
        }).then(() => {
          return sentenceApi.getMastery();
        }).then((result) => {
          setMastery(result.mastery);
        }).catch(() => {});
      }
    }

    if (autoPlayAudio) {
      setTimeout(() => {
        speakWithBrowserTts(target, 'en-US').catch(() => {});
      }, 300);
    }
  }, [selectedBand, topicIdx, dialogueIdx, autoPlayAudio, target, wordSlots.length, activeBookId]);

  // === 检查并前进 ===
  const advanceOrSuccess = useCallback((
    currentIdx: number,
    newTypedWords: Record<number, string>,
  ) => {
    const allCorrect = wordSlots.every((ws, i) => {
      const typed = newTypedWords[i] ?? '';
      return wordsMatch(typed, ws.word);
    });
    if (allCorrect) {
      triggerSuccess();
    } else if (currentIdx < wordSlots.length - 1) {
      setActiveSlotIdx(currentIdx + 1);
    }
  }, [wordSlots, triggerSuccess]);

  // === 语音识别 ===
  const {
    isListening,
    transcript,
    interimTranscript,
    error: srError,
    isSupported: srSupported,
    confidence: srConfidence,
    provider: srProvider,
    statusMessage: srStatusMessage,
    isDetecting: srDetecting,
    start: srStart,
    stop: srStop,
    reset: srReset,
  } = useSpeechRecognition({ lang: 'en-US' });

  // 识别结果变化时，计算评分
  useEffect(() => {
    if (!isListening && transcript) {
      const result = scorePronunciation(target, transcript, srConfidence);
      setPronunciationResult(result);
      setShowPronunciationPanel(true);
    }
  }, [isListening, transcript, target, srConfidence]);

  // 处理语音识别错误
  useEffect(() => {
    if (srError) {
      pushToast(srError, 'error');
    }
  }, [srError, pushToast]);

  // 开始/停止语音识别
  const handleMicToggle = useCallback(() => {
    if (srDetecting) {
      pushToast('正在检测语音识别支持，请稍候...', 'info');
      return;
    }
    if (!srSupported) {
      pushToast(srStatusMessage, 'error');
      return;
    }
    if (isListening) {
      srStop();
    } else {
      srReset();
      setPronunciationResult(null);
      setShowPronunciationPanel(false);
      setPronunciationAccepted(false);
      srStart();
    }
  }, [srDetecting, srSupported, srStatusMessage, isListening, srStop, srStart, srReset, pushToast]);

  // 确认发音结果（如果通过则触发成功）
  const handleAcceptPronunciation = useCallback(() => {
    setPronunciationAccepted(true);
    if (pronunciationResult?.passed && pronunciationResult.score >= 85) {
      // 高分直接标记成功
      const revealed: Record<number, string> = {};
      wordSlots.forEach((ws, i) => { revealed[i] = ws.word; });
      setTypedWords(revealed);
      setActiveSlotIdx(wordSlots.length - 1);
      triggerSuccess();
    }
  }, [pronunciationResult, wordSlots, triggerSuccess]);

  // === 重置 ===
  const resetPractice = useCallback(() => {
    setTypedWords({});
    setActiveSlotIdx(0);
    setStatus('typing');
    setShake(false);
    setLastProficiency(null);
    setPronunciationResult(null);
    setShowPronunciationPanel(false);
    setPronunciationAccepted(false);
    srReset();
    trackerRef.current = createTracker();
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [srReset]);

  useEffect(() => {
    if (selectedTopic) resetPractice();
  }, [dialogueIdx, selectedTopic, resetPractice]);

  // === 光标定位 + 移动端键盘适配 ===
  useEffect(() => {
    const input = inputRef.current;
    if (!input || status !== 'typing') return;
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);

    // 移动端：键盘弹出后将词槽滚动到可见区域
    const container = slotsContainerRef.current;
    if (!container) return;

    // 使用多次延迟滚动，确保键盘动画完成后才滚动到正确位置
    const scrollIntoView = () => {
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    // 不同移动端键盘弹出动画时间不同，分多次尝试
    const timers = [100, 300, 500].map((delay) =>
      window.setTimeout(scrollIntoView, delay),
    );

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [activeSlotIdx, status]);

  // === 全局 Enter 键 ===
  useEffect(() => {
    if (status !== 'success' && status !== 'revealed') return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleNext();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status, handleNext]);

  // === 事件处理 ===

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (status !== 'typing') return;
    const value = e.target.value.replace(/\s/g, '');
    const now = Date.now();

    // 熟练度追踪：首次输入
    if (!trackerRef.current.started) {
      trackerRef.current.started = true;
      trackerRef.current.startTime = now;
      trackerRef.current.lastInputTime = now;
    } else {
      // 计算停顿时间（超过 1.5s 算停顿）
      const gap = now - trackerRef.current.lastInputTime;
      if (gap > 1500) {
        trackerRef.current.totalPauseMs += gap - 1500; // 只记录超出部分
      }
      trackerRef.current.lastInputTime = now;
    }

    // 拼错检测
    const targetWord = wordSlots[activeSlotIdx]?.word ?? '';
    if (targetWord && value.length > 0) {
      // 检查是否有错误的字符
      const prevValue = typedWords[activeSlotIdx] ?? '';
      if (value.length > prevValue.length) {
        // 新增了字符，检查是否正确
        const newChar = value[value.length - 1];
        const expectedChar = targetWord[value.length - 1];
        if (expectedChar && newChar.toLowerCase() !== expectedChar.toLowerCase()) {
          trackerRef.current.typoCount++;
        }
      }
    }

    const newTypedWords = { ...typedWords, [activeSlotIdx]: value };
    setTypedWords(newTypedWords);

    if (targetWord && wordsMatch(value, targetWord)) {
      advanceOrSuccess(activeSlotIdx, newTypedWords);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (status === 'success' || status === 'revealed') {
        handleNext();
      } else if (status === 'typing' && isComplete) {
        handleNext();
      } else if (status === 'typing' && hasInput && !isComplete) {
        setShake(true);
        setTimeout(() => setShake(false), 400);
      }
      return;
    }

    if (status !== 'typing') return;

    if (e.key === 'Backspace') {
      const currentVal = typedWords[activeSlotIdx] ?? '';
      if (currentVal.length === 0 && activeSlotIdx > 0) {
        e.preventDefault();
        setActiveSlotIdx(activeSlotIdx - 1);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      trackerRef.current.tabCount++;
      handleHint();
    } else if (e.key === ' ') {
      e.preventDefault();
      const currentVal = typedWords[activeSlotIdx] ?? '';
      const targetWord = wordSlots[activeSlotIdx]?.word ?? '';
      if (targetWord && wordsMatch(currentVal, targetWord)) {
        advanceOrSuccess(activeSlotIdx, typedWords);
      }
    }
  }

  function handleHint() {
    if (status !== 'typing' || !currentDialogue) return;
    const hintSlotIdx = wordSlots.findIndex((ws, i) => {
      const typed = typedWords[i] ?? '';
      return !wordsMatch(typed, ws.word);
    });
    if (hintSlotIdx === -1) return;

    const correctWord = wordSlots[hintSlotIdx].word;
    const currentTyped = typedWords[hintSlotIdx] ?? '';
    let nextLen = currentTyped.length;
    if (currentTyped.length < correctWord.length) {
      let allCorrectSoFar = true;
      for (let i = 0; i < currentTyped.length; i++) {
        if (currentTyped[i].toLowerCase() !== correctWord[i].toLowerCase()) {
          allCorrectSoFar = false;
          break;
        }
      }
      if (allCorrectSoFar) {
        nextLen = currentTyped.length + 1;
      } else {
        let firstWrong = currentTyped.length;
        for (let i = 0; i < currentTyped.length; i++) {
          if (currentTyped[i].toLowerCase() !== correctWord[i].toLowerCase()) {
            firstWrong = i;
            break;
          }
        }
        nextLen = firstWrong + 1;
      }
    } else {
      nextLen = correctWord.length;
    }

    const hintedWord = correctWord.slice(0, nextLen);
    const newTypedWords = { ...typedWords, [hintSlotIdx]: hintedWord };
    setTypedWords(newTypedWords);
    setActiveSlotIdx(hintSlotIdx);
    inputRef.current?.focus();

    if (wordsMatch(hintedWord, correctWord)) {
      advanceOrSuccess(hintSlotIdx, newTypedWords);
    }
  }

  function handleReveal() {
    if (!currentDialogue) return;
    const revealed: Record<number, string> = {};
    wordSlots.forEach((ws, i) => { revealed[i] = ws.word; });
    setTypedWords(revealed);
    setActiveSlotIdx(wordSlots.length - 1);
    setStatus('revealed');
    setStreak(0);
  }

  function handlePrev() {
    if (dialogueIdx > 0) setDialogueIdx((i) => i - 1);
  }

  async function handleSpeak(text: string) {
    try {
      await speakWithBrowserTts(text, 'en-US');
    } catch (e) {
      pushToast(`发音失败: ${(e as Error).message}`, 'error');
    }
  }

  // === 手动标记/取消熟知 ===
  async function handleToggleMastery() {
    if (!selectedBand || topicIdx < 0) return;
    try {
      if (isMastered) {
        await sentenceApi.unmarkMastery(selectedBand.band, topicIdx, dialogueIdx);
        pushToast('已取消熟知标记', 'success');
      } else {
        await sentenceApi.markMastery({
          band: selectedBand.band,
          topicIdx,
          dialogueIdx,
          source: 'manual',
          proficiency: 100,
        });
        pushToast('已标记为熟知', 'success');
      }
      const result = await sentenceApi.getMastery();
      setMastery(result.mastery);
    } catch (e) {
      pushToast(`操作失败: ${(e as Error).message}`, 'error');
    }
  }

  // === 进度统计 ===
  const topicProgressKey = selectedBand ? `${selectedBand.band}:${topicIdx}` : '';
  const topicCompleted = progress[topicProgressKey]?.length ?? 0;
  const topicMastered = mastery[topicProgressKey]?.length ?? 0;
  const topicTotal = selectedTopic?.dialogues.length ?? 0;
  const topicPct = topicTotal > 0 ? (topicCompleted / topicTotal) * 100 : 0;
  const isLastSentence = selectedTopic
    ? dialogueIdx >= selectedTopic.dialogues.length - 1
    : false;

  // ================================================================
  // 练习视图
  // ================================================================

  if (selectedTopic && currentDialogue) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 md:space-y-5">
          {/* SRS 复习模式头部 */}
          {srsReviewQueue && (
            <div className="flex items-center justify-between">
              <button
                onClick={exitSrsReview}
                className="text-sm text-slate-500 hover:text-slate-700 transition"
              >
                ← 退出复习
              </button>
              <span className="text-sm text-brand-600 font-medium">
                {reviewMode === 'unmastered'
                  ? `🔄 未熟知复习 ${srsReviewIdx + 1} / ${srsReviewQueue.length}`
                  : `🔄 SRS复习 ${srsReviewIdx + 1} / ${srsReviewQueue.length}`}
              </span>
            </div>
          )}

          {/* 顶部导航 */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { 
                if (srsReviewQueue) exitSrsReview();
                else { setSelectedTopic(null); setStreak(0); }
              }}
              className="text-sm text-slate-500 hover:text-slate-700 transition"
            >
              ← {srsReviewQueue ? '退出复习' : '返回话题'}
            </button>
          <div className="flex items-center gap-3">
            {isMastered && (
              <span className="text-xs text-purple-500 font-medium bg-purple-50 dark:bg-purple-900/20 px-2 py-0.5 rounded-full">
                ⭐ 已熟知
              </span>
            )}
            {streak > 0 && (
              <span className="text-sm text-orange-500 font-bold animate-scaleBounce">
                🔥 {streak}
              </span>
            )}
            <span className="text-sm text-slate-500">
              {dialogueIdx + 1} / {selectedTopic.dialogues.length}
            </span>
          </div>
        </div>

        {/* 进度条 */}
        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-emerald-500 rounded-full sentence-progress-bar"
            style={{ width: `${topicPct}%` }}
          />
        </div>

        {/* 话题信息 */}
        <div className="text-center">
          <span className="text-xs text-slate-400">
            Band {selectedBand?.band} · {selectedBand?.level}
          </span>
          <p className="text-sm font-medium text-brand-600">{selectedTopic.topic}</p>
          {topicMastered > 0 && (
            <p className="text-xs text-purple-400 mt-0.5">⭐ {topicMastered} 句已熟知</p>
          )}
        </div>

        {/* 主练习卡片 */}
        <div
          key={dialogueIdx}
          className={clsx(
            'card-container p-5 md:p-8 relative overflow-hidden animate-fadeInUp',
            status === 'success' && 'ring-2 ring-emerald-500/40',
            status === 'revealed' && 'ring-2 ring-amber-500/40',
          )}
        >
          {status === 'success' && <Confetti />}

          {status === 'success' && (
            <div className="flex justify-center mb-4">
              <SuccessCheckmark />
            </div>
          )}

          {/* 中文句子 */}
          <div className="text-center space-y-2 mb-4 md:mb-6">
            <p className="text-xs text-slate-400 font-medium">🇨🇳 中文</p>
            <p className="text-xl md:text-2xl font-medium">{currentDialogue.cn}</p>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4 md:pt-6" />

          {status === 'success' ? (
            /* === 成功状态 === */
            <div className="space-y-4 animate-slideUpFade">
              <div className="text-center space-y-2">
                <p className="text-xs text-emerald-500 font-medium">✅ 拼写正确</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-xl text-emerald-600 dark:text-emerald-400 font-medium">
                    {target}
                  </p>
                  <button
                    onClick={() => handleSpeak(target)}
                    className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-lg"
                    title="朗读"
                  >
                    🔊
                  </button>
                </div>
              </div>

              {/* 熟练度展示 */}
              {lastProficiency !== null && (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-slate-400">熟练度:</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={clsx(
                          'h-full rounded-full transition-all',
                          lastProficiency >= 85 ? 'bg-emerald-500' : lastProficiency >= 60 ? 'bg-amber-500' : 'bg-red-400',
                        )}
                        style={{ width: `${lastProficiency}%` }}
                      />
                    </div>
                    <span className={clsx(
                      'text-xs font-bold',
                      lastProficiency >= 85 ? 'text-emerald-500' : lastProficiency >= 60 ? 'text-amber-500' : 'text-red-400',
                    )}>
                      {lastProficiency}
                    </span>
                    {lastProficiency >= 85 && (
                      <span className="text-xs text-purple-500">⭐ 自动熟知</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-2 md:gap-3 pt-2">
                <Button variant="ghost" size="sm" onClick={() => handleSpeak(target)}>
                  🔊 再听一遍
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={handleToggleMastery}
                >
                  {isMastered ? '✗ 取消熟知' : '⭐ 标记熟知'}
                </Button>
                <Button
                  variant="primary" size="sm"
                  onClick={handleNext}
                  className="pulse-glow"
                >
                  {isLastSentence ? '完成话题 🎉' : '下一句 →'}
                </Button>
              </div>
              {!isMobile && (
                <p className="text-center text-xs text-slate-400 mt-2">
                  按 Enter 继续
                </p>
              )}
            </div>
          ) : status === 'revealed' ? (
            /* === 显示答案状态 === */
            <div className="space-y-4 animate-slideUpFade">
              <div className="text-center space-y-2">
                <p className="text-xs text-amber-500 font-medium">👁 答案已显示</p>
                <div className="word-slots-display text-center">
                  {targetWords.map((word, i) => {
                    const { leading, word: wordPart, trailing } = splitPunct(word);
                    if (!wordPart) {
                      return (
                        <span key={i} className="word-slot-group">
                          <span className="word-punct">{word}</span>
                        </span>
                      );
                    }
                    return (
                      <span key={i} className="word-slot-group">
                        {leading && <span className="word-punct">{leading}</span>}
                        <span className="word-slot word-slot-revealed">{wordPart}</span>
                        {trailing && <span className="word-punct">{trailing}</span>}
                      </span>
                    );
                  })}
                </div>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    onClick={() => handleSpeak(target)}
                    className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-lg"
                    title="朗读"
                  >
                    🔊
                  </button>
                  <button
                    onClick={resetPractice}
                    className="text-sm text-brand-600 hover:underline"
                  >
                    重试
                  </button>
                </div>
              </div>
              <div className="flex justify-center pt-2">
                <Button variant="primary" size="sm" onClick={handleNext}>
                  {isLastSentence ? '完成话题 🎉' : '下一句 →'}
                </Button>
              </div>
              {!isMobile && (
                <p className="text-center text-xs text-slate-400 mt-2">
                  按 Enter 继续
                </p>
              )}
            </div>
          ) : (
            /* === 输入状态 === */
            <div className="space-y-4">
              <div
                ref={slotsContainerRef}
                className={clsx(
                  'word-slots-container',
                  shake && 'animate-shake',
                  isComplete && '!border-emerald-500',
                )}
                onClick={() => inputRef.current?.focus()}
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={currentInput}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    // 移动端：input 获得焦点时（键盘弹出），延迟滚动词槽到可见区域
                    const container = slotsContainerRef.current;
                    if (container) {
                      [100, 300, 500].forEach((delay) => {
                        setTimeout(() => {
                          container.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, delay);
                      });
                    }
                  }}
                  className="word-input-hidden"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={50}
                />
                <div className="word-slots-display">
                  {targetWords.map((word, i) => {
                    const slotIdx = tokenToSlotIdx.get(i);
                    if (slotIdx === undefined) {
                      return (
                        <WordSlot key={i} targetWord={word} typedWord={undefined} state="empty" slotIdx={0} />
                      );
                    }
                    const typed = typedWords[slotIdx];
                    let slotState: 'empty' | 'typing' | 'completed';
                    if (slotIdx < activeSlotIdx) slotState = 'completed';
                    else if (slotIdx === activeSlotIdx) slotState = 'typing';
                    else slotState = 'empty';
                    return (
                      <WordSlot key={i} targetWord={word} typedWord={typed} state={slotState} slotIdx={slotIdx} />
                    );
                  })}
                </div>
              </div>

              {!hasInput && !isListening && !showPronunciationPanel && (
                <p className="text-sm text-slate-300 dark:text-slate-600 italic text-center">
                  ✏️ 点击开始输入{isMobile ? '' : '，Tab 提示一个字母'}
                </p>
              )}

              {/* 语音识别中 — 实时反馈 */}
              {isListening && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <div className="flex items-center gap-2 text-red-500">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                    </span>
                    <span className="text-sm font-medium">正在聆听...</span>
                  </div>
                  {interimTranscript && (
                    <p className="text-sm text-slate-500 text-center italic">
                      "{interimTranscript}"
                    </p>
                  )}
                  <p className="text-xs text-slate-400">
                    点击麦克风停止识别
                    {srProvider === 'server-asr' && ' · 停止后开始识别'}
                  </p>
                </div>
              )}

              {/* 发音评分结果 */}
              {showPronunciationPanel && pronunciationResult && (
                <PronunciationResultPanel
                  result={pronunciationResult}
                  onRetry={() => {
                    setPronunciationResult(null);
                    setShowPronunciationPanel(false);
                    setPronunciationAccepted(false);
                    srReset();
                    srStart();
                  }}
                  onAccept={handleAcceptPronunciation}
                  accepted={pronunciationAccepted}
                />
              )}

              {/* 操作按钮 */}
              {!isListening && !showPronunciationPanel && (
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <button
                    onClick={handleHint}
                    className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-sm hover:bg-amber-100 dark:hover:bg-amber-900/40 transition active:scale-95"
                    title="提示一个字母"
                  >
                    💡 提示
                  </button>
                  <button
                    onClick={handleReveal}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-95"
                  >
                    👁 答案
                  </button>
                  <button
                    onClick={() => handleSpeak(target)}
                    className="px-3 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-sm hover:bg-brand-100 dark:hover:bg-brand-900/40 transition active:scale-95"
                  >
                    🔊 朗读
                  </button>
                  <button
                    onClick={handleMicToggle}
                    disabled={!srSupported}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm transition active:scale-95',
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40',
                      !srSupported && 'opacity-40 cursor-not-allowed',
                    )}
                    title={srSupported ? srStatusMessage : '浏览器不支持语音识别'}
                  >
                    {isListening ? '⏹ 停止' : '🎤 语音'}
                    {srSupported && srProvider !== 'none' && (
                      <span className="ml-1 text-xs opacity-60">
                        {srProvider === 'web-speech' ? '\uD83C\uDF10' : '\uD83D\uDCBB'}
                      </span>
                    )}
                  </button>
                  {dialogueIdx > 0 && (
                    <button
                      onClick={handlePrev}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-95"
                    >
                      ← 上一句
                    </button>
                  )}
                </div>
              )}

              {/* 识别中 — 停止按钮 */}
              {isListening && (
                <div className="flex items-center justify-center">
                  <button
                    onClick={handleMicToggle}
                    className="px-4 py-1.5 rounded-lg bg-red-500 text-white text-sm hover:bg-red-600 transition active:scale-95"
                  >
                    ⏹ 停止识别
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ================================================================
  // 话题列表视图
  // ================================================================

  if (selectedBand) {
    return (
    <div className="max-w-2xl mx-auto space-y-4 md:space-y-6 animate-fadeInUp">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setSelectedBand(null)}
          className="text-sm text-slate-500 hover:text-slate-700 transition"
        >
          ← 返回
        </button>
        <label className="flex items-center gap-2 text-xs md:text-sm text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={reviewAll}
              onChange={(e) => setReviewAll(e.target.checked)}
              className="w-4 h-4"
            />
            复习全部（含熟知）
          </label>
        </div>
        <div className="text-center">
          <h2 className="text-xl md:text-2xl font-bold">Band {selectedBand.band}</h2>
          <p className="text-slate-500">{selectedBand.level}</p>
        </div>
        <div className="space-y-3">
          {selectedBand.topics.map((topic, i) => {
            const key = `${selectedBand.band}:${i}`;
            const completed = progress[key]?.length ?? 0;
            const mastered = mastery[key]?.length ?? 0;
            const total = topic.dialogues.length;
            const pct = total > 0 ? (completed / total) * 100 : 0;
            const isDone = completed === total && total > 0;

            return (
              <button
                key={i}
                onClick={() => {
                  // 未勾选"复习全部"时，跳过熟知句子
                  if (!reviewAll) {
                    const key = `${selectedBand.band}:${i}`;
                    const masteredIndices = mastery[key] ?? [];
                    const total = topic.dialogues.length;
                    // 查找第一个未熟知的句子
                    let firstNonMastered = 0;
                    while (firstNonMastered < total && masteredIndices.includes(firstNonMastered)) {
                      firstNonMastered++;
                    }
                    if (firstNonMastered >= total) {
                      // 全部熟知，提示并跳回
                      pushToast('该话题已全部熟知，无需复习', 'info');
                      return;
                    }
                    setSelectedTopic(topic);
                    setDialogueIdx(firstNonMastered);
                    setStreak(0);
                  } else {
                    setSelectedTopic(topic);
                    setDialogueIdx(0);
                    setStreak(0);
                  }
                }}
                className="w-full text-left card-container p-4 md:p-5 hover:ring-2 hover:ring-brand-500 transition group active:scale-[0.98] card-hover-lift animate-stagger"
                style={{ animationDelay: `${(i + 1) * 50}ms` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium group-hover:text-brand-600 transition">
                    {isDone && '✅ '}
                    {topic.topic}
                  </span>
                  <span className="text-sm text-slate-400">
                    {completed} / {total}
                    {mastered > 0 && <span className="text-purple-400 ml-1">⭐{mastered}</span>}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full sentence-progress-bar',
                      isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-500 to-emerald-500',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ================================================================
  // Band 选择视图
  // ================================================================

  if (srsLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-slate-500">加载复习队列...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 md:space-y-6 animate-fadeInUp">
      <div className="text-center">
        <h2 className="text-xl md:text-2xl font-bold">句子练习</h2>
        <p className="text-slate-500 mt-1">
          {bookMeta?.title ?? '句子练习'} · 中译英拼写练习
        </p>
      </div>

      {/* SRS 复习入口 */}
      {srsDueCount > 0 && (
        <button
          onClick={enterSrsReview}
          disabled={srsLoading}
          className="w-full text-left card-container p-4 md:p-5 hover:ring-2 hover:ring-brand-500 transition group active:scale-[0.98] bg-gradient-to-r from-brand-50 to-purple-50 dark:from-brand-900/20 dark:to-purple-900/20"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔄</span>
              <div>
                <p className="font-bold text-brand-600 group-hover:text-brand-700 transition">SRS 复习</p>
                <p className="text-sm text-slate-500 mt-0.5">到期句子智能复习</p>
              </div>
            </div>
            <span className="text-lg font-bold text-orange-500 animate-scaleBounce">{srsDueCount}</span>
          </div>
        </button>
      )}

      <div className="space-y-3">
        {bands.map((band) => {
          const totalDialogues = band.topics.reduce((s, t) => s + t.dialogues.length, 0);
          const totalCompleted = band.topics.reduce((sum, _topic, topicIdx) => {
            const key = `${band.band}:${topicIdx}`;
            return sum + (progress[key]?.length ?? 0);
          }, 0);
          const totalMastered = band.topics.reduce((sum, _topic, topicIdx) => {
            const key = `${band.band}:${topicIdx}`;
            return sum + (mastery[key]?.length ?? 0);
          }, 0);
          const pct = totalDialogues > 0 ? (totalCompleted / totalDialogues) * 100 : 0;

          return (
            <button
              key={band.band}
              onClick={() => setSelectedBand(band)}
              className="w-full text-left card-container p-4 md:p-5 hover:ring-2 hover:ring-brand-500 transition group active:scale-[0.98] card-hover-lift animate-stagger"
              style={{ animationDelay: `${band.band * 60}ms` }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-lg font-bold text-brand-600 group-hover:text-brand-700 transition">
                    Band {band.band}
                  </span>
                  <span className="ml-3 text-sm text-slate-500">{band.level}</span>
                </div>
                <div className="text-sm text-slate-400">
                  {totalCompleted} / {totalDialogues} 句
                  {totalMastered > 0 && <span className="text-purple-400 ml-1">⭐{totalMastered}</span>}
                </div>
              </div>
              <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-emerald-500 rounded-full sentence-progress-bar"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-400">
                {band.topics.length} 个话题
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
