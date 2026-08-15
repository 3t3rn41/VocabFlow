/**
 * 发音纠错与评分工具
 *
 * 对比用户语音识别结果与目标句子，计算：
 * - 整体得分 (0-100)
 * - 逐词对比（正确 / 缺失 / 多余）
 * - 错误详情
 */

/** 标准化单词：转小写、去除标点 */
function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\w']/g, '')
    .replace(/^'+|'+$/g, '');
}

/** 将句子拆分为标准化单词数组 */
export function tokenize(sentence: string): string[] {
  return sentence
    .trim()
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
}

/** 逐词对比状态 */
export type WordStatus = 'correct' | 'wrong' | 'missed' | 'extra';

export interface ComparisonWord {
  /** 目标单词（如果是 extra，则为空字符串） */
  target: string;
  /** 识别到的单词（如果是 missed，则为空字符串） */
  recognized: string;
  /** 对比状态 */
  status: WordStatus;
  /** 在目标句子中的索引（extra 为 -1） */
  targetIdx: number;
}

export interface PronunciationResult {
  /** 整体得分 0-100 */
  score: number;
  /** 正确词数 */
  correctCount: number;
  /** 目标总词数 */
  totalWords: number;
  /** 逐词对比 */
  comparison: ComparisonWord[];
  /** 置信度（来自 ASR，0-1） */
  confidence: number;
  /** 是否通过（score >= 60） */
  passed: boolean;
}

/**
 * 计算两个单词之间的编辑距离 (Levenshtein)
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/**
 * 判断两个单词是否匹配（完全相同或编辑距离 <= 1 视为近似匹配）
 */
function wordsSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length <= 2 || b.length <= 2) return a === b;
  const dist = levenshtein(a, b);
  // 允许 1 个字符的误差（如时态变化、复数等）
  return dist <= 1 && dist / Math.max(a.length, b.length) <= 0.3;
}

/**
 * 基于动态规划的单词序列对齐。
 * 将识别结果与目标逐词匹配，返回对齐结果。
 */
function alignWords(
  targetWords: string[],
  recognizedWords: string[],
): ComparisonWord[] {
  const m = targetWords.length;
  const n = recognizedWords.length;

  // dp[i][j] = 将 target[0..i) 与 recognized[0..j) 对齐的最小代价
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i; // 全部 missed
  for (let j = 0; j <= n; j++) dp[0][j] = j; // 全部 extra

  const cost = (i: number, j: number): number => {
    return wordsSimilar(targetWords[i - 1], recognizedWords[j - 1]) ? 0 : 1;
  };

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + cost(i, j), // 匹配或替换
        dp[i - 1][j] + 1,               // missed
        dp[i][j - 1] + 1,               // extra
      );
    }
  }

  // 回溯
  const result: ComparisonWord[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const matchCost = cost(i, j);
      if (dp[i][j] === dp[i - 1][j - 1] + matchCost) {
        const target = targetWords[i - 1];
        const recognized = recognizedWords[j - 1];
        result.unshift({
          target,
          recognized,
          status: matchCost === 0 ? 'correct' : 'wrong',
          targetIdx: i - 1,
        });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      result.unshift({
        target: targetWords[i - 1],
        recognized: '',
        status: 'missed',
        targetIdx: i - 1,
      });
      i--;
      continue;
    }
    // j > 0
    result.unshift({
      target: '',
      recognized: recognizedWords[j - 1],
      status: 'extra',
      targetIdx: -1,
    });
    j--;
  }

  return result;
}

/**
 * 计算发音评分
 *
 * @param targetSentence 目标英文句子
 * @param recognizedText ASR 识别结果
 * @param confidence ASR 置信度 (0-1)
 * @returns 评分结果
 */
export function scorePronunciation(
  targetSentence: string,
  recognizedText: string,
  confidence: number = 0.9,
): PronunciationResult {
  const targetWords = tokenize(targetSentence);
  const recognizedWords = tokenize(recognizedText);

  if (targetWords.length === 0) {
    return {
      score: 0,
      correctCount: 0,
      totalWords: 0,
      comparison: [],
      confidence,
      passed: false,
    };
  }

  if (recognizedWords.length === 0) {
    // 没有识别到任何内容
    const comparison: ComparisonWord[] = targetWords.map((w, idx) => ({
      target: w,
      recognized: '',
      status: 'missed' as const,
      targetIdx: idx,
    }));
    return {
      score: 0,
      correctCount: 0,
      totalWords: targetWords.length,
      comparison,
      confidence,
      passed: false,
    };
  }

  // 对齐
  const comparison = alignWords(targetWords, recognizedWords);

  // 统计
  let correctCount = 0;
  let wrongCount = 0;
  let missedCount = 0;

  for (const c of comparison) {
    switch (c.status) {
      case 'correct': correctCount++; break;
      case 'wrong': wrongCount++; break;
      case 'missed': missedCount++; break;
    }
  }

  // 评分逻辑：
  // - 正确词：+100/total
  // - 错误词（近似但不完全匹配）：+40/total
  // - 缺失词：0
  // - 多余词：-5/total（轻微惩罚）
  const total = targetWords.length;
  let rawScore = 0;
  for (const c of comparison) {
    if (c.status === 'correct') rawScore += 100;
    else if (c.status === 'wrong') rawScore += 40;
  }
  // 多余词惩罚
  const extraCount = comparison.filter((c) => c.status === 'extra').length;
  rawScore -= extraCount * 5;

  const score = Math.max(0, Math.min(100, Math.round(rawScore / total)));

  return {
    score,
    correctCount,
    totalWords: total,
    comparison,
    confidence,
    passed: score >= 60,
  };
}

/**
 * 获取分数对应的颜色等级
 */
export function getScoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-500';
  if (score >= 70) return 'text-green-500';
  if (score >= 60) return 'text-amber-500';
  if (score >= 40) return 'text-orange-500';
  return 'text-red-500';
}

/**
 * 获取分数对应的等级文字
 */
export function getScoreLabel(score: number): string {
  if (score >= 85) return '优秀 🌟';
  if (score >= 70) return '良好 👍';
  if (score >= 60) return '及格 ✅';
  if (score >= 40) return '需练习 💪';
  return '再试试 🔄';
}
