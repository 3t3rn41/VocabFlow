import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWordBookStore } from '@/stores/wordBook';
import { searchWords, searchAllWords, getWordsByBook, getBookMeta, WORD_BOOKS } from '@/data/wordbooks';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { clsx } from 'clsx';

const PAGE_SIZE = 50;

/** 获取词书标题 */
function getBookTitle(bookId: string): string {
  return WORD_BOOKS.find((b) => b.id === bookId)?.title ?? bookId;
}

export function Words() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [globalSearch, setGlobalSearch] = useState(false);
  const navigate = useNavigate();

  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  const isSentenceBook = bookMeta?.kind === 'sentence';

  const results = useMemo(() => {
    if (!activeBookId && !globalSearch) return [];
    if (search.trim()) {
      if (globalSearch) {
        return searchAllWords(search);
      }
      return searchWords(activeBookId!, search);
    }
    if (globalSearch) return [];
    // 无搜索时显示全部（分页）
    const all = getWordsByBook(activeBookId!);
    return all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [activeBookId, search, page, globalSearch]);

  if (!activeBookId && !globalSearch) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-4">
        <p className="text-slate-500">请先选择一本词书</p>
        <Button variant="primary" onClick={() => navigate('/select-book')}>
          选择词书
        </Button>
      </div>
    );
  }

  if (isSentenceBook && !globalSearch) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold">单词库</h2>
        <div className="card-container p-8 text-center space-y-4">
          <p className="text-slate-500">当前词书为句子练习类型</p>
          <Button variant="primary" onClick={() => navigate('/sentences')}>
            前往句子练习
          </Button>
        </div>
      </div>
    );
  }

  const allWords = activeBookId ? getWordsByBook(activeBookId) : [];
  const totalPages = Math.ceil(allWords.length / PAGE_SIZE);

  return (
    <div className="max-w-3xl mx-auto space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold">
          {globalSearch ? '全局搜索' : '单词库'}
        </h2>
        {bookMeta && !globalSearch && (
          <span className="text-sm text-slate-500">
            共 {allWords.length} 词
          </span>
        )}
      </div>

      {/* 搜索框 + 全局搜索开关 */}
      <div className="flex items-center gap-2">
        <Input
          placeholder={globalSearch ? '跨词书搜索单词或释义...' : '搜索单词或释义...'}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="flex-1"
        />
        <button
          onClick={() => {
            setGlobalSearch((v) => !v);
            setSearch('');
            setPage(0);
          }}
          className={clsx(
            'px-3 py-2.5 rounded-lg text-sm font-medium transition whitespace-nowrap',
            globalSearch
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
          )}
          title="跨词书搜索"
        >
          全局
        </button>
      </div>

      <div className="space-y-2">
        {results.map((w) => (
          <button
            key={w.id}
            onClick={() => navigate(`/words/${encodeURIComponent(w.id)}`)}
            className="w-full text-left card-container p-3 md:p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition active:scale-[0.98]"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <span className="font-medium text-base md:text-lg">{w.word}</span>
                {w.phonetic && <span className="ml-2 md:ml-3 text-slate-400 text-xs md:text-sm">{w.phonetic}</span>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {globalSearch && (
                  <span className="text-xs text-brand-500 bg-brand-50 dark:bg-brand-900/20 px-1.5 py-0.5 rounded">
                    {getBookTitle(w.bookId)}
                  </span>
                )}
                {w.pos && (
                  <span className="text-xs text-brand-500 italic">{w.pos}</span>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-1 truncate">{w.meaning_cn}</p>
          </button>
        ))}
        {!results.length && (
          <p className="text-slate-400 text-center py-8">
            {search ? '未找到匹配的单词' : globalSearch ? '输入关键词开始跨词书搜索' : '暂无数据'}
          </p>
        )}
      </div>

      {!search && !globalSearch && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ← 上一页
          </Button>
          <span className="text-sm text-slate-500">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页 →
          </Button>
        </div>
      )}
    </div>
  );
}
