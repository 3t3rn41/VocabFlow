import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWordBookStore } from '@/stores/wordBook';
import { useSettingsStore } from '@/stores/settings';
import { getBookMeta } from '@/data/wordbooks';
import { getTodayProgress, getBookStats, loadReviewLogs } from '@/srs/engine';
import { sentenceApi, type SentenceStats } from '@/api/client';
import { getSentenceSrsStats, getUnmasteredReviewCount } from '@/utils/sentenceSrs';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ProgressRing } from '@/components/review/ProgressRing';
import { daysAgoBJ, toBJDate } from '@/utils/date';
import { clsx } from 'clsx';

export function Today() {
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const dailyNewGoal = useSettingsStore((s) => s.dailyNewGoal);
  const dailyReviewGoal = useSettingsStore((s) => s.dailyReviewGoal);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ dueCount: 0, newCount: 0, finishedToday: 0 });
  const [stats, setStats] = useState({ total: 0, learned: 0, due: 0 });
  const [streakDays, setStreakDays] = useState(0);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [sentenceStats, setSentenceStats] = useState<SentenceStats | null>(null);
  const [sentenceSrsDue, setSentenceSrsDue] = useState(0);
  const [unmasteredCount, setUnmasteredCount] = useState(0);

  const bookMeta = activeBookId ? getBookMeta(activeBookId) : null;
  const isSentenceBook = bookMeta?.kind === 'sentence';

  const load = useCallback(async () => {
    if (!activeBookId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (isSentenceBook) {
        const [sStats, srsStats] = await Promise.all([
          sentenceApi.getStats(),
          getSentenceSrsStats(activeBookId),
        ]);
        setSentenceStats(sStats);
        setSentenceSrsDue(srsStats.dueCount);
        setStreakDays(sStats.streakDays);
        setReviewsTotal(sStats.totalPractices);

        const unmastered = await getUnmasteredReviewCount();
        setUnmasteredCount(unmastered);
      } else {
        const [p, s, logs] = await Promise.all([
          getTodayProgress(activeBookId),
          getBookStats(activeBookId),
          loadReviewLogs(),
        ]);
        setProgress(p);
        setStats(s);
        setReviewsTotal(logs.length);

        const activityDates = new Set<string>();
        for (const log of logs) {
          try {
            activityDates.add(toBJDate(log.reviewedAt));
          } catch { /* skip */ }
        }
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
      }
    } catch (e) {
      console.error('[today] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [activeBookId, isSentenceBook]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-slate-500">加载中...</span>
      </div>
    );
  }

  const totalToday = progress.dueCount + progress.newCount;
  const pct = totalToday > 0
    ? Math.round((progress.finishedToday / (totalToday + progress.finishedToday)) * 100)
    : 0;

  // 每日目标进度（2.3.2）
  const goalTotal = dailyNewGoal + dailyReviewGoal;
  const goalProgress = Math.min(100, Math.round((progress.finishedToday / goalTotal) * 100));
  const goalCompleted = progress.finishedToday >= goalTotal;

  return (
    <div className="max-w-2xl mx-auto space-y-5 md:space-y-6">
      <div className="text-center">
        <h2 className="text-xl md:text-2xl font-bold mb-1">学习</h2>
        <p className="text-slate-500 text-sm">
          {new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        {bookMeta && (
          <p className="text-sm text-brand-600 mt-1">{bookMeta.title}</p>
        )}
      </div>

      {/* 每日目标进度条 — 2.3.2 */}
      {!isSentenceBook && goalTotal > 0 && (
        <div className={clsx(
          'card-container p-4 transition',
          goalCompleted && 'ring-2 ring-emerald-400',
        )}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-500">今日目标</span>
            <span className="text-sm font-mono">
              <span className={clsx('font-bold', goalCompleted ? 'text-emerald-500' : 'text-brand-600')}>
                {progress.finishedToday}
              </span>
              <span className="text-slate-400"> / {goalTotal}</span>
            </span>
          </div>
          <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all shimmer-bar',
                goalCompleted
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-brand-500 to-purple-500',
              )}
              style={{ width: `${goalProgress}%` }}
            />
          </div>
          {goalCompleted && (
            <p className="text-xs text-emerald-500 mt-1.5 text-center animate-fadeIn">
              目标已达成！
            </p>
          )}
        </div>
      )}

      {/* 主学习卡片 */}
      {isSentenceBook ? (
        <div className="card-container p-6 md:p-8 flex flex-col items-center gap-4 md:gap-6">
          <ProgressRing percentage={sentenceStats ? Math.min(100, sentenceStats.avgProficiency) : 0} size={140} />
          <div className="text-center">
            <p className="text-2xl md:text-3xl font-bold">
              {sentenceStats?.practicedToday ?? 0} <span className="text-slate-400 text-lg md:text-xl">句</span>
            </p>
            <p className="text-sm text-slate-500 mt-1">
              今日已练习 {sentenceStats?.practicedToday ?? 0} 句
            </p>
            {sentenceStats && sentenceStats.avgProficiency > 0 && (
              <p className="text-xs text-emerald-500 mt-1">
                平均熟练度 {sentenceStats.avgProficiency}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={() => navigate('/sentences')}
            >
              开始句子练习
            </Button>
            {unmasteredCount > 0 && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => navigate('/sentences?review=unmastered')}
                className="text-orange-500 ring-2 ring-orange-300 dark:ring-orange-700"
              >
                复习 {unmasteredCount}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="card-container p-6 md:p-8 flex flex-col items-center gap-4 md:gap-6">
          <ProgressRing percentage={pct} size={140} />
          <div className="text-center">
            <p className="text-2xl md:text-3xl font-bold">
              {progress.finishedToday} <span className="text-slate-400 text-xl md:text-2xl">/ {totalToday + progress.finishedToday}</span>
            </p>
            <p className="text-sm text-slate-500 mt-1">
              今日已复习 {progress.finishedToday} 个
            </p>
          </div>
          <div className="flex gap-4 md:gap-6 text-center">
            <div>
              <p className="text-xl md:text-2xl font-bold text-orange-500 animate-numberPop">{progress.dueCount}</p>
              <p className="text-xs text-slate-500">待复习</p>
            </div>
            <div>
              <p className="text-xl md:text-2xl font-bold text-green-500 animate-numberPop">{progress.newCount}</p>
              <p className="text-xs text-slate-500">新词</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={() => navigate('/review')}
              disabled={totalToday === 0 && progress.finishedToday > 0}
            >
              {totalToday === 0 && progress.finishedToday > 0
                ? '今日已完成'
                : progress.finishedToday > 0
                  ? '继续学习'
                  : '开始学习'}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => navigate('/dictation')}
            >
              听写
            </Button>
          </div>
        </div>
      )}

      {/* 练习模式快捷入口 */}
      {!isSentenceBook && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
          {[
            { to: '/quiz', label: '选择', color: 'text-emerald-600 dark:text-emerald-400' },
            { to: '/translate', label: '互译', color: 'text-amber-600 dark:text-amber-400' },
            { to: '/match', label: '配对', color: 'text-purple-600 dark:text-purple-400' },
          ].map((mode) => (
            <button
              key={mode.to}
              onClick={() => navigate(mode.to)}
              className="card-container p-3 md:p-4 text-center card-hover-lift animate-stagger"
            >
              <p className={clsx('text-base md:text-lg font-bold', mode.color)}>
                {mode.label}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* 统计概览 */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="card-container p-3 md:p-4 text-center animate-stagger" style={{ animationDelay: '0ms' }}>
          <p className="text-xl md:text-2xl font-bold text-brand-600 animate-numberPop">
            {isSentenceBook ? (sentenceStats?.learnedSentences ?? 0) : stats.learned}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {isSentenceBook ? '已学句子' : '已学单词'}
          </p>
        </div>
        <div className="card-container p-3 md:p-4 text-center animate-stagger" style={{ animationDelay: '60ms' }}>
          <p className="text-xl md:text-2xl font-bold text-brand-600 animate-numberPop">{reviewsTotal}</p>
          <p className="text-xs text-slate-500 mt-1">
            {isSentenceBook ? '总练习' : '总复习'}
          </p>
        </div>
        <div className="card-container p-3 md:p-4 text-center animate-stagger" style={{ animationDelay: '120ms' }}>
          <p className="text-xl md:text-2xl font-bold text-brand-600 animate-numberPop">{streakDays}</p>
          <p className="text-xs text-slate-500 mt-1">坚持天数</p>
        </div>
      </div>

      {/* 词书进度 */}
      {!isSentenceBook && stats.total > 0 && (
        <div className="card-container p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-500">词书进度</h3>
            <span className="text-sm font-mono">
              <span className="text-brand-600 font-bold">{stats.learned}</span>
              <span className="text-slate-400"> / {stats.total}</span>
            </span>
          </div>
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all shimmer-bar"
              style={{ width: `${stats.total > 0 ? (stats.learned / stats.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
