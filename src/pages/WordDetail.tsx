import { useParams, useNavigate } from 'react-router-dom';
import { getWordById } from '@/data/wordbooks';
import { PronunciationButton } from '@/components/word/PronunciationButton';

export function WordDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const wordId = id ? decodeURIComponent(id) : '';
  const word = getWordById(wordId);

  if (!word) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center space-y-4">
        <p className="text-slate-500">未找到该单词</p>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-brand-600 hover:underline"
        >
          ← 返回
        </button>
      </div>
    );
  }

  const meanings = word.meaning_cn.split(/\s+/).filter(Boolean);

  return (
    <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 返回
        </button>
      </div>
      <div className="card-container p-5 md:p-8 space-y-4 md:space-y-6">
        <div className="flex items-center gap-3 md:gap-4">
          <h1 className="text-3xl md:text-4xl font-bold">{word.word}</h1>
          <PronunciationButton spelling={word.word} />
          {word.phonetic && <span className="text-sm text-slate-400">{word.phonetic}</span>}
        </div>

        {meanings.length > 0 && (
          <section>
            <h3 className="text-sm text-slate-500 mb-2">
              {word.pos ? `${word.pos} 释义` : '释义'}
            </h3>
            <ul className="space-y-1">
              {meanings.map((m, i) => (
                <li key={i} className="py-1 text-slate-800 dark:text-slate-100">
                  • {m}
                </li>
              ))}
            </ul>
          </section>
        )}

        {word.example && (
          <section>
            <h3 className="text-sm text-slate-500 mb-2">例句</h3>
            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg space-y-1">
              <p className="text-slate-800 dark:text-slate-100">{word.example}</p>
              {word.example_cn && (
                <p className="text-xs text-slate-500 mt-1">{word.example_cn}</p>
              )}
            </div>
          </section>
        )}

        {!word.phonetic && !word.example && (
          <p className="text-sm text-slate-400">
            该词书仅包含基本释义，暂无音标和例句数据。
          </p>
        )}
      </div>
    </div>
  );
}
