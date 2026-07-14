/**
 * TTS — 优先使用本地缓存音频，回退到浏览器 TTS 和 mimo TTS API
 *
 * 音频播放优先级:
 *   1. 本地缓存音频 (public/audio/ 下的 .wav 文件，通过 manifest.json 查找)
 *   2. 浏览器内置 SpeechSynthesis API
 *   3. mimo TTS 在线服务 (mimo-v2.5-tts，通过后端代理 /api/tts 转发)
 *
 * 移动端浏览器要求音频播放必须在用户手势上下文中触发，
 * 因此提供全局 audioUnlock 机制：首次用户交互时解锁音频，
 * 之后的自动朗读才能正常工作。
 *
 * 全局取消机制：每次新的播放请求会取消之前正在进行的播放，
 * 确保不会出现多个声音同时播放。
 */

/* ------------------------------------------------------------------ */
/* 全局播放取消机制                                                     */
/* ------------------------------------------------------------------ */

let _playbackId = 0;
let _currentPlaybackId = -1;

/** 当前正在播放的 Audio 元素 (本地音频 / mimo TTS) */
let _currentAudio: HTMLAudioElement | null = null;
/** 当前 Audio 使用的 Object URL (mimo TTS)，用于释放 */
let _currentObjectUrl: string | null = null;

/** 取消当前正在进行的播放 */
function cancelCurrentPlayback(): void {
  _currentPlaybackId = -1;

  // 暂停并释放当前 Audio 元素
  if (_currentAudio) {
    const audio = _currentAudio;
    _currentAudio = null;
    try {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.src = '';
    } catch { /* ignore */ }
  }

  // 释放 Object URL
  if (_currentObjectUrl) {
    URL.revokeObjectURL(_currentObjectUrl);
    _currentObjectUrl = null;
  }

  // 取消浏览器 SpeechSynthesis
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ */
/* 移动端音频解锁                                                       */
/* ------------------------------------------------------------------ */

let _audioUnlocked = false;
const _unlockCallbacks: Array<() => void> = [];

/** 解锁音频播放权限（在用户手势中调用） */
function unlockAudio(): void {
  if (_audioUnlocked) return;
  _audioUnlocked = true;

  // 解锁 SpeechSynthesis — 播放一个空 utterance
  if ('speechSynthesis' in window) {
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  // 解锁 Audio API — 播放一段极短的静音 wav
  try {
    const audio = new Audio(
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    );
    audio.volume = 0;
    audio.play().then(() => audio.pause()).catch(() => {});
  } catch { /* ignore */ }

  // 通知所有等待解锁的回调
  _unlockCallbacks.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
  _unlockCallbacks.length = 0;
}

/** 音频是否已解锁 */
export function isAudioUnlocked(): boolean {
  return _audioUnlocked;
}

/** 注册回调，音频解锁后立即执行；若已解锁则立即执行 */
export function onAudioUnlock(cb: () => void): () => void {
  if (_audioUnlocked) {
    cb();
    return () => {};
  }
  _unlockCallbacks.push(cb);
  return () => {
    const idx = _unlockCallbacks.indexOf(cb);
    if (idx >= 0) _unlockCallbacks.splice(idx, 1);
  };
}

// 全局监听首次用户交互，解锁音频
if (typeof window !== 'undefined') {
  const handler = () => {
    unlockAudio();
    window.removeEventListener('touchend', handler);
    window.removeEventListener('click', handler);
    window.removeEventListener('keydown', handler);
  };
  window.addEventListener('touchend', handler, { once: true, passive: true });
  window.addEventListener('click', handler, { once: true });
  window.addEventListener('keydown', handler, { once: true });
}

/* ------------------------------------------------------------------ */
/* 本地音频 manifest 加载与查找                                         */
/* ------------------------------------------------------------------ */

interface ManifestEntry {
  text: string;
  file: string;
  book: string;
  category: string;
}

/** text → 本地音频文件路径 的映射表 */
let _audioMap: Map<string, string> | null = null;
let _manifestLoading: Promise<void> | null = null;

/** 本地音频基础路径 (Vite public 目录映射到根路径) */
const LOCAL_AUDIO_BASE = '/audio';

/**
 * 加载 manifest.json，构建 text → file 映射表。
 * 仅加载一次，后续调用返回缓存的 Promise。
 */
export function loadAudioManifest(): Promise<void> {
  if (_audioMap) return Promise.resolve();
  if (_manifestLoading) return _manifestLoading;

  _manifestLoading = fetch(`${LOCAL_AUDIO_BASE}/manifest.json`)
    .then((res) => {
      if (!res.ok) {
        console.warn('[tts] manifest.json 加载失败，将跳过本地音频');
        _audioMap = new Map();
        return;
      }
      return res.json();
    })
    .then((data: Record<string, ManifestEntry> | undefined) => {
      _audioMap = new Map();
      if (data) {
        for (const entry of Object.values(data)) {
          if (entry.text && entry.file) {
            _audioMap.set(entry.text, entry.file);
          }
        }
      }
      console.log(`[tts] manifest 已加载，${_audioMap.size} 条本地音频记录`);
    })
    .catch((e) => {
      console.warn('[tts] manifest 加载异常，将跳过本地音频:', e);
      _audioMap = new Map();
    });

  return _manifestLoading;
}

/**
 * 查找文本对应的本地音频文件 URL。
 * 若 manifest 中不存在则返回 null。
 */
function getLocalAudioUrl(text: string): string | null {
  if (!_audioMap) return null;
  const file = _audioMap.get(text);
  if (!file) return null;
  return `${LOCAL_AUDIO_BASE}/${file}`;
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
/* 本地缓存音频播放                                                    */
/* ------------------------------------------------------------------ */

/**
 * 尝试使用本地缓存音频播放。
 * 若 manifest 中找不到对应文本，或音频加载/播放失败，返回 false。
 * 成功播放则返回 true。
 */
function speakWithLocalAudio(text: string, playbackId: number): Promise<boolean> {
  const url = getLocalAudioUrl(text);
  if (!url) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    // 如果已被取消，直接返回 false（让调用方决定是否回退）
    if (playbackId !== _currentPlaybackId) {
      resolve(false);
      return;
    }

    let resolved = false;
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      // 清理对 Audio 元素的引用
      if (_currentAudio === audio) _currentAudio = null;
      // 失败时暂停音频，防止延迟播放
      if (!ok) {
        try { audio.pause(); audio.src = ''; } catch { /* ignore */ }
      }
      resolve(ok);
    };

    const audio = new Audio(url);
    _currentAudio = audio;

    audio.onended = () => {
      finish(true);
    };

    audio.onerror = () => {
      console.warn(`[tts] 本地音频加载失败 ("${text}"), 回退到 TTS`);
      finish(false);
    };

    // 设置超时：如果 5 秒内没有开始播放，视为失败
    const timeout = setTimeout(() => {
      console.warn(`[tts] 本地音频超时 ("${text}"), 回退到 TTS`);
      finish(false);
    }, 5000);

    audio.play().then(() => {
      // 播放已开始，等待 onended
    }).catch((e) => {
      console.warn(`[tts] 本地音频播放失败 ("${text}"), 回退:`, e.message);
      finish(false);
    });
  });
}

