/**
 * 数据层 — 从本地 JSON 文件加载词书和句子数据
 *
 * 数据来源:
 *   - gaokao_words.json               高考词汇 (简单 word→meaning 格式)
 *   - CET4_words.json                 四级词汇
 *   - CET6_words.json                 六级词汇
 *   - zhongkao_words.json             中考词汇
 *   - IELTS_words.json                雅思核心词汇 (含音标/词性/例句)
 *   - IELTS_sentences.json            雅思日常对话
 *   - language_sense_sentences.json   英语语感分级练习 (初中/高中/大学)
 */

import type {
  WordBookMeta,
  WordEntry,
  SentenceBook,
  SentenceBand,
} from '@/types';

// Vite 原生支持 JSON 导入
import gaokaoWords from './wordbooks/gaokao_words.json';
import cet4Words from './wordbooks/CET4_words.json';
import cet6Words from './wordbooks/CET6_words.json';
import zhongkaoWords from './wordbooks/zhongkao_words.json';
import ieltsWordsData from './wordbooks/IELTS_words.json';
import ieltsSentencesData from './wordbooks/IELTS_sentences.json';
import languageSenseData from './wordbooks/language_sense_sentences.json';

/* ------------------------------------------------------------------ */
/* 类型断言                                                            */
/* ------------------------------------------------------------------ */

type SimpleWordData = Record<string, string>;

interface IELTSWordRaw {
  word: string;
  phonetic: string;
  pos: string;
  meaning_cn: string;
  example: string;
  example_cn: string;
}

interface IELTSWordsFile {
  meta: { description: string; target_band: string; fields: string };
  words: IELTSWordRaw[];
}

interface IELTSSentencesFile {
  ielts_daily_conversations: {
    description: string;
    bands: SentenceBand[];
  };
}

interface LanguageSenseLevel {
  level: string;
  level_en: string;
  topics: { topic: string; dialogues: { cn: string; en: string }[] }[];
}

interface LanguageSenseSentencesFile {
  english_language_sense_practice: {
    description: string;
    levels: LanguageSenseLevel[];
  };
}

const gaokao = gaokaoWords as SimpleWordData;
const cet4 = cet4Words as SimpleWordData;
const cet6 = cet6Words as SimpleWordData;
const zhongkao = zhongkaoWords as SimpleWordData;
const ieltsWords = ieltsWordsData as IELTSWordsFile;
const ieltsSentences = ieltsSentencesData as IELTSSentencesFile;
const languageSense = languageSenseData as LanguageSenseSentencesFile;

/* ------------------------------------------------------------------ */
/* 句子书辅助：将 language_sense 的 levels 转为 SentenceBand[]          */
/* ------------------------------------------------------------------ */

const languageSenseBands: SentenceBand[] = languageSense.english_language_sense_practice.levels.map(
  (lvl, i) => ({
    band: i + 1,
    level: lvl.level,
    topics: lvl.topics,
  }),
);

/* ------------------------------------------------------------------ */
/* 词书元数据                                                          */
/* ------------------------------------------------------------------ */

function countSentences(bands: SentenceBand[]): number {
  return bands.reduce((sum, b) => sum + b.topics.reduce((s, t) => s + t.dialogues.length, 0), 0);
}

export const WORD_BOOKS: WordBookMeta[] = [
  {
    id: 'zhongkao',
    title: '中考核心词汇',
    description: '中考英语核心必背词汇',
    kind: 'word',
    total: Object.keys(zhongkao).length,
  },
  {
    id: 'gaokao',
    title: '高考核心词汇',
    description: '高考英语核心必背词汇',
    kind: 'word',
    total: Object.keys(gaokao).length,
  },
  {
    id: 'cet4',
    title: '四级核心词汇',
    description: '大学英语四级核心必背词汇',
    kind: 'word',
    total: Object.keys(cet4).length,
  },
  {
    id: 'cet6',
    title: '六级核心词汇',
    description: '大学英语六级核心必背词汇',
    kind: 'word',
    total: Object.keys(cet6).length,
  },
  {
    id: 'ielts',
    title: '雅思核心词汇',
    description: `${ieltsWords.meta.description}（${ieltsWords.words.length}词）`,
    kind: 'word',
    total: ieltsWords.words.length,
  },
  {
    id: 'ielts-sentences',
    title: '雅思日常对话',
    description: ieltsSentences.ielts_daily_conversations.description,
    kind: 'sentence',
    total: countSentences(ieltsSentences.ielts_daily_conversations.bands),
  },
  {
    id: 'language-sense',
    title: '英语语感分级练习',
    description: languageSense.english_language_sense_practice.description,
    kind: 'sentence',
    total: countSentences(languageSenseBands),
  },
];

