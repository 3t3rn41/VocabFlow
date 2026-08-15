import { useEffect, useState } from 'react';
import { speakWithBrowserTts, isAudioUnlocked, onAudioUnlock } from '@/api/tts';
import { useUiStore } from '@/stores/ui';
import { Spinner } from '@/components/ui/Spinner';

interface PronunciationButtonProps {
  spelling: string;
  /** 若为 true, 挂载/单词变化时自动播放一次 (受 settings.autoPlayAudio 控制) */
  autoPlay?: boolean;
}

/**
 * 朗读按钮 — 优先使用本地缓存音频，回退到浏览器 TTS 和 mimo TTS。
 *
 * 移动端浏览器要求音频播放在用户手势上下文中触发。
 * 若 autoPlay 时音频尚未解锁，会等待首次用户交互后再播放。
 *
 * tts.ts 内部有全局播放取消机制：每次新的 speakWithBrowserTts 调用
 * 会自动取消之前正在进行的播放，确保不会出现多个声音叠加。
 */
export function PronunciationButton({ spelling, autoPlay = false }: PronunciationButtonProps) {
  const [playing, setPlaying] = useState(false);
  const pushToast = useUiStore((s) => s.pushToast);

  useEffect(() => {
    if (!autoPlay) return;

    // 用闭包捕获当前的 spelling，确保播放的是正确的单词
    const targetSpelling = spelling;
    let cancelled = false;

    const doPlay = async () => {
      if (cancelled) return;
      setPlaying(true);
      try {
        await speakWithBrowserTts(targetSpelling, 'en-US');
      } catch {
        // 静默失败
      } finally {
        if (!cancelled) setPlaying(false);
      }
    };

    if (isAudioUnlocked()) {
      void doPlay();
    } else {
      const cleanup = onAudioUnlock(() => {
        if (!cancelled) void doPlay();
      });
      return () => {
        cancelled = true;
        cleanup();
      };
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spelling, autoPlay]);

  async function handlePlay(e?: React.MouseEvent) {
    e?.stopPropagation();
    setPlaying(true);
    try {
      await speakWithBrowserTts(spelling, 'en-US');
    } catch (e) {
      pushToast(`发音失败: ${(e as Error).message}`, 'error');
    } finally {
      setPlaying(false);
    }
  }

  return (
    <button
      onClick={handlePlay}
      className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-xl leading-none"
      title="朗读发音"
    >
      {playing ? <Spinner size="sm" /> : (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 5L6 9H2v6h4l5 4V5z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
