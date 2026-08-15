import { useEffect, type RefObject } from 'react';

interface SwipeCallbacks {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

/** 触发滑动的最小位移阈值 (px) */
const SWIPE_THRESHOLD = 50;

/**
 * 触摸手势 Hook：在移动端支持左/右/上/下滑动回调。
 * 用于复习卡片的手势操作（左滑 Again、右滑 Good、上滑翻卡、下滑跳过）。
 */
export function useSwipe<T extends HTMLElement>(
  ref: RefObject<T | null>,
  callbacks: SwipeCallbacks,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // 水平滑动优先
      if (absX > absY && absX > SWIPE_THRESHOLD) {
        if (dx > 0) callbacks.onSwipeRight?.();
        else callbacks.onSwipeLeft?.();
      } else if (absY > SWIPE_THRESHOLD) {
        if (dy > 0) callbacks.onSwipeDown?.();
        else callbacks.onSwipeUp?.();
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [ref, callbacks.onSwipeLeft, callbacks.onSwipeRight, callbacks.onSwipeUp, callbacks.onSwipeDown]);
}
