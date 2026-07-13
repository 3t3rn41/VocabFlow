/** 音频播放工具 */

/**
 * 播放 WAV/音频 blob。
 * 使用 Audio 元素 + blob URL，兼容性最好。
 */
export async function playWavBlob(blob: ArrayBuffer): Promise<void> {
  const blobObj = new Blob([blob], { type: 'audio/wav' });
  const url = URL.createObjectURL(blobObj);

  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error(`音频播放失败: ${e}`));
    };
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch((err) => {
        URL.revokeObjectURL(url);
        reject(new Error(`音频播放被阻止: ${err.message}`));
      });
    }
  });
}
