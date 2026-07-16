import { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useWordBookStore } from '@/stores/wordBook';
import { getBookMeta } from '@/data/wordbooks';
import { getBookStats, loadReviewLogs, loadAllCards } from '@/srs/engine';
import { sentenceApi, type SentenceStats, type SentenceProficiencyHistory } from '@/api/client';
import { useIsMobile } from '@/hooks/useIsMobile';
import { daysAgoBJ, toBJDate } from '@/utils/date';

export function Stats() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const isMobile = useIsMobile();
  const [dailyData, setDailyData] = useState<{ date: string; count: number }[]>([]);
  const [totalLearned, setTotalLearned] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [streakDays, setStreakDays] = useState(0);

  // 句子模式专用
  const [sentenceStats, setSentenceStats] = useState<SentenceStats | null>(null);
  const [proficiencyHistory, setProficiencyHistory] = useState<SentenceProficiencyHistory | null>(null);

  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  const isSentenceBook = bookMeta?.kind === 'sentence';

  useEffect(() => {
    (async () => {
      try {
        if (isSentenceBook) {
          // 句子模式统计
          const [sStats, profHistory] = await Promise.all([
            sentenceApi.getStats(),
            sentenceApi.getProficiencyHistory(),
          ]);
          setSentenceStats(sStats);
          setProficiencyHistory(profHistory);
          setReviewsTotal(sStats.totalPractices);
          setStreakDays(sStats.streakDays);
          setTotalLearned(sStats.learnedSentences);

          // 构建每日练习量数据
          const dailyMap = new Map<string, number>();
          for (const d of profHistory.daily) {
            dailyMap.set(d.date, d.count);
          }
          const data: { date: string; count: number }[] = [];
          for (let i = 29; i >= 0; i--) {
            const d = daysAgoBJ(i);
            data.push({ date: d.slice(5), count: dailyMap.get(d) ?? 0 });
          }
          setDailyData(data);
        } else {
          // 单词模式统计
          const [logs, allCards] = await Promise.all([
            loadReviewLogs(),
            loadAllCards(),
          ]);

          setReviewsTotal(logs.length);

          const activityDates = new Map<string, number>();
          for (const log of logs) {
            try {
              const d = toBJDate(log.reviewedAt);
              activityDates.set(d, (activityDates.get(d) ?? 0) + 1);
            } catch { /* skip */ }
          }

          const days = 30;
          const data: { date: string; count: number }[] = [];
          for (let i = days - 1; i >= 0; i--) {
            const d = daysAgoBJ(i);
            data.push({ date: d.slice(5), count: activityDates.get(d) ?? 0 });
          }
          setDailyData(data);

          let streak = 0;
          for (let i = 0; i < 365; i++) {
            const d = daysAgoBJ(i);
            if (activityDates.has(d)) {
              streak++;
            } else if (i > 0) {
              break;
            }
          }
          setStreakDays(streak);

          if (activeBookId) {
            const stats = await getBookStats(activeBookId);
            setTotalLearned(stats.learned);
            setTotalWords(stats.total);
          } else {
            setTotalLearned(Object.keys(allCards).length);
            setTotalWords(0);
          }
        }
      } catch (e) {
        console.warn('[stats] load failed', e);
      }
    })();
  }, [activeBookId, isSentenceBook]);

  return (
    <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
      <h2 className="text-xl md:text-2xl font-bold">学习统计</h2>

      {/* 统计概览 */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="card-container p-3 md:p-4 text-center">
          <p className="text-2xl md:text-3xl font-bold text-brand-600">{totalLearned}</p>
          <p className="text-xs text-slate-500 mt-1">
            {isSentenceBook ? '已学句子' : '已学单词'}
          </p>
        </div>
        <div className="card-container p-3 md:p-4 text-center">
          <p className="text-2xl md:text-3xl font-bold text-brand-600">{reviewsTotal}</p>
          <p className="text-xs text-slate-500 mt-1">
            {isSentenceBook ? '总练习' : '总复习'}
          </p>
        </div>
        <div className="card-container p-3 md:p-4 text-center">
          <p className="text-2xl md:text-3xl font-bold text-brand-600">{streakDays}</p>
          <p className="text-xs text-slate-500 mt-1">坚持天数</p>
        </div>
      </div>

      {/* 句子模式：平均熟练度 */}
      {isSentenceBook && sentenceStats && (
        <div className="card-container p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-500">平均熟练度</h3>
            <span className="text-sm font-mono">
              <span className="text-emerald-600 font-bold">{sentenceStats.avgProficiency}</span>
              <span className="text-slate-400"> / 100</span>
            </span>
          </div>
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${sentenceStats.avgProficiency}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            今日练习 {sentenceStats.practicedToday} 句
          </p>
        </div>
      )}

      {/* 词书进度 (仅单词模式) */}
      {!isSentenceBook && totalWords > 0 && (
        <div className="card-container p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-500">词书进度</h3>
            <span className="text-sm font-mono">
              <span className="text-brand-600 font-bold">{totalLearned}</span>
              <span className="text-slate-400"> / {totalWords}</span>
            </span>
          </div>
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all"
              style={{
                width: `${totalWords > 0 ? (totalLearned / totalWords) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 近30天练习/复习量 */}
      <div className="card-container p-4 md:p-6">
        <h3 className="text-sm font-medium text-slate-500 mb-4">
          近 30 天{isSentenceBook ? '练习量' : '复习量'}
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyData}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
            <Tooltip />
            <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 句子模式：熟练度趋势 */}
      {isSentenceBook && proficiencyHistory && proficiencyHistory.daily.length > 0 && (
        <div className="card-container p-4 md:p-6">
          <h3 className="text-sm font-medium text-slate-500 mb-4">熟练度趋势 (近30天)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={proficiencyHistory.daily.map((d) => ({
                date: d.date.slice(5),
                proficiency: d.avgProficiency,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value) => [`${value}`, '熟练度']}
              />
              <Line
                type="monotone"
                dataKey="proficiency"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 句子模式：最近练习记录 */}
      {isSentenceBook && proficiencyHistory && proficiencyHistory.recent.length > 0 && (
        <div className="card-container p-4 md:p-6">
          <h3 className="text-sm font-medium text-slate-500 mb-4">最近练习记录</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {proficiencyHistory.recent.slice(0, 20).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 font-mono">
                    B{r.band}:{r.topicIdx}:{r.dialogueIdx}
                  </span>
                  <div className="flex gap-2 text-xs text-slate-400">
                    {r.tabCount > 0 && <span>{isMobile ? '提示' : 'Tab'}: {r.tabCount}</span>}
                    {r.typoCount > 0 && <span>错: {r.typoCount}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        r.proficiency >= 85
                          ? 'bg-emerald-500'
                          : r.proficiency >= 60
                            ? 'bg-amber-500'
                            : 'bg-red-400'
                      }`}
                      style={{ width: `${r.proficiency}%` }}
                    />
                  </div>
                  <span className={`text-xs font-bold w-7 text-right ${
                    r.proficiency >= 85
                      ? 'text-emerald-500'
                      : r.proficiency >= 60
                        ? 'text-amber-500'
                        : 'text-red-400'
                  }`}>
                    {r.proficiency}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(r.practicedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
