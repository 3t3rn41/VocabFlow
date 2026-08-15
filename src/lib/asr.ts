/**
 * 统一 ASR（自动语音识别）模块
 *
 * 双层策略确保所有浏览器/设备均可使用语音识别：
 *
 * Tier 1 — Web Speech API（浏览器内置）
 *   ✓ Chrome / Edge / Safari / Chrome Android
 *   ✗ Firefox / 部分移动端浏览器
 *   优点：零配置、实时中间结果
 *
 * Tier 2 — 服务端 ASR（通过已有后端 Whisper 推理）
 *   ✓ 所有支持 getUserMedia + fetch 的浏览器（含 Firefox）
 *   无需额外运行任何服务！利用项目已有的 Node.js 后端
 *   原理：ScriptProcessorNode 录音 → 转 WAV → POST /api/asr → 返回文本
 *
 * 自动检测：优先使用 Web Speech API，不可用时回退到服务端 ASR
 */

import { getToken } from '@/api/client';

/* ================================================================
   类型定义
   ================================================================ */

export type ASRProvider = 'web-speech' | 'server-asr' | 'none';

export interface ASRResult {
  text: string;
  confidence: number;
}

export interface ASRStatus {
  provider: ASRProvider;
  available: boolean;
  message: string;
}

export interface ASRHandlers {
  onResult?: (result: ASRResult) => void;
  onInterim?: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

/* ================================================================
   Tier 1: Web Speech API
   ================================================================ */

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => ISpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition ??
    null
  );
}

export function isWebSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

class WebSpeechASR {
  private recognition: ISpeechRecognition | null = null;
  private listening = false;

  start(lang: string, handlers: ASRHandlers): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      handlers.onError?.('浏览器不支持 Web Speech API');
      return;
    }
    if (this.recognition && this.listening) return;

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => { this.listening = true; };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = '';
      let interimText = '';
      let maxConf = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        if (result.isFinal) {
          finalText += alt.transcript;
          if (alt.confidence > maxConf) maxConf = alt.confidence;
        } else {
          interimText += alt.transcript;
        }
      }

      if (finalText) {
        handlers.onResult?.({ text: finalText.trim(), confidence: maxConf || 0.9 });
      }
      if (interimText) {
        handlers.onInterim?.(interimText);
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') {
        handlers.onError?.('未检测到语音，请再试一次');
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        handlers.onError?.('麦克风权限被拒绝');
      } else if (event.error === 'network') {
        handlers.onError?.('网络错误，语音识别需要联网');
      } else if (event.error !== 'aborted') {
        handlers.onError?.(`识别错误: ${event.error}`);
      }
    };

    rec.onend = () => {
      this.listening = false;
      handlers.onEnd?.();
    };

    this.recognition = rec;
    try { rec.start(); } catch { /* ignore InvalidStateError */ }
  }

  stop(): void {
    if (this.recognition && this.listening) {
      try { this.recognition.stop(); } catch { /* ignore */ }
    }
    this.listening = false;
  }

  abort(): void {
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
    }
    this.listening = false;
  }
}

/* ================================================================
   Tier 2: 服务端 ASR
   ================================================================ */

/** 检测 getUserMedia 是否可用（所有现代浏览器均支持） */
export function isServerASRAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * 将 Float32Array PCM 数据编码为 16kHz 单声道 WAV 文件
 *
 * 使用线性插值重采样到 16kHz，然后写入标准 WAV 格式
 */
function encodeWav(float32: Float32Array, sampleRate: number): Blob {
  // 重采样到 16kHz
  let data = float32;
  if (sampleRate !== 16000) {
    const ratio = sampleRate / 16000;
    const newLength = Math.round(float32.length / ratio);
    data = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const floor = Math.floor(srcIdx);
      const ceil = Math.min(floor + 1, float32.length - 1);
      const frac = srcIdx - floor;
      data[i] = float32[floor] * (1 - frac) + float32[ceil] * frac;
    }
  }

  // 转换为 16-bit PCM
  const pcm16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // 构建 WAV 文件
  const buffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);           // chunk size
  view.setUint16(20, 1, true);            // audio format (PCM)
  view.setUint16(22, 1, true);            // num channels (mono)
  view.setUint32(24, 16000, true);        // sample rate
  view.setUint32(28, 32000, true);        // byte rate
  view.setUint16(32, 2, true);            // block align
  view.setUint16(34, 16, true);           // bits per sample

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, pcm16.length * 2, true);

  // 写入 PCM 数据
  const pcmBytes = new Uint8Array(pcm16.buffer);
  const dataView = new Uint8Array(buffer, 44);
  dataView.set(pcmBytes);

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * 服务端 ASR 识别器
 *
 * 流程：
 * 1. getUserMedia 获取麦克风流
 * 2. AudioContext + ScriptProcessorNode 直接采集 Float32 PCM 样本
 * 3. 停止录音后，重采样到 16kHz 并编码为 WAV
 * 4. POST WAV 到 /api/asr 端点
 * 5. 服务端运行 Whisper 推理并返回文本
 */