/* ------------------------------------------------------------------ */
/* 单词数据访问                                                        */
/* ------------------------------------------------------------------ */

/** 获取某词书的全部单词（惰性构建，首次调用后缓存） */
const _wordCache = new Map<string, WordEntry[]>();

/** 简单 word→meaning 格式的词书构建 */
function buildSimpleWordEntries(bookId: string, data: SimpleWordData): WordEntry[] {
  return Object.entries(data).map(([word, meaning]) => ({
    id: `${bookId}:${word}`,
    word,
    meaning_cn: meaning,
    bookId,
  }));
}

export function getWordsByBook(bookId: string): WordEntry[] {
  if (_wordCache.has(bookId)) return _wordCache.get(bookId)!;

  let entries: WordEntry[] = [];

  if (bookId === 'gaokao') {
    entries = buildSimpleWordEntries('gaokao', gaokao);
  } else if (bookId === 'cet4') {
    entries = buildSimpleWordEntries('cet4', cet4);
  } else if (bookId === 'cet6') {
    entries = buildSimpleWordEntries('cet6', cet6);
  } else if (bookId === 'zhongkao') {
    entries = buildSimpleWordEntries('zhongkao', zhongkao);
  } else if (bookId === 'ielts') {
    entries = ieltsWords.words.map((w) => ({
      id: `ielts:${w.word}`,
      word: w.word,
      meaning_cn: w.meaning_cn,
      phonetic: w.phonetic,
      pos: w.pos,
      example: w.example,
      example_cn: w.example_cn,
      bookId: 'ielts',
    }));
  }

  _wordCache.set(bookId, entries);
  return entries;
}

/** 根据 wordId 获取单词详情 */
export function getWordById(wordId: string): WordEntry | null {
  const [bookId, ...rest] = wordId.split(':');
  const word = rest.join(':');
  const words = getWordsByBook(bookId);
  return words.find((w) => w.word === word) ?? null;
}

/** 搜索单词（在指定词书内） */
export function searchWords(bookId: string, query: string, limit = 50): WordEntry[] {
  const words = getWordsByBook(bookId);
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return words
    .filter(
      (w) =>
        w.word.toLowerCase().startsWith(q) ||
        w.meaning_cn.includes(query.trim()),
    )
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* 句子数据访问                                                        */
/* ------------------------------------------------------------------ */

/** 根据 bookId 获取句子书的 band 列表 */
export function getSentenceBands(bookId?: string): SentenceBand[] {
  if (bookId === 'language-sense') {
    return languageSenseBands;
  }
  // 默认返回雅思日常对话
  return ieltsSentences.ielts_daily_conversations.bands;
}

/** 根据 bookId 获取句子书信息 */
export function getSentenceBook(bookId?: string): SentenceBook {
  if (bookId === 'language-sense') {
    return {
      id: 'language-sense',
      title: '英语语感分级练习',
      description: languageSense.english_language_sense_practice.description,
      bands: languageSenseBands,
    };
  }
  return {
    id: 'ielts-sentences',
    title: '雅思日常对话',
    description: ieltsSentences.ielts_daily_conversations.description,
    bands: ieltsSentences.ielts_daily_conversations.bands,
  };
}

/* ------------------------------------------------------------------ */
/* 词书查找                                                            */
/* ------------------------------------------------------------------ */

export function getBookMeta(bookId: string): WordBookMeta | undefined {
  return WORD_BOOKS.find((b) => b.id === bookId);
}

export function isWordBook(bookId: string): boolean {
  const meta = getBookMeta(bookId);
  return meta?.kind === 'word';
}