/* ------------------------------------------------------------------ */
/* 浏览器内置 TTS                                                      */
/* ------------------------------------------------------------------ */

function speakWithBrowserTtsInternal(text: string, lang = 'en-US', playbackId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('当前浏览器不支持语音合成'));
      return;
    }

    // 如果已被取消，直接返回
    if (playbackId !== _currentPlaybackId) {
      resolve();
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

    utter.onend = () => {
      if (playbackId === _currentPlaybackId) resolve();
      else resolve(); // 已被取消，静默结束
    };
    utter.onerror = (e) => {
      if (playbackId === _currentPlaybackId) {
        reject(new Error(e.error || '语音播放失败'));
      } else {
        resolve(); // 已被取消，静默结束
      }
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  });
}

/* ------------------------------------------------------------------ */
/* mimo TTS 在线服务 (通过后端代理，避免 CORS)                          */
/* ------------------------------------------------------------------ */

function speakWithMimoTts(text: string, _lang = 'en-US', playbackId: number): Promise<void> {
  const token = localStorage.getItem('vocabflow_token');
  return fetch('/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text }),
  }).then(async (res) => {
    // 请求完成前已被取消
    if (playbackId !== _currentPlaybackId) {
      // 消费 body 以避免资源泄漏
      await res.body?.cancel().catch(() => {});
      return;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`mimo TTS 请求失败 (${res.status}): ${body.slice(0, 200)}`);
    }

    const blob = await res.blob();

    // 下载完成前已被取消
    if (playbackId !== _currentPlaybackId) {
      return;
    }

    const url = URL.createObjectURL(blob);
    _currentObjectUrl = url;

    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      _currentAudio = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (_currentObjectUrl === url) _currentObjectUrl = null;
        if (_currentAudio === audio) _currentAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (_currentObjectUrl === url) _currentObjectUrl = null;
        if (_currentAudio === audio) _currentAudio = null;
        if (playbackId === _currentPlaybackId) {
          reject(new Error('mimo TTS 音频播放失败'));
        } else {
          resolve();
        }
      };
      audio.play().catch((e) => {
        URL.revokeObjectURL(url);
        if (_currentObjectUrl === url) _currentObjectUrl = null;
        if (_currentAudio === audio) _currentAudio = null;
        if (playbackId === _currentPlaybackId) {
          reject(new Error(`mimo TTS 播放失败: ${e.message}`));
        } else {
          resolve();
        }
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 朗读文本 — 优先使用本地缓存音频，回退到浏览器 TTS，最后回退到 mimo TTS。
 *
 * 播放优先级:
 *   1. 本地缓存音频 (manifest.json 查找)
 *   2. 浏览器内置 SpeechSynthesis API
 *   3. mimo TTS 在线服务 (通过后端代理)
 */
export async function speakWithBrowserTts(text: string, lang = 'en-US'): Promise<void> {
  // 每次新播放前，取消之前正在进行的播放
  cancelCurrentPlayback();
  const playbackId = ++_playbackId;
  _currentPlaybackId = playbackId;

  // 1. 优先尝试本地缓存音频
  const localOk = await speakWithLocalAudio(text, playbackId);
  if (localOk) return;
  // 如果已被取消，不再继续
  if (playbackId !== _currentPlaybackId) return;

  // 2. 尝试浏览器内置 TTS
  if (isBrowserTtsAvailable()) {
    try {
      return await speakWithBrowserTtsInternal(text, lang, playbackId);
    } catch (err) {
      // 如果已被取消，不再回退
      if (playbackId !== _currentPlaybackId) return;
      // 浏览器 TTS 失败时，回退到 mimo TTS
      console.warn('[tts] 浏览器 TTS 失败，回退到 mimo TTS:', (err as Error).message);
      return speakWithMimoTts(text, lang, playbackId);
    }
  }

  // 3. 浏览器不支持，使用 mimo TTS
  return speakWithMimoTts(text, lang, playbackId);
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
