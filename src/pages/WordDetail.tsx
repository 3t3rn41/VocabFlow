import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { getWordById } from '@/data/wordbooks';
import { loadCard } from '@/srs/engine';
import type { StoredCard } from '@/types';
import { PronunciationButton } from '@/components/word/PronunciationButton';

/** FSRS 遗忘曲线计算：保留率 = (1 + t/(9*S))^(-1) */
function computeRetention(daysSinceReview: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + daysSinceReview / (9 * stability), -1);
}

export function WordDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const wordId = id ? decodeURIComponent(id) : '';
  const word = getWordById(wordId);
  const [card, setCard] = useState<StoredCard | null>(null);
  const [curveData, setCurveData] = useState<{ day: number; retention: number }[]>([]);

  useEffect(() => {
    if (!wordId) return;
    (async () => {
      const c = await loadCard(wordId);
      setCard(c);
      if (c && c.stability > 0) {
        // 生成曲线数据：过去 7 天到未来 30 天
        const lastReview = c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now();
        const now = Date.now();
        const daysSinceReview = (now - lastReview) / (1000 * 60 * 60 * 24);
        const data: { day: number; retention: number }[] = [];
        for (let d = -7; d <= 30; d++) {
          const t = daysSinceReview + d;
          const r = computeRetention(t, c.stability);
          data.push({ day: d, retention: Math.round(r * 100) });
        }
        setCurveData(data);
      }
    })();
  }, [wordId]);

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
  const dueDate = card ? new Date(card.due) : null;
  const daysUntilDue = dueDate
    ? Math.round((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const currentRetention = card && card.stability > 0
    ? Math.round(computeRetention(
        (Date.now() - (card.updatedAt ? new Date(card.updatedAt).getTime() : Date.now())) / (1000 * 60 * 60 * 24),
        card.stability,
      ) * 100)
    : null;

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

      {/* 遗忘曲线预测 — 2.4.3 */}
      {card && card.stability > 0 && curveData.length > 0 && (
        <div className="card-container p-4 md:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-500">遗忘曲线预测</h3>
            {currentRetention !== null && (
              <span className={`text-sm font-bold ${
                currentRetention >= 80 ? 'text-emerald-500'
                  : currentRetention >= 50 ? 'text-amber-500'
                    : 'text-red-500'
              }`}>
                当前保留率 {currentRetention}%
              </span>
            )}
          </div>

          {/* SRS 状态摘要 */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-400">复习次数</p>
              <p className="text-lg font-bold text-brand-600">{card.reps}</p>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-400">错误次数</p>
              <p className="text-lg font-bold text-red-500">{card.lapses}</p>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-400">稳定性</p>
              <p className="text-lg font-bold text-emerald-500">{card.stability.toFixed(1)}</p>
            </div>
          </div>

          {/* 遗忘曲线图 */}
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={curveData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v === 0 ? '今天' : v > 0 ? `+${v}天` : `${v}天`}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={36} />
              <Tooltip
                formatter={(value) => [`${value}%`, '保留率']}
                labelFormatter={(label) => label === 0 ? '今天' : label > 0 ? `${label} 天后` : `${Math.abs(label)} 天前`}
              />
              <ReferenceLine x={0} stroke="#4f46e5" strokeWidth={1.5} strokeDasharray="4 4" label={{ value: '今天', fontSize: 10, fill: '#4f46e5' }} />
              <ReferenceLine y={90} stroke="#10b981" strokeWidth={1} strokeDasharray="2 2" label={{ value: '90%', fontSize: 10, fill: '#10b981' }} />
              {daysUntilDue !== null && daysUntilDue > 0 && daysUntilDue <= 30 && (
                <ReferenceLine
                  x={daysUntilDue}
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  label={{ value: '复习日', fontSize: 10, fill: '#f59e0b' }}
                />
              )}
              <Line
                type="monotone"
                dataKey="retention"
                stroke="#4f46e5"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* 下次复习提示 */}
          {daysUntilDue !== null && (
            <p className="text-xs text-slate-400 text-center">
              {daysUntilDue <= 0
                ? '该词已到期，建议立即复习'
                : `预计 ${daysUntilDue} 天后需要复习`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
