import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWordBookStore } from '@/stores/wordBook';
import { searchWords, getWordsByBook, getBookMeta } from '@/data/wordbooks';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

const PAGE_SIZE = 50;

export function Words() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const navigate = useNavigate();

  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  const isSentenceBook = bookMeta?.kind === 'sentence';

  const results = useMemo(() => {
    if (!activeBookId) return [];
    if (search.trim()) {
      return searchWords(activeBookId, search);
    }
    // 无搜索时显示全部（分页）
    const all = getWordsByBook(activeBookId);
    return all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [activeBookId, search, page]);

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

  if (isSentenceBook) {
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

  const allWords = getWordsByBook(activeBookId);
  const totalPages = Math.ceil(allWords.length / PAGE_SIZE);

  return (
    <div className="max-w-3xl mx-auto space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold">单词库</h2>
        {bookMeta && (
          <span className="text-sm text-slate-500">
            共 {allWords.length} 词
          </span>
        )}
      </div>
      <Input
        placeholder="搜索单词或释义..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
      />
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
              {w.pos && (
                <span className="text-xs text-brand-500 italic flex-shrink-0">{w.pos}</span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-1 truncate">{w.meaning_cn}</p>
          </button>
        ))}
        {!results.length && (
          <p className="text-slate-400 text-center py-8">
            {search ? '未找到匹配的单词' : '暂无数据'}
          </p>
        )}
      </div>
      {!search && totalPages > 1 && (
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
