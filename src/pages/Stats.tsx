import { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
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

  // 热力图 & 雷达图
  const [heatmapRange, setHeatmapRange] = useState<3 | 6 | 12>(3);
  const [heatmapData, setHeatmapData] = useState<Map<string, number>>(new Map());
  const [radarData, setRadarData] = useState<{ dimension: string; value: number }[]>([]);

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

  // 计算热力图数据
  useEffect(() => {
    (async () => {
      try {
        const logs = await loadReviewLogs();
        const days = heatmapRange * 30;
        const map = new Map<string, number>();
        for (const log of logs) {
          try {
            const d = toBJDate(log.reviewedAt);
            map.set(d, (map.get(d) ?? 0) + 1);
          } catch { /* skip */ }
        }
        // 句子练习也计入
        if (isSentenceBook) {
          const profHistory = await sentenceApi.getProficiencyHistory();
          for (const d of profHistory.daily) {
            map.set(d.date, (map.get(d.date) ?? 0) + d.count);
          }
        }
        setHeatmapData(map);
      } catch { /* skip */ }
    })();
  }, [heatmapRange, isSentenceBook]);

  // 计算雷达图数据
  useEffect(() => {
    (async () => {
      try {
        const allCards = await loadAllCards();
        const logs = await loadReviewLogs();
        const cardValues = Object.values(allCards);

        // 单词认读: 已学词占比
        const learnedCount = cardValues.length;
        const recognition = totalWords > 0 ? Math.round((learnedCount / totalWords) * 100) : 0;

        // 听写/复习正确率: Good+Easy 占比
        const goodCount = logs.filter((l) => l.grade >= 2).length;
        const accuracy = logs.length > 0 ? Math.round((goodCount / logs.length) * 100) : 0;

        // 句子熟练度
        const sentenceProf = sentenceStats?.avgProficiency ?? 0;

        // 掌握度: state >= 2 (Review) 的卡片占比
        const masteredCount = cardValues.filter((c) => c.state >= 2).length;
        const mastery = learnedCount > 0 ? Math.round((masteredCount / learnedCount) * 100) : 0;

        // 稳定性平均 (转化为 0-100)
        const avgStability = cardValues.length > 0
          ? Math.min(100, Math.round(cardValues.reduce((s, c) => s + c.stability, 0) / cardValues.length))
          : 0;

        setRadarData([
          { dimension: '单词认读', value: recognition },
          { dimension: '复习正确率', value: accuracy },
          { dimension: '掌握程度', value: mastery },
          { dimension: '记忆稳定性', value: avgStability },
          { dimension: '句子熟练度', value: sentenceProf },
        ]);
      } catch { /* skip */ }
    })();
  }, [totalWords, totalLearned, sentenceStats]);

  return (
    <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
      <div className="text-center mb-2">
      <h2 className="text-2xl md:text-3xl font-bold">学习统计</h2>
      <p className="text-sm text-slate-400 mt-1">学习数据可视化 · 趋势 · 热力图 · 能力分析</p>
    </div>

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
            <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
            平均熟练度
          </h3>
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
            <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <span className="w-1 h-4 bg-brand-500 rounded-full"></span>
            词书进度
          </h3>
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

      {/* 学习热力图 — 2.4.1 */}
      <div className="card-container p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-1 h-4 bg-brand-500 rounded-full"></span>
                  学习热力图
                </h3>
          <div className="flex gap-1">
            {([3, 6, 12] as const).map((m) => (
              <button
                key={m}
                onClick={() => setHeatmapRange(m)}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  heatmapRange === m
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                }`}
              >
                {m}月
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto pb-2">
          <HeatmapGrid data={heatmapData} days={heatmapRange * 30} />
        </div>
      </div>

      {/* 词书掌握度雷达图 — 2.4.2 */}
      {radarData.length > 0 && (
        <div className="card-container p-4 md:p-6">
          <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
          能力分布雷达图
        </h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12, fill: '#64748b' }} />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Radar
                dataKey="value"
                stroke="#4f46e5"
                fill="#4f46e5"
                fillOpacity={0.25}
                strokeWidth={2}
              />
              <Tooltip
                formatter={(value) => [`${value}%`, '得分']}
              />
            </RadarChart>
          </ResponsiveContainer>
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
          <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
          熟练度趋势 (近30天)
        </h3>
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
          <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-amber-500 rounded-full"></span>
          最近练习记录
        </h3>
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

/* ------------------------------------------------------------------ */
/* 热力图网格组件 — 2.4.1                                              */
/* ------------------------------------------------------------------ */

function HeatmapGrid({ data, days }: { data: Map<string, number>; days: number }) {
  // 生成过去 N 天的日期数组
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(daysAgoBJ(i));
  }

  // 按周分组（每周 7 天，周日为一周起始）
  const weeks: string[][] = [];
  let currentWeek: string[] = [];

  // 对齐到周日：填充前导空位
  const firstDate = new Date(dates[0] + 'T00:00:00+08:00');
  const dayOfWeek = firstDate.getDay(); // 0=周日
  for (let i = 0; i < dayOfWeek; i++) {
    currentWeek.push('');
  }

  for (const d of dates) {
    currentWeek.push(d);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  // 颜色等级
  function getColor(count: number): string {
    if (count === 0) return 'bg-slate-100 dark:bg-slate-800';
    if (count <= 4) return 'bg-brand-200 dark:bg-brand-900';
    if (count <= 9) return 'bg-brand-400 dark:bg-brand-700';
    return 'bg-brand-600 dark:bg-brand-500';
  }

  // 月份标签
  const monthLabels: { month: string; weekIndex: number }[] = [];
  let lastMonth = '';
  weeks.forEach((week, i) => {
    for (const d of week) {
      if (!d) continue;
      const m = d.slice(0, 7); // YYYY-MM
      if (m !== lastMonth) {
        monthLabels.push({ month: d.slice(5, 7) + '月', weekIndex: i });
        lastMonth = m;
        break;
      }
    }
  });

  const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div className="inline-block">
      {/* 月份标签 */}
      <div className="flex ml-8 mb-1">
        {weeks.map((_, i) => {
          const label = monthLabels.find((m) => m.weekIndex === i);
          return (
            <div key={i} className="w-3 md:w-4 text-[10px] text-slate-400 text-center">
              {label?.month ?? ''}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1">
        {/* 星期标签 */}
        <div className="flex flex-col gap-0.5 mr-1">
          {weekdayLabels.map((d, i) => (
            <div key={i} className="h-3 md:h-4 text-[10px] text-slate-400 flex items-center">
              {i % 2 === 1 ? d : ''}
            </div>
          ))}
        </div>
        {/* 热力图网格 */}
        <div className="flex gap-0.5">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((d, di) => {
                const count = d ? (data.get(d) ?? 0) : 0;
                return (
                  <div
                    key={di}
                    className={`w-3 h-3 md:w-4 md:h-4 rounded-sm ${d ? getColor(count) : 'bg-transparent'}`}
                    title={d ? `${d}: ${count} 次` : ''}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* 图例 */}
      <div className="flex items-center gap-1.5 mt-3 ml-8">
        <span className="text-[10px] text-slate-400">少</span>
        <div className="w-3 h-3 rounded-sm bg-slate-100 dark:bg-slate-800" />
        <div className="w-3 h-3 rounded-sm bg-brand-200 dark:bg-brand-900" />
        <div className="w-3 h-3 rounded-sm bg-brand-400 dark:bg-brand-700" />
        <div className="w-3 h-3 rounded-sm bg-brand-600 dark:bg-brand-500" />
        <span className="text-[10px] text-slate-400">多</span>
      </div>
    </div>
  );
}
