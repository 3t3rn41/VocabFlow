import { useState, useRef, useCallback, useEffect } from 'react';
import { UnifiedASR, type ASRProvider, type ASRStatus } from '@/lib/asr';

export interface UseSpeechRecognitionOptions {
  lang?: string;
}

export interface UseSpeechRecognitionReturn {
  /** 是否正在录音识别 */
  isListening: boolean;
  /** 最终识别结果 */
  transcript: string;
  /** 中间识别结果（实时更新，Whisper 模式下可能为"正在识别..."） */
  interimTranscript: string;
  /** 错误信息 */
  error: string | null;
  /** 语音识别是否可用（任意 provider 可用即为 true） */
  isSupported: boolean;
  /** 识别置信度 (0-1) */
  confidence: number;
  /** 当前使用的 ASR provider */
  provider: ASRProvider;
  /** ASR 状态信息（含提示文字） */
  statusMessage: string;
  /** 是否正在检测可用 ASR 方案 */
  isDetecting: boolean;
  /** 开始录音 */
  start: () => void;
  /** 停止录音 */
  stop: () => void;
  /** 重置状态 */
  reset: () => void;
}

/**
 * 统一语音识别 Hook
 *
 * 自动选择最佳 ASR 方案：
 * - Tier 1: Web Speech API（Chrome/Edge/Safari）— 实时中间结果
 * - Tier 2: Whisper WASM（Firefox/所有浏览器）— 浏览器内 Whisper 模型识别
 *
 * 确保**所有设备/浏览器**均可使用语音识别功能。
 */
export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang = 'en-US' } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [provider, setProvider] = useState<ASRProvider>('none');
  const [statusMessage, setStatusMessage] = useState('正在检测语音识别支持...');
  const [isDetecting, setIsDetecting] = useState(true);
  const [isSupported, setIsSupported] = useState(false);

  const asrRef = useRef<UnifiedASR | null>(null);
  const statusRef = useRef<ASRStatus | null>(null);

  // 初始化：检测可用 ASR 方案
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const status = await UnifiedASR.detectProvider();
      if (cancelled) return;

      statusRef.current = status;
      setProvider(status.provider);
      setStatusMessage(status.message);
      setIsSupported(status.available);
      setIsDetecting(false);

      // 创建 ASR 实例
      if (status.available) {
        asrRef.current = new UnifiedASR();
      }
    })();

    return () => {
      cancelled = false;
      if (asrRef.current) {
        asrRef.current.destroy();
        asrRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    if (!asrRef.current) {
      setError('语音识别不可用');
      return;
    }
    if (isListening) return;

    setError(null);
    setTranscript('');
    setInterimTranscript('');
    setConfidence(0);

    asrRef.current.start(lang, {
      onResult: (result) => {
        setTranscript(result.text);
        setConfidence(result.confidence);
        setInterimTranscript('');
      },
      onInterim: (text) => {
        setInterimTranscript(text);
      },
      onError: (err) => {
        setError(err);
      },
      onEnd: () => {
        setIsListening(false);
        setInterimTranscript('');
      },
    });

    setIsListening(true);
  }, [lang, isListening]);

  const stop = useCallback(() => {
    if (asrRef.current) {
      asrRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
    setConfidence(0);
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    confidence,
    provider,
    statusMessage,
    isDetecting,
    start,
    stop,
    reset,
  };
}
