/**
 * ASR（自动语音识别）路由
 *
 * 接收客户端录制并发送的 WAV 音频，
 * 在服务端使用 Transformers.js 运行 Whisper 模型进行语音识别。
 *
 * 模型在首次请求时惰性加载，之后缓存在内存中，后续请求直接使用。
 * 模型文件由 Transformers.js 自动下载并缓存到磁盘（~/.cache 或 node_modules/.cache）。
 *
 * 流程：
 *   POST /api/asr  (body: WAV binary)
 *   → 解析 WAV 提取 PCM Float32Array
 *   → Whisper pipeline 推理
 *   → 返回 { text: "识别文本" }
 */

import { Router, raw } from 'express';
import { pipeline, env } from '@huggingface/transformers';
import { requireAuth } from '../middleware/auth.js';

export const asrRouter = Router();

// 服务端使用 Node.js 原生 fs，模型自动下载到磁盘缓存
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.useFSCache = true;

// 使用国内镜像加速模型下载（HuggingFace 官方在国内常被墙）
env.remoteHost = 'https://hf-mirror.com/';

const MODEL_ID = 'Xenova/whisper-tiny.en';

let transcriber: any = null;
let loadingPromise: Promise<any> | null = null;

/** 惰性加载 Whisper 模型（仅首次请求时触发下载） */
async function getTranscriber(): Promise<any> {
  if (transcriber) return transcriber;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const mirrors = [
      'https://hf-mirror.com/',
      'https://huggingface.co/',
    ];

    let lastError: unknown = null;

    for (const mirror of mirrors) {
      env.remoteHost = mirror;
      try {
        console.log(`[asr] Loading Whisper model from ${mirror} (~40MB download)...`);
        transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
          dtype: 'q8',
          progress_callback: (data: { status: string; progress?: number; file?: string }) => {
            if (data.status === 'progress' && data.progress !== undefined) {
              console.log(`[asr]   ${data.file}: ${Math.round(data.progress)}%`);
            } else if (data.status === 'ready') {
              console.log('[asr] Model ready.');
            }
          },
        });
        console.log('[asr] Whisper model loaded successfully.');
        return transcriber;
      } catch (err) {
        console.error(`[asr] Failed to load from ${mirror}:`, err);
        lastError = err;
      }
    }

    throw lastError;
  })();

  return loadingPromise;
}

/**
 * 从 WAV Buffer 中提取 16kHz 单声道 Float32Array
 *
 * WAV 格式：RIFF header + fmt chunk + data chunk
 */
function wavBufferToFloat32(buffer: Buffer): Float32Array {
  // 读取 WAV 头部
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // 验证 RIFF 头
  if (view.getUint32(0, true) !== 0x46464952) {
    throw new Error('Invalid WAV: missing RIFF header');
  }

  // 查找 fmt 和 data chunk
  let offset = 12; // 跳过 RIFF + size + WAVE
  let sampleRate = 16000;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset < view.byteLength - 8) {
    const chunkId = view.getUint32(offset, true);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 0x20746d66) {
      // 'fmt '
      sampleRate = view.getUint16(offset + 12, true);
      numChannels = view.getUint16(offset + 10, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 0x61746164) {
      // 'data'
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    // chunks are word-aligned (padded to even bytes)
    if (chunkSize % 2 === 1) offset += 1;
  }

  if (dataOffset < 0) {
    throw new Error('Invalid WAV: no data chunk found');
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataLength / (bytesPerSample * numChannels));
  const result = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const byteOffset = dataOffset + (i * numChannels + ch) * bytesPerSample;
      if (bitsPerSample === 16) {
        const sample = view.getInt16(byteOffset, true);
        sum += sample / 32768;
      } else if (bitsPerSample === 32) {
        const sample = view.getFloat32(byteOffset, true);
        sum += sample;
      } else if (bitsPerSample === 8) {
        const sample = view.getUint8(byteOffset) - 128;
        sum += sample / 128;
      }
    }
    result[i] = sum / numChannels;
  }

  // 如果采样率不是 16kHz，进行重采样
  if (sampleRate !== 16000) {
    return resample(result, sampleRate, 16000);
  }

  return result;
}

/** 线性插值重采样 */
function resample(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return data;
  const ratio = fromRate / toRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const floor = Math.floor(srcIdx);
    const ceil = Math.min(floor + 1, data.length - 1);
    const frac = srcIdx - floor;
    result[i] = data[floor] * (1 - frac) + data[ceil] * frac;
  }
  return result;
}

/**
 * POST /api/asr
 *
 * Body: WAV 格式音频二进制数据 (Content-Type: audio/wav)
 * Response: { text: string }
 */
asrRouter.post('/', requireAuth, raw({ type: 'audio/wav', limit: '10mb' }), async (req, res) => {
  try {
    const wavBuffer = req.body as Buffer;

    if (!wavBuffer || wavBuffer.length < 44) {
      res.status(400).json({ error: '音频数据过短' });
      return;
    }

    // 解析 WAV 为 Float32Array
    let audioData: Float32Array;
    try {
      audioData = wavBufferToFloat32(wavBuffer);
    } catch (e) {
      res.status(400).json({ error: `WAV 解析失败: ${(e as Error).message}` });
      return;
    }

    // 最小音频长度（0.3 秒）
    if (audioData.length < 16000 * 0.3) {
      res.status(400).json({ error: '录音太短' });
      return;
    }

    // 加载模型（首次会下载）
    let pipe;
    try {
      pipe = await getTranscriber();
    } catch (e) {
      res.status(503).json({ error: `模型加载失败: ${(e as Error).message}` });
      return;
    }

    // Whisper 推理
    // 注意：whisper-tiny.en 是英文专用模型，不能传 language/task 参数
    const output = await pipe(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = ((output as { text: string }).text || '').trim();
    res.json({ text });
  } catch (e) {
    console.error('[asr] Error:', e);
    res.status(500).json({ error: String(e) });
  }
});

/** 检查模型是否已就绪 */
export function isASRReady(): boolean {
  return transcriber !== null;
}

/**
 * 服务启动时预加载模型（不阻塞服务启动）
 * 在 index.ts 的 app.listen 回调中调用
 */
export function preloadASRModel(): void {
  if (transcriber || loadingPromise) return;
  console.log('[asr] Preloading Whisper model on server startup...');
  getTranscriber().catch((err) => {
    console.error('[asr] Preload failed:', err);
  });
}

/**
 * GET /api/asr/status
 *
 * 检查 ASR 服务状态（模型是否已加载）
 */
asrRouter.get('/status', requireAuth, async (_req, res) => {
  res.json({
    loaded: transcriber !== null,
    loading: loadingPromise !== null && transcriber === null,
  });
});
