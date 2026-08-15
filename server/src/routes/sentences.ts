/**
 * 句子练习进度路由
 * 对应 sentence_progress / sentence_position / sentence_mastery 表
 * 所有操作需认证，按用户隔离数据
 */

import { Router } from 'express';
import { query, execute } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const sentenceRouter = Router();

/* ------------------------------------------------------------------ */
/* 句子完成进度                                                        */
/* ------------------------------------------------------------------ */

/** 加载句子进度 (聚合为 Record<"band:topicIdx", number[]>) */
sentenceRouter.get('/progress', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const rows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
    }>('SELECT band, topic_idx, dialogue_idx FROM sentence_progress WHERE user_id = ?', [userId]);

    const progress: Record<string, number[]> = {};
    for (const r of rows) {
      const key = `${r.band}:${r.topic_idx}`;
      if (!progress[key]) progress[key] = [];
      progress[key].push(r.dialogue_idx);
    }
    res.json(progress);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 标记句子完成 (INSERT OR IGNORE 防重复) */
sentenceRouter.post('/complete', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { band, topicIdx, dialogueIdx } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
    };

    await execute(
      `INSERT OR IGNORE INTO sentence_progress (user_id, band, topic_idx, dialogue_idx) VALUES (?, ?, ?, ?)`,
      [userId, band, topicIdx, dialogueIdx],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* 句子位置 — GET 返回下一个未完成句子                                  */
/* ------------------------------------------------------------------ */

sentenceRouter.get('/position', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const structureParam = req.query.structure as string | undefined;

    // 读取已保存的位置
    const posRows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
    }>('SELECT band, topic_idx, dialogue_idx FROM sentence_position WHERE user_id = ?', [userId]);

    // 读取所有已完成的句子
    const completedRows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
    }>('SELECT band, topic_idx, dialogue_idx FROM sentence_progress WHERE user_id = ?', [userId]);

    const completedSet = new Set<string>();
    for (const r of completedRows) {
      completedSet.add(`${r.band}:${r.topic_idx}:${r.dialogue_idx}`);
    }

    // 如果没有结构信息，返回原始位置或 null
    if (!structureParam) {
      if (!posRows.length) {
        res.json(null);
        return;
      }
      const r = posRows[0];
      res.json({
        band: r.band,
        topicIdx: r.topic_idx,
        dialogueIdx: r.dialogue_idx,
      });
      return;
    }

    // 解析结构: JSON array of { band, topics: number[] }
    const structure = JSON.parse(structureParam) as Array<{
      band: number;
      topics: number[];
    }>;

    // 起始搜索位置
    let startBandIdx = 0;
    let startTopicIdx = 0;
    let startDialogueIdx = 0;

    if (posRows.length) {
      const saved = posRows[0];
      startBandIdx = structure.findIndex((b) => b.band === saved.band);
      if (startBandIdx === -1) startBandIdx = 0;
      startTopicIdx = saved.topic_idx;
      startDialogueIdx = saved.dialogue_idx;
    }

    // 从起始位置向后搜索第一个未完成的句子
    for (let bi = startBandIdx; bi < structure.length; bi++) {
      const bandInfo = structure[bi];
      const topicStart = bi === startBandIdx ? startTopicIdx : 0;
      for (let ti = topicStart; ti < bandInfo.topics.length; ti++) {
        const dialogueCount = bandInfo.topics[ti];
        const dialogueStart = (bi === startBandIdx && ti === startTopicIdx) ? startDialogueIdx : 0;
        for (let di = dialogueStart; di < dialogueCount; di++) {
          const key = `${bandInfo.band}:${ti}:${di}`;
          if (!completedSet.has(key)) {
            res.json({
              band: bandInfo.band,
              topicIdx: ti,
              dialogueIdx: di,
            });
            return;
          }
        }
      }
    }

    // 所有句子都已完成，返回第一个 band 的第一个句子
    if (structure.length > 0) {
      res.json({
        band: structure[0].band,
        topicIdx: 0,
        dialogueIdx: 0,
      });
    } else {
      res.json(null);
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 保存句子位置 (UPSERT 按用户) */
sentenceRouter.post('/position', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { band, topicIdx, dialogueIdx } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
    };

    await execute(
      `INSERT OR REPLACE INTO sentence_position (user_id, band, topic_idx, dialogue_idx)
       VALUES (?, ?, ?, ?)`,
      [userId, band, topicIdx, dialogueIdx],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* 句子熟知标记 (sentence_mastery)                                     */
/* ------------------------------------------------------------------ */

/** 加载所有熟知标记 (聚合为 Record<"band:topicIdx", number[]>) */
sentenceRouter.get('/mastery', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const rows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
      source: string;
      proficiency: number;
      pause_ms: number;
      tab_count: number;
      typo_count: number;
    }>('SELECT band, topic_idx, dialogue_idx, source, proficiency, pause_ms, tab_count, typo_count FROM sentence_mastery WHERE user_id = ?', [userId]);

    const masteryMap: Record<string, number[]> = {};
    const details: Array<{
      band: number;
      topicIdx: number;
      dialogueIdx: number;
      source: string;
      proficiency: number;
      pauseMs: number;
      tabCount: number;
      typoCount: number;
    }> = [];

    for (const r of rows) {
      const key = `${r.band}:${r.topic_idx}`;
      if (!masteryMap[key]) masteryMap[key] = [];
      masteryMap[key].push(r.dialogue_idx);

      details.push({
        band: r.band,
        topicIdx: r.topic_idx,
        dialogueIdx: r.dialogue_idx,
        source: r.source,
        proficiency: r.proficiency,
        pauseMs: r.pause_ms,
        tabCount: r.tab_count,
        typoCount: r.typo_count,
      });
    }

    res.json({ mastery: masteryMap, details });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 标记句子为熟知 */
sentenceRouter.post('/mastery', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { band, topicIdx, dialogueIdx, source, proficiency, pauseMs, tabCount, typoCount } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
      source?: string;
      proficiency?: number;
      pauseMs?: number;
      tabCount?: number;
      typoCount?: number;
    };

    await execute(
      `INSERT OR REPLACE INTO sentence_mastery (user_id, band, topic_idx, dialogue_idx, source, proficiency, pause_ms, tab_count, typo_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        band,
        topicIdx,
        dialogueIdx,
        source ?? 'manual',
        proficiency ?? 100,
        pauseMs ?? 0,
        tabCount ?? 0,
        typoCount ?? 0,
      ],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 取消句子熟知标记 */
sentenceRouter.delete('/mastery', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { band, topicIdx, dialogueIdx } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
    };

    await execute(
      `DELETE FROM sentence_mastery WHERE user_id = ? AND band = ? AND topic_idx = ? AND dialogue_idx = ?`,
      [userId, band, topicIdx, dialogueIdx],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 清除某 band 的所有熟知标记 */
sentenceRouter.delete('/mastery/band/:band', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const band = Number(req.params.band);
    await execute(
      `DELETE FROM sentence_mastery WHERE user_id = ? AND band = ?`,
      [userId, band],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* 句子练习历史记录 (sentence_practice_log)                            */
/* ------------------------------------------------------------------ */

/** 记录一次句子练习 (含熟练度数据) */
sentenceRouter.post('/log', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { band, topicIdx, dialogueIdx, proficiency, pauseMs, tabCount, typoCount } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
      proficiency?: number;
      pauseMs?: number;
      tabCount?: number;
      typoCount?: number;
    };

    await execute(
      `INSERT INTO sentence_practice_log (user_id, band, topic_idx, dialogue_idx, proficiency, pause_ms, tab_count, typo_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        band,
        topicIdx,
        dialogueIdx,
        proficiency ?? 0,
        pauseMs ?? 0,
        tabCount ?? 0,
        typoCount ?? 0,
      ],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 获取句子练习统计 */
sentenceRouter.get('/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // 已学句子数 (distinct band:topic:dialogue)
    const learnedRows = await query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM (SELECT DISTINCT band, topic_idx, dialogue_idx FROM sentence_practice_log WHERE user_id = ?) AS t',
      [userId],
    );
    const learnedSentences = learnedRows[0]?.cnt ?? 0;

    // 总练习次数
    const totalRows = await query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM sentence_practice_log WHERE user_id = ?',
      [userId],
    );
    const totalPractices = totalRows[0]?.cnt ?? 0;

    // 坚持天数: 从 sentence_practice_log 和 sentence_progress 的 completed_at 中提取日期
    const dateRows = await query<{ d: string }>(
      `SELECT DISTINCT DATE(practiced_at) AS d FROM sentence_practice_log WHERE user_id = ?
       UNION
       SELECT DISTINCT DATE(completed_at) AS d FROM sentence_progress WHERE user_id = ?`,
      [userId, userId],
    );
    const activityDates = new Set<string>();
    for (const r of dateRows) {
      if (r.d) {
        const d = new Date(r.d);
        if (!isNaN(d.getTime())) {
          activityDates.add(d.toISOString().slice(0, 10));
        }
      }
    }

    // 计算坚持天数 (从今天往前数)
    const now = new Date();
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      if (activityDates.has(dateStr)) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }

    // 今日练习次数
    const todayRows = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sentence_practice_log WHERE user_id = ? AND DATE(practiced_at) = UTC_DATE()`,
      [userId],
    );
    const practicedToday = todayRows[0]?.cnt ?? 0;

    // 平均熟练度
    const avgRows = await query<{ avg: number | null }>(
      'SELECT AVG(proficiency) AS avg FROM sentence_practice_log WHERE user_id = ?',
      [userId],
    );
    const avgProficiency = avgRows[0]?.avg ?? 0;

    res.json({
      learnedSentences,
      totalPractices,
      streakDays: streak,
      practicedToday,
      avgProficiency: Math.round(avgProficiency),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 获取熟练度历史 (近30天每日平均熟练度 + 近20条练习记录) */
sentenceRouter.get('/proficiency-history', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // 近30天每日平均熟练度
    const dailyRows = await query<{ d: string; avg_prof: number; cnt: number }>(
      `SELECT DATE(practiced_at) AS d, AVG(proficiency) AS avg_prof, COUNT(*) AS cnt
       FROM sentence_practice_log
       WHERE user_id = ? AND practiced_at >= DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)
       GROUP BY DATE(practiced_at)
       ORDER BY d ASC`,
      [userId],
    );

    // 近50条练习记录 (用于查看趋势)
    const recentRows = await query<{
      id: number;
      band: number;
      topic_idx: number;
      dialogue_idx: number;
      proficiency: number;
      pause_ms: number;
      tab_count: number;
      typo_count: number;
      practiced_at: Date;
    }>(
      `SELECT id, band, topic_idx, dialogue_idx, proficiency, pause_ms, tab_count, typo_count, practiced_at
       FROM sentence_practice_log
       WHERE user_id = ?
       ORDER BY practiced_at DESC
       LIMIT 50`,
      [userId],
    );

    res.json({
      daily: dailyRows.map((r) => ({
        date: new Date(r.d).toISOString().slice(0, 10),
        avgProficiency: Math.round(r.avg_prof),
        count: r.cnt,
      })),
      recent: recentRows.map((r) => ({
        id: r.id,
        band: r.band,
        topicIdx: r.topic_idx,
        dialogueIdx: r.dialogue_idx,
        proficiency: r.proficiency,
        pauseMs: r.pause_ms,
        tabCount: r.tab_count,
        typoCount: r.typo_count,
        practicedAt: new Date(r.practiced_at).toISOString(),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
