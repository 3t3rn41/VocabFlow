import { clsx } from 'clsx';
import type { PronunciationResult, ComparisonWord } from '@/utils/pronunciationScore';
import { getScoreColor, getScoreLabel } from '@/utils/pronunciationScore';

interface PronunciationResultPanelProps {
  result: PronunciationResult;
  onRetry: () => void;
  onAccept: () => void;
  accepted?: boolean;
}

/** 单词状态配置：颜色 + 图标 + 中文标签 */
const STATUS_CONFIG: Record<
  ComparisonWord['status'],
  { bg: string; text: string; border: string; icon: string; label: string }
> = {
  correct: {
    bg: 'bg-emerald-500',
    text: 'text-white',
    border: 'border-emerald-600',
    icon: '✓',
    label: '正确',
  },
  wrong: {
    bg: 'bg-amber-400',
    text: 'text-white',
    border: 'border-amber-500',
    icon: '≈',
    label: '近似',
  },
  missed: {
    bg: 'bg-red-500',
    text: 'text-white',
    border: 'border-red-600',
    icon: '✗',
    label: '遗漏',
  },
  extra: {
    bg: 'bg-slate-400',
    text: 'text-white',
    border: 'border-slate-500',
    icon: '+',
    label: '多余',
  },
};

/**
 * 单词卡片
 *
 * - correct: 绿色卡片，显示目标词
 * - wrong: 橙色卡片，上方显示目标词（删除线），下方显示你说出的词
 * - missed: 红色卡片，显示目标词（删除线），提示"未说出"
 * - extra: 灰色卡片，显示你说出的词，标注"多余"
 */
function WordCard({ word }: { word: ComparisonWord }) {
  const cfg = STATUS_CONFIG[word.status];

  if (word.status === 'wrong') {
    // 近似词：同时展示目标词和识别词
    return (
      <div
        className={clsx(
          'inline-flex flex-col items-stretch rounded-lg border-2 overflow-hidden mr-2 mb-2 shadow-sm',
          cfg.border,
        )}
      >
        <div className={clsx('px-2.5 py-1 text-xs font-medium flex items-center gap-1', cfg.bg, cfg.text)}>
          <span className="text-[10px] opacity-80">{cfg.icon}</span>
          <span className="line-through opacity-80">{word.target}</span>
        </div>
        <div className="px-2.5 py-1 text-sm font-bold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200">
          {word.recognized}
        </div>
      </div>
    );
  }

  if (word.status === 'missed') {
    return (
      <div
        className={clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 mr-2 mb-2 shadow-sm',
          cfg.border,
          cfg.bg,
          cfg.text,
        )}
      >
        <span className="text-sm font-bold">{cfg.icon}</span>
        <span className="text-sm font-medium line-through opacity-90">{word.target}</span>
      </div>
    );
  }

  if (word.status === 'extra') {
    return (
      <div
        className={clsx(
          'inline-flex flex-col items-center rounded-lg border-2 mr-2 mb-2 shadow-sm',
          cfg.border,
        )}
      >
        <div className={clsx('px-2.5 py-0.5 text-[10px] font-medium', cfg.bg, cfg.text)}>
          多余
        </div>
        <div className="px-2.5 py-1 text-sm font-medium bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          {word.recognized}
        </div>
      </div>
    );
  }

  // correct
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 mr-2 mb-2 shadow-sm',
        cfg.border,
        cfg.bg,
        cfg.text,
      )}
    >
      <span className="text-sm font-bold">{cfg.icon}</span>
      <span className="text-sm font-semibold">{word.target}</span>
    </div>
  );
}

export function PronunciationResultPanel({
  result,
  onRetry,
  onAccept,
  accepted = false,
}: PronunciationResultPanelProps) {
  const scoreColor = getScoreColor(result.score);
  const scoreLabel = getScoreLabel(result.score);

  const wrongCount = result.comparison.filter((c) => c.status === 'wrong').length;
  const missedCount = result.comparison.filter((c) => c.status === 'missed').length;
  const extraCount = result.comparison.filter((c) => c.status === 'extra').length;

  return (
    <div className="space-y-4 animate-slideUpFade">
      {/* 分数展示 */}
      <div className="flex items-center justify-center gap-4">
        <div className="relative w-20 h-20 flex items-center justify-center">
          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40" cy="40" r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-slate-200 dark:text-slate-700"
            />
            <circle
              cx="40" cy="40" r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
              className={scoreColor}
              strokeDasharray={2 * Math.PI * 34}
              strokeDashoffset={2 * Math.PI * 34 * (1 - result.score / 100)}
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <span className={clsx('absolute text-xl font-bold', scoreColor)}>
            {result.score}
          </span>
        </div>
        <div className="text-left">
          <p className={clsx('text-lg font-bold', scoreColor)}>{scoreLabel}</p>
          <p className="text-xs text-slate-400">
            {result.correctCount}/{result.totalWords} 词正确
          </p>
          <p className="text-xs text-slate-400">
            置信度 {Math.round(result.confidence * 100)}%
          </p>
        </div>
      </div>

      {/* 统计摘要 */}
      <div className="flex items-center justify-center gap-4 text-sm">
        {result.correctCount > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            正确 {result.correctCount}
          </span>
        )}
        {wrongCount > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            近似 {wrongCount}
          </span>
        )}
        {missedCount > 0 && (
          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            遗漏 {missedCount}
          </span>
        )}
        {extraCount > 0 && (
          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            多余 {extraCount}
          </span>
        )}
      </div>

      {/* 逐词对比 */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30">
        <p className="text-xs text-slate-400 mb-3 font-medium">
          📖 逐词对比
          <span className="ml-2 text-slate-300 dark:text-slate-500">（绿色=正确 · 橙色=近似 · 红色=遗漏 · 灰色=多余）</span>
        </p>
        <div className="flex flex-wrap items-start">
          {result.comparison.map((word, i) => (
            <WordCard key={i} word={word} />
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      {!accepted && (
        <div className="flex justify-center gap-2 pt-1">
          <button
            onClick={onRetry}
            className="px-4 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-95"
          >
            🔄 再试一次
          </button>
          <button
            onClick={onAccept}
            className="px-4 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-sm hover:bg-brand-100 dark:hover:bg-brand-900/40 transition active:scale-95"
          >
            确认结果
          </button>
        </div>
      )}
    </div>
  );
}
