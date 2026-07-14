/**
 * TTS 代理路由
 *
 * 前端直接请求 mimo TTS API 会被浏览器 CORS 策略拦截（尤其在移动端）。
 * 通过后端代理转发请求，避免跨域问题。
 *
 * mimo TTS 使用 chat/completions 接口，请求格式：
 *   - Header: api-key
 *   - Body:   { model, messages, audio: { format, voice } }
 * 响应为 JSON，音频以 base64 编码嵌在 choices[0].message.audio.data 中。
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const ttsRouter = Router();

const MIMO_TTS_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const MIMO_TTS_API_KEY = 'sk-cjk5ja72yat4rn00w791762ntg959ley7cl3o4yr1pzig6kf';

ttsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const { text, voice } = req.body as { text: string; voice?: string };

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: '缺少 text 参数' });
      return;
    }

    const apiRes = await fetch(MIMO_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': MIMO_TTS_API_KEY,
      },
      body: JSON.stringify({
        model: MIMO_TTS_MODEL,
        messages: [
          {
            role: 'assistant',
            content: text,
          },
        ],
        audio: {
          format: 'wav',
          voice: voice ?? 'Chloe',
        },
      }),
    });

    if (!apiRes.ok) {
      const body = await apiRes.text().catch(() => '');
      res.status(apiRes.status).json({
        error: `mimo TTS 请求失败 (${apiRes.status}): ${body.slice(0, 300)}`,
      });
      return;
    }

    const contentType = apiRes.headers.get('content-type') ?? '';

    // 情况 1：响应是 JSON（chat/completions 标准格式）
    if (contentType.includes('application/json')) {
      const json = await apiRes.json() as {
        choices?: Array<{
          message?: {
            audio?: {
              data?: string;   // base64 编码的音频
              format?: string;
            };
          };
        }>;
        audio?: {
          data?: string;
          format?: string;
        };
      };

      // 尝试从 choices[0].message.audio.data 提取音频
      const audioData =
        json.choices?.[0]?.message?.audio?.data ??
        json.audio?.data ??
        null;

      if (!audioData) {
        res.status(500).json({ error: 'mimo TTS 返回中未找到音频数据', raw: JSON.stringify(json).slice(0, 500) });
        return;
      }

      const audioFormat = json.choices?.[0]?.message?.audio?.format ?? json.audio?.format ?? 'wav';
      const buf = Buffer.from(audioData, 'base64');

      res.setHeader('Content-Type', `audio/${audioFormat}`);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(buf);
      return;
    }

    // 情况 2：响应直接是二进制音频流
    const arrayBuffer = await apiRes.arrayBuffer();
    const binaryContentType = contentType || 'audio/wav';

    res.setHeader('Content-Type', binaryContentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(Buffer.from(arrayBuffer));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
