/**
 * 数据层 — 从本地 JSON 文件加载词书和句子数据
 *
 * 数据来源:
 *   - gaokao_words.json    高考词汇 (3429词, 简单 word→meaning 格式)
 *   - IELTS_words.json     雅思核心词汇 (605词, 含音标/词性/例句)
 *   - IELTS_sentences.json 雅思日常对话 (6 bands, 710句)
 */

import type {
  WordBookMeta,
  WordEntry,
  SentenceBook,
  SentenceBand,
} from '@/types';

// Vite 原生支持 JSON 导入
import gaokaoWords from '../../gaokao_words.json';
import ieltsWordsData from '../../IELTS_words.json';
import ieltsSentencesData from '../../IELTS_sentences.json';

/* ------------------------------------------------------------------ */
/* 类型断言                                                            */
/* ------------------------------------------------------------------ */

type GaokaoData = Record<string, string>;

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

const gaokao = gaokaoWords as GaokaoData;
const ieltsWords = ieltsWordsData as IELTSWordsFile;
const ieltsSentences = ieltsSentencesData as IELTSSentencesFile;

/* ------------------------------------------------------------------ */
/* 词书元数据                                                          */
/* ------------------------------------------------------------------ */

export const WORD_BOOKS: WordBookMeta[] = [
  {
    id: 'gaokao',
    title: '高考核心词汇',
    description: '高考英语 3429 个核心必背词汇',
    kind: 'word',
    total: Object.keys(gaokao).length,
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
    description: `${ieltsSentences.ielts_daily_conversations.description}`,
    kind: 'sentence',
    total: ieltsSentences.ielts_daily_conversations.bands.reduce(
      (sum, b) => sum + b.topics.reduce((s, t) => s + t.dialogues.length, 0),
      0,
    ),
  },
];

/* ------------------------------------------------------------------ */
/* 单词数据访问                                                        */
/* ------------------------------------------------------------------ */

/** 获取某词书的全部单词（惰性构建，首次调用后缓存） */
const _wordCache = new Map<string, WordEntry[]>();

export function getWordsByBook(bookId: string): WordEntry[] {
  if (_wordCache.has(bookId)) return _wordCache.get(bookId)!;

  let entries: WordEntry[] = [];

  if (bookId === 'gaokao') {
    entries = Object.entries(gaokao).map(([word, meaning]) => ({
      id: `gaokao:${word}`,
      word,
      meaning_cn: meaning,
      bookId: 'gaokao',
    }));
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

export function getSentenceBook(): SentenceBook {
  return {
    id: 'ielts-sentences',
    title: '雅思日常对话',
    description: ieltsSentences.ielts_daily_conversations.description,
    bands: ieltsSentences.ielts_daily_conversations.bands,
  };
}

export function getSentenceBands(): SentenceBand[] {
  return ieltsSentences.ielts_daily_conversations.bands;
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
