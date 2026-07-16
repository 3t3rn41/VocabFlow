import { PronunciationButton } from '@/components/word/PronunciationButton';
import { useSettingsStore } from '@/stores/settings';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { ReviewItem } from '@/types';

interface FlashCardProps {
  item: ReviewItem;
  flipped: boolean;
  onFlip: () => void;
}

/**
 * 复习卡片 — 数据直接来自词书 JSON，无任何 API 调用。
 * 翻转时若开启了 autoPlayAudio，自动朗读单词。
 */
export function FlashCard({ item, flipped, onFlip }: FlashCardProps) {
  const autoPlayAudio = useSettingsStore((s) => s.autoPlayAudio);
  const isMobile = useIsMobile();

  // 将释义按空格分割为多个含义
  const meanings = item.meaning_cn.split(/\s+/).filter(Boolean);

  return (
    <div className="flex justify-center w-full h-full">
      <div
        onClick={onFlip}
        className={`flash-card w-full h-full max-h-[460px] cursor-pointer select-none relative ${flipped ? 'flipped' : ''}`}
        style={{ perspective: '1200px' }}
      >
        {/* 正面 */}
        <div className="flash-card-face absolute inset-0 card-container p-5 md:p-8 flex flex-col items-center justify-center gap-3 md:gap-4 card-hover-lift">
          <PronunciationButton spelling={item.word} autoPlay={autoPlayAudio} />
          <h2 className="text-4xl md:text-5xl font-bold tracking-wide text-center break-words max-w-full">{item.word}</h2>
          {item.isNew && (
            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              新词
            </span>
          )}
          <p className="text-sm text-slate-400">
            {isMobile ? '点击卡片查看释义' : '点击或按 Space 查看释义'}
          </p>
        </div>

        {/* 反面 */}
        <div className="flash-card-face flash-card-back absolute inset-0 card-container p-5 md:p-8 flex flex-col items-center justify-start gap-2 md:gap-3 overflow-auto">
          <div className="w-full text-center">
            <p className="text-2xl md:text-3xl font-bold mb-1 text-center break-words">{item.word}</p>
            {item.phonetic && (
              <p className="text-sm text-slate-500 mb-1">{item.phonetic}</p>
            )}
            <div className="flex justify-center">
              <PronunciationButton spelling={item.word} />
            </div>
          </div>

          <div className="space-y-2 text-left max-w-full w-full pt-3 border-t border-slate-200 dark:border-slate-700">
            {/* 词性 + 释义 */}
            {meanings.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-slate-400 font-medium">
                  {item.pos ? `📖 ${item.pos}` : '📖 释义'}
                </p>
                {meanings.map((m, i) => (
                  <p key={i} className="text-base text-slate-700 dark:text-slate-200 pl-1">
                    • {m}
                  </p>
                ))}
              </div>
            )}

            {/* 例句 */}
            {item.example && (
              <div className="p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                <p className="text-xs text-slate-500 mb-0.5 font-medium">例句</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">{item.example}</p>
                {item.example_cn && (
                  <p className="text-xs text-slate-500 mt-1">{item.example_cn}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