class ServerASR {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private recording = false;
  private handlers: ASRHandlers | null = null;
  private recordedChunks: Float32Array[] = [];
  private sourceSampleRate = 44100;

  async start(_lang: string, handlers: ASRHandlers): Promise<void> {
    if (this.recording) return;
    this.handlers = handlers;
    this.recordedChunks = [];

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch {
      handlers.onError?.('无法访问麦克风，请检查浏览器权限设置');
      return;
    }

    this.audioContext = new AudioContext();
    this.sourceSampleRate = this.audioContext.sampleRate;
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    const bufferSize = 4096;
    this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.recording) return;
      const channelData = e.inputBuffer.getChannelData(0);
      this.recordedChunks.push(new Float32Array(channelData));
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);

    this.recording = true;
  }

  stop(): void {
    if (!this.recording) return;
    this.recording = false;

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    this.processAudio();
  }

  private async processAudio(): Promise<void> {
    if (this.recordedChunks.length === 0) {
      this.handlers?.onError?.('未录制到音频');
      this.handlers?.onEnd?.();
      return;
    }

    try {
      this.handlers?.onInterim?.('正在处理音频...');

      // 合并所有 chunks
      const totalLength = this.recordedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.recordedChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this.recordedChunks = [];

      // 最小音频长度检查（至少 0.3 秒）
      const minSamples = this.sourceSampleRate * 0.3;
      if (merged.length < minSamples) {
        this.handlers?.onError?.('录音太短，请长按录音按钮');
        this.handlers?.onEnd?.();
        return;
      }

      // 编码为 WAV
      const wavBlob = encodeWav(merged, this.sourceSampleRate);

      this.handlers?.onInterim?.('正在识别...');

      // 发送到服务端 ASR 端点
      const token = getToken();
      const response = await fetch('/api/asr', {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: wavBlob,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        this.handlers?.onError?.(errBody.error || `服务端 ASR 请求失败 (${response.status})`);
        this.handlers?.onEnd?.();
        return;
      }

      const result = await response.json() as { text: string };
      this.handlers?.onResult?.({ text: result.text, confidence: 0.9 });
    } catch (e) {
      this.handlers?.onError?.(`音频处理失败: ${(e as Error).message}`);
    } finally {
      this.handlers?.onEnd?.();
    }
  }

  destroy(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }
}

/* ================================================================
   统一 ASR 管理器
   ================================================================ */

export class UnifiedASR {
  private webSpeech = new WebSpeechASR();
  private serverASR: ServerASR | null = null;
  private currentProvider: ASRProvider = 'none';
  private active = false;

  get provider(): ASRProvider {
    return this.currentProvider;
  }

  get isListening(): boolean {
    return this.active;
  }

  static async detectProvider(): Promise<ASRStatus> {
    // Tier 1: Web Speech API
    if (isWebSpeechSupported()) {
      return {
        provider: 'web-speech',
        available: true,
        message: '浏览器内置语音识别',
      };
    }

    // Tier 2: 服务端 ASR
    if (isServerASRAvailable()) {
      return {
        provider: 'server-asr',
        available: true,
        message: '服务端语音识别',
      };
    }

    return {
      provider: 'none',
      available: false,
      message: '当前浏览器不支持语音识别',
    };
  }

  async start(lang: string, handlers: ASRHandlers): Promise<void> {
    if (this.active) return;

    // Tier 1: Web Speech API
    if (isWebSpeechSupported()) {
      this.currentProvider = 'web-speech';
      this.active = true;
      this.webSpeech.start(lang, {
        ...handlers,
        onEnd: () => {
          this.active = false;
          handlers.onEnd?.();
        },
      });
      return;
    }

    // Tier 2: 服务端 ASR
    if (isServerASRAvailable()) {
      this.currentProvider = 'server-asr';
      this.active = true;
      if (!this.serverASR) {
        this.serverASR = new ServerASR();
      }
      await this.serverASR.start(lang, {
        ...handlers,
        onEnd: () => {
          this.active = false;
          handlers.onEnd?.();
        },
      });
      return;
    }

    handlers.onError?.('当前浏览器不支持语音识别');
  }

  stop(): void {
    if (this.currentProvider === 'web-speech') {
      this.webSpeech.stop();
    } else if (this.currentProvider === 'server-asr' && this.serverASR) {
      this.serverASR.stop();
    }
    this.active = false;
  }

  destroy(): void {
    this.webSpeech.abort();
    if (this.serverASR) {
      this.serverASR.destroy();
      this.serverASR = null;
    }
    this.active = false;
  }
}
