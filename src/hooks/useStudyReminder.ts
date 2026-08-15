/**
 * 学习提醒 Hook
 *
 * 功能：
 * - 在用户设定的提醒时间检查是否已学习
 * - 若未学习，发送浏览器通知
 * - 每天只提醒一次
 * - 请求通知权限
 */

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settings';
import { loadReviewLogs } from '@/srs/engine';
import { sentenceApi } from '@/api/client';
import { getBookMeta } from '@/data/wordbooks';
import { useWordBookStore } from '@/stores/wordBook';
import { toBJDate } from '@/utils/date';

const LAST_NOTIFY_KEY = 'vf_last_reminder_date';

/** 获取今日日期字符串 (北京时区) */
function getTodayStr(): string {
  return toBJDate(new Date());
}

/** 检查今天是否已经学习过 */
async function hasStudiedToday(bookId: string): Promise<boolean> {
  const bookMeta = getBookMeta(bookId);
  if (!bookMeta) return false;

  const todayStr = getTodayStr();

  if (bookMeta.kind === 'sentence') {
    // 句子模式：检查今日练习数
    try {
      const stats = await sentenceApi.getStats();
      return stats.practicedToday > 0;
    } catch {
      return false;
    }
  } else {
    // 单词模式：检查复习日志
    try {
      const logs = await loadReviewLogs();
      return logs.some((l) => toBJDate(l.reviewedAt) === todayStr);
    } catch {
      return false;
    }
  }
}

/** 发送学习提醒通知 */
function sendStudyNotification(dueCount: number) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = '📚 VocabFlow 学习提醒';
  const body = dueCount > 0
    ? `你有 ${dueCount} 个单词待复习，别忘了今天的学习哦！`
    : '该学习啦！坚持每天练习，才能记忆牢固～';

  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'vocabflow-reminder',
    });
  } catch {
    // 某些浏览器在 Service Worker 外不支持 new Notification
  }
}

/**
 * 学习提醒 Hook
 * 在应用启动后调用，自动管理定时检查
 */
export function useStudyReminder() {
  const reminderEnabled = useSettingsStore((s) => s.reminderEnabled);
  const reminderTime = useSettingsStore((s) => s.reminderTime);
  const activeBookId = useWordBookStore((s) => s.activeBookId);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCheckDateRef = useRef<string>('');

  useEffect(() => {
    if (!reminderEnabled || !activeBookId) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    // 检查函数
    async function check() {
      if (!activeBookId) return;
      const now = new Date();
      const todayStr = getTodayStr();

      // 今天已经提醒过
      if (lastCheckDateRef.current === todayStr) return;
      if (localStorage.getItem(LAST_NOTIFY_KEY) === todayStr) {
        lastCheckDateRef.current = todayStr;
        return;
      }

      // 解析提醒时间
      const [hours, minutes] = reminderTime.split(':').map(Number);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return;

      // 当前时间是否已过提醒时间
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const reminderMinutes = hours * 60 + minutes;

      if (currentMinutes < reminderMinutes) return;

      // 检查是否已学习
      const studied = await hasStudiedToday(activeBookId);
      if (studied) {
        lastCheckDateRef.current = todayStr;
        localStorage.setItem(LAST_NOTIFY_KEY, todayStr);
        return;
      }

      // 未学习，发送通知
      sendStudyNotification(0);
      lastCheckDateRef.current = todayStr;
      localStorage.setItem(LAST_NOTIFY_KEY, todayStr);
    }

    // 立即检查一次（可能页面加载时已过提醒时间）
    check();

    // 每分钟检查一次
    timerRef.current = setInterval(check, 60_000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [reminderEnabled, reminderTime, activeBookId]);
}
