import { PronunciationButton } from '@/components/word/PronunciationButton';
import { useSettingsStore } from '@/stores/settings';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useWordBookStore } from '@/stores/wordBook';
import { ossUrl } from '@/lib/oss';
import type { ReviewItem } from '@/types';
import { useState } from 'react';
import { addFavorite, isFavorite, removeFavorite } from '@/pages/Favorites';
import { useUiStore } from '@/stores/ui';

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
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [favState, setFavState] = useState(() => isFavorite(item.wordId));

  // 将释义按空格分割为多个含义
  const meanings = item.meaning_cn.split(/\s+/).filter(Boolean);

  // 构建助记图路径
  const mnemonicBookId = item.bookId || activeBookId || '';
  const mnemonicWord = item.word.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_()-]/g, '').replace(/[()/]/g, '');
  const mnemonicImgSrc = mnemonicBookId && mnemonicWord
    ? ossUrl(`/images/word_mnemonics/${mnemonicBookId}/${mnemonicWord}.webp`)
    : '';

  return (
    <div className="flex justify-center w-full h-full">
      <div
        onClick={onFlip}
        className={`flash-card w-full h-full max-h-[560px] cursor-pointer select-none relative ${flipped ? 'flipped' : ''}`}
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

          {/* 生词本按钮 */}
          <div className="w-full flex justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (favState) {
                  removeFavorite(item.wordId);
                  setFavState(false);
                  pushToast('已从生词本移除', 'info');
                } else {
                  const ok = addFavorite({
                    wordId: item.wordId,
                    word: item.word,
                    meaning_cn: item.meaning_cn,
                    bookId: item.bookId || activeBookId || '',
                  });
                  if (ok) {
                    setFavState(true);
                    pushToast('已加入生词本', 'success');
                  } else {
                    pushToast('加入失败', 'error');
                  }
                }
              }}
              className={favState ? 'text-amber-500' : 'text-slate-300 dark:text-slate-500'}
              title={favState ? '取消收藏' : '加入生词本'}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill={favState ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          </div>

          <div className="space-y-2 text-left max-w-full w-full pt-3 border-t border-slate-200 dark:border-slate-700">
            {/* 词性 + 释义 */}
            {meanings.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-slate-400 font-medium">
                  {item.pos ? item.pos : '释义'}
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

            {/* 助记图 */}
            {mnemonicImgSrc && (
              <div className="flex justify-center pt-1">
                <img
                  src={mnemonicImgSrc}
                  alt="助记图"
                  className="max-w-[180px] md:max-w-[200px] rounded-lg shadow-sm object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  loading="lazy"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
