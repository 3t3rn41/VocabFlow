import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { speakWithBrowserTts } from '@/api/tts';
import { storage, StorageQuotaError } from '@/utils/storage';
import { clsx } from 'clsx';

/** localStorage 中存储收藏列表的 key */
const FAVORITES_KEY = 'vf_favorites';

/** 生词本条目 */
export interface FavoriteItem {
  word: string;
  meaning_cn: string;
  wordId: string;
  bookId: string;
}

/* ------------------------------------------------------------------ */
/* 收藏工具函数 — 供其他页面调用                                         */
/* ------------------------------------------------------------------ */

/** 读取收藏列表 */
export function getFavorites(): FavoriteItem[] {
  return storage.get<FavoriteItem[]>(FAVORITES_KEY) ?? [];
}

/** 添加收藏（按 wordId 去重） */
export function addFavorite(item: FavoriteItem): boolean {
  const list = getFavorites();
  if (list.some((it) => it.wordId === item.wordId)) return true;
  list.push(item);
  try {
    storage.set(FAVORITES_KEY, list);
    return true;
  } catch (e) {
    if (e instanceof StorageQuotaError) {
      console.error('[favorites] addFavorite failed: storage quota exceeded', e);
    } else {
      console.error('[favorites] addFavorite failed', e);
    }
    return false;
  }
}

/** 移除收藏（按 wordId） */
export function removeFavorite(wordId: string): void {
  const list = getFavorites().filter((it) => it.wordId !== wordId);
  try {
    storage.set(FAVORITES_KEY, list);
  } catch (e) {
    console.error('[favorites] removeFavorite failed', e);
  }
}

/** 检查某词是否已收藏 */
export function isFavorite(wordId: string): boolean {
  return getFavorites().some((it) => it.wordId === wordId);
}

/* ------------------------------------------------------------------ */
/* 生词本页面                                                          */
/* ------------------------------------------------------------------ */

export function Favorites() {
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // 加载收藏列表
  const refresh = useCallback(() => {
    setFavorites(getFavorites());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 按词或释义过滤
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return favorites;
    return favorites.filter(
      (it) =>
        it.word.toLowerCase().includes(q) || it.meaning_cn.toLowerCase().includes(q),
    );
  }, [favorites, query]);

  function handleRemove(wordId: string) {
    removeFavorite(wordId);
    refresh();
  }

  function handleSpeak(word: string) {
    speakWithBrowserTts(word, 'en-US').catch(() => {});
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-slate-500">加载中...</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 md:space-y-5">
      {/* 顶部标题区 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/today')}
          className="text-sm text-slate-500 hover:text-slate-700 transition"
        >
          ← 返回
        </button>
        <span className="text-sm text-slate-500">共 {favorites.length} 词</span>
      </div>

      <div className="card-container p-5 md:p-6 space-y-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">生词本</h1>
          <p className="text-sm text-slate-500 mt-1">收藏的难点词汇，集中攻克</p>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/review?favorites=true')}
            disabled={favorites.length === 0}
          >
            复习生词本
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/quiz?favorites=true')}
            disabled={favorites.length === 0}
          >
            选择题练习
          </Button>
        </div>

        {/* 搜索框 */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input-base text-sm"
          placeholder="搜索单词或释义..."
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>

      {/* 空状态：无收藏 */}
      {favorites.length === 0 ? (
        <div className="card-container p-6 md:p-12 text-center space-y-4 animate-fadeInScale">
          <div className="text-5xl animate-emptyBounce">📭</div>
          <p className="text-base font-medium">还没有收藏的单词</p>
          <p className="text-sm text-slate-500">
            在词库浏览或复习时，点击星标按钮可添加到生词本
          </p>
          <Button variant="primary" onClick={() => navigate('/words')}>
            去词库看看
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        /* 有收藏但搜索无结果 */
        <div className="card-container p-6 md:p-8 text-center space-y-2 animate-fadeInUp">
          <div className="text-4xl">🔍</div>
          <p className="text-base font-medium text-slate-500">没有找到匹配的单词</p>
          <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
            清除搜索
          </Button>
        </div>
      ) : (
        /* 收藏列表 */
        <div className="space-y-2 animate-fadeInUp">
          {filtered.map((item) => (
            <div
              key={item.wordId}
              className="card-container p-3 md:p-4 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
                    {item.word}
                  </p>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                  {item.meaning_cn}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleSpeak(item.word)}
                  className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition active:scale-95"
                  title="朗读"
                >
                  🔊
                </button>
                <button
                  onClick={() => handleRemove(item.wordId)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition active:scale-95"
                  title="移除"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
