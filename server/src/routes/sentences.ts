/**
 * 句子练习进度路由
 * 对应 sentence_progress / sentence_position / sentence_mastery 表
 */

import { Router } from 'express';
import { query, execute } from '../db.js';

export const sentenceRouter = Router();

/* ------------------------------------------------------------------ */
/* 句子完成进度                                                        */
/* ------------------------------------------------------------------ */

/** 加载句子进度 (聚合为 Record<"band:topicIdx", number[]>) */
sentenceRouter.get('/progress', async (_req, res) => {
  try {
    const rows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
    }>('SELECT band, topic_idx, dialogue_idx FROM sentence_progress');

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

/** 标记句子完成 (INSERT IGNORE 防重复) */
sentenceRouter.post('/complete', async (req, res) => {
  try {
    const { band, topicIdx, dialogueIdx } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
    };

    await execute(
      `INSERT IGNORE INTO sentence_progress (band, topic_idx, dialogue_idx) VALUES (?, ?, ?)`,
      [band, topicIdx, dialogueIdx],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* 句子位置 — GET 返回下一个未完成句子                                  */
/*                                                                    */
/* 逻辑：                                                             */
/*   1. 读取上次保存的位置 (band, topicIdx, dialogueIdx)               */
/*   2. 从该位置开始向后搜索，找到第一个未完成的句子                   */
/*   3. 若该 band 中全部完成，则继续搜索后续 band                     */
/*   4. 若所有句子都已完成，返回第一个 band 的第一个句子               */
/* ------------------------------------------------------------------ */

// 雅思日常对话的 band/topic/dialogue 结构（前端定义的固定数据）
// 这里由前端通过 query param 传入结构信息，后端只做数据库查询
sentenceRouter.get('/position', async (req, res) => {
  try {
    // 前端传入所有 band/topic/dialogue 的数量结构
    // 格式: ?structure=band0Topics,band1Topics,...
    // 例如: ?structure=3,4,2 表示 band0 有3个topic, band1 有4个, band2 有2个
    // 每个topic的dialogue数量通过另一个参数传入
    // 但更简单的方式：前端传入完整的结构 JSON
    const structureParam = req.query.structure as string | undefined;

    // 读取已保存的位置
    const posRows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
    }>('SELECT band, topic_idx, dialogue_idx FROM sentence_position WHERE id = 1');

    // 读取所有已完成的句子
    const completedRows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
    }>('SELECT band, topic_idx, dialogue_idx FROM sentence_progress');

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
    // topics[i] = 该 topic 的 dialogue 数量
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
            // 找到未完成的句子
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

/** 保存句子位置 (UPSERT 单行) */
sentenceRouter.post('/position', async (req, res) => {
  try {
    const { band, topicIdx, dialogueIdx } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
    };

    await execute(
      `INSERT INTO sentence_position (id, band, topic_idx, dialogue_idx)
       VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE band = VALUES(band), topic_idx = VALUES(topic_idx), dialogue_idx = VALUES(dialogue_idx)`,
      [band, topicIdx, dialogueIdx],
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
sentenceRouter.get('/mastery', async (_req, res) => {
  try {
    const rows = await query<{
      band: number;
      topic_idx: number;
      dialogue_idx: number;
      source: string;
      proficiency: number;
      pause_ms: number;
      tab_count: number;
      typo_count: number;
    }>('SELECT band, topic_idx, dialogue_idx, source, proficiency, pause_ms, tab_count, typo_count FROM sentence_mastery');

    // 返回两种结构：mastery map (用于跳过) + detail list (用于展示)
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
sentenceRouter.post('/mastery', async (req, res) => {
  try {
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
      `INSERT INTO sentence_mastery (band, topic_idx, dialogue_idx, source, proficiency, pause_ms, tab_count, typo_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         source = VALUES(source),
         proficiency = VALUES(proficiency),
         pause_ms = VALUES(pause_ms),
         tab_count = VALUES(tab_count),
         typo_count = VALUES(typo_count)`,
      [
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
sentenceRouter.delete('/mastery', async (req, res) => {
  try {
    const { band, topicIdx, dialogueIdx } = req.body as {
      band: number;
      topicIdx: number;
      dialogueIdx: number;
    };

    await execute(
      `DELETE FROM sentence_mastery WHERE band = ? AND topic_idx = ? AND dialogue_idx = ?`,
      [band, topicIdx, dialogueIdx],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 清除某 band 的所有熟知标记 */
sentenceRouter.delete('/mastery/band/:band', async (req, res) => {
  try {
    const band = Number(req.params.band);
    await execute(
      `DELETE FROM sentence_mastery WHERE band = ?`,
      [band],
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
sentenceRouter.post('/log', async (req, res) => {
  try {
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
      `INSERT INTO sentence_practice_log (band, topic_idx, dialogue_idx, proficiency, pause_ms, tab_count, typo_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
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
sentenceRouter.get('/stats', async (_req, res) => {
  try {
    // 已学句子数 (distinct band:topic:dialogue)
    const learnedRows = await query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM (SELECT DISTINCT band, topic_idx, dialogue_idx FROM sentence_practice_log) AS t',
    );
    const learnedSentences = learnedRows[0]?.cnt ?? 0;

    // 总练习次数
    const totalRows = await query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM sentence_practice_log',
    );
    const totalPractices = totalRows[0]?.cnt ?? 0;

    // 坚持天数: 从 sentence_practice_log 和 sentence_progress 的 created_at 中提取日期
    const dateRows = await query<{ d: string }>(
      `SELECT DISTINCT DATE(practiced_at) AS d FROM sentence_practice_log
       UNION
       SELECT DISTINCT DATE(created_at) AS d FROM sentence_progress`,
    );
    const activityDates = new Set<string>();
    for (const r of dateRows) {
      if (r.d) {
        // 转为 YYYY-MM-DD 格式
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
      `SELECT COUNT(*) AS cnt FROM sentence_practice_log WHERE DATE(practiced_at) = CURDATE()`,
    );
    const practicedToday = todayRows[0]?.cnt ?? 0;

    // 平均熟练度
    const avgRows = await query<{ avg: number | null }>(
      'SELECT AVG(proficiency) AS avg FROM sentence_practice_log',
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
sentenceRouter.get('/proficiency-history', async (_req, res) => {
  try {
    // 近30天每日平均熟练度
    const dailyRows = await query<{ d: string; avg_prof: number; cnt: number }>(
      `SELECT DATE(practiced_at) AS d, AVG(proficiency) AS avg_prof, COUNT(*) AS cnt
       FROM sentence_practice_log
       WHERE practiced_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY DATE(practiced_at)
       ORDER BY d ASC`,
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
       ORDER BY practiced_at DESC
       LIMIT 50`,
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
