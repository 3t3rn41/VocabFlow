import { useEffect, useState } from 'react';
import { speakWithBrowserTts } from '@/api/tts';
import { useUiStore } from '@/stores/ui';
import { Spinner } from '@/components/ui/Spinner';

interface PronunciationButtonProps {
  spelling: string;
  /** 若为 true, 挂载/单词变化时自动播放一次 (受 settings.autoPlayAudio 控制) */
  autoPlay?: boolean;
}

/**
 * 朗读按钮 — 仅使用浏览器内置 SpeechSynthesis API。
 * 无需网络、无需 API Key。
 */
export function PronunciationButton({ spelling, autoPlay = false }: PronunciationButtonProps) {
  const [playing, setPlaying] = useState(false);
  const pushToast = useUiStore((s) => s.pushToast);

  useEffect(() => {
    if (!autoPlay) return;
    void play(spelling, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spelling, autoPlay]);

  async function play(currentSpelling: string, opts: { silent?: boolean } = {}) {
    if (playing) return;
    setPlaying(true);
    try {
      await speakWithBrowserTts(currentSpelling, 'en-US');
    } catch (e) {
      if (!opts.silent) {
        pushToast(`发音失败: ${(e as Error).message}`, 'error');
      }
    } finally {
      setPlaying(false);
    }
  }

  async function handlePlay(e?: React.MouseEvent) {
    e?.stopPropagation();
    await play(spelling);
  }

  return (
    <button
      onClick={handlePlay}
      className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-xl leading-none"
      title="朗读发音"
    >
      {playing ? <Spinner size="sm" /> : '🔊'}
    </button>
  );
}
