import { useCallback, useEffect, useState } from 'react';
import { preloadVoices, loadAudioManifest } from '@/api/tts';

/**
 * 应用启动初始化。
 * 预加载浏览器语音引擎和本地音频 manifest，确保 TTS 可用。
 * 设置和活跃词书的加载在 App.tsx 中通过 store.init() 完成。
 */
export function useAppData() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(() => {
    setError(null);
    Promise.resolve()
      .then(() => Promise.all([preloadVoices(), loadAudioManifest()]))
      .then(() => setReady(true))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[app] init failed', e);
        setError(msg);
        // 语音/manifest 加载失败不应阻塞应用
        setReady(true);
      });
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  const retry = useCallback(() => {
    setReady(false);
    init();
  }, [init]);

  return { ready, error, retry };
}
