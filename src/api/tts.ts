/**
 * TTS — 优先使用浏览器内置 SpeechSynthesis API
 *
 * 若浏览器不支持 SpeechSynthesis，或没有可用语音，则回退到
 * 小米墨墨 (mimo) TTS 在线服务 (mimo-v2.5-tts)。
 *
 * mimo TTS API Key 通过后端 API 存储在 MySQL user_settings 表中。
 */

import { userApi } from '@/api/client';

const MIMO_TTS_ENDPOINT = 'https://api.xiaomimimo.com/v1/tts';
const MIMO_TTS_MODEL = 'mimo-v2.5-tts';

/* ------------------------------------------------------------------ */
/* API Key 管理 (通过后端 API)                                          */
/* ------------------------------------------------------------------ */

// 内存缓存，避免每次都请求后端
let _cachedApiKey: string | null = null;
let _apiKeyLoaded = false;

/** 异步加载 TTS API Key */
async function loadTtsApiKey(): Promise<string | null> {
  if (_apiKeyLoaded) return _cachedApiKey;
  try {
    const settings = await userApi.getSettings();
    _cachedApiKey = settings.ttsApiKey ?? null;
    _apiKeyLoaded = true;
  } catch (e) {
    console.error('[tts] loadApiKey failed', e);
    _cachedApiKey = null;
    _apiKeyLoaded = true;
  }
  return _cachedApiKey;
}

/** 同步获取缓存的 API Key（可能为 null 如果尚未加载） */
export function getTtsApiKey(): string | null {
  return _cachedApiKey;
}

/** 异步获取 API Key（确保已从后端加载） */
export async function getTtsApiKeyAsync(): Promise<string | null> {
  return loadTtsApiKey();
}

/** 保存 API Key 到后端 */
export async function setTtsApiKey(key: string | null): Promise<void> {
  _cachedApiKey = key;
  _apiKeyLoaded = true;
  try {
    await userApi.saveSettings({ ttsApiKey: key ?? '' });
  } catch (e) {
    console.error('[tts] saveApiKey failed', e);
  }
}

/* ------------------------------------------------------------------ */
/* 浏览器语音可用性检测                                                */
/* ------------------------------------------------------------------ */

/** 检测浏览器是否支持 SpeechSynthesis 且有可用语音 */
export function isBrowserTtsAvailable(): boolean {
  if (!('speechSynthesis' in window)) return false;
  const voices = window.speechSynthesis.getVoices();
  return voices.length > 0;
}

/* ------------------------------------------------------------------ */
/* 浏览器内置 TTS                                                      */
/* ------------------------------------------------------------------ */

function speakWithBrowserTtsInternal(text: string, lang = 'en-US'): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('当前浏览器不支持语音合成'));
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 0.9;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice =
      voices.find((v) => v.lang === lang) ||
      voices.find((v) => v.lang.startsWith(lang.split('-')[0]));
    if (matchedVoice) utter.voice = matchedVoice;

    utter.onend = () => resolve();
    utter.onerror = (e) => reject(new Error(e.error || '语音播放失败'));

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  });
}

/* ------------------------------------------------------------------ */
/* mimo TTS 在线服务                                                   */
/* ------------------------------------------------------------------ */

function speakWithMimoTts(text: string, _lang = 'en-US'): Promise<void> {
  const apiKey = getTtsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('浏览器不支持语音合成且未配置 mimo TTS API Key，请在设置中配置'));
  }

  return fetch(MIMO_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MIMO_TTS_MODEL,
      text,
      voice: 'default',
    }),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`mimo TTS 请求失败 (${res.status}): ${body.slice(0, 200)}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('mimo TTS 音频播放失败'));
      };
      audio.play().catch((e) => {
        URL.revokeObjectURL(url);
        reject(new Error(`mimo TTS 播放失败: ${e.message}`));
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

export async function speakWithBrowserTts(text: string, lang = 'en-US'): Promise<void> {
  // 确保 API Key 已加载（用于 fallback）
  if (!_apiKeyLoaded) {
    await loadTtsApiKey();
  }

  // 优先尝试浏览器内置 TTS
  if (isBrowserTtsAvailable()) {
    try {
      return await speakWithBrowserTtsInternal(text, lang);
    } catch (err) {
      // 浏览器 TTS 失败时，尝试回退到 mimo TTS
      if (getTtsApiKey()) {
        console.warn('[tts] 浏览器 TTS 失败，回退到 mimo TTS:', (err as Error).message);
        return speakWithMimoTts(text, lang);
      }
      throw err;
    }
  }

  // 浏览器不支持，使用 mimo TTS
  return speakWithMimoTts(text, lang);
}

/* ------------------------------------------------------------------ */
/* 语音预加载                                                          */
/* ------------------------------------------------------------------ */

export function preloadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve([]);
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      resolve(voices);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices());
    };
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1_000);
  });
}
