#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VocabFlow TTS 音频缓存生成脚本
================================

遍历所有词书（单词 + 句子），调用 mimo TTS API 生成 WAV 音频文件，
保存到 public/audio/ 目录下，供前端直接本地播放（免去每次实时请求 TTS）。

特性：
  - 多线程并发（默认 5 线程，可通过 --workers 调整）
  - RPM 限流（默认 100，可通过 --rpm 调整）
  - 断点续传：已存在的音频文件自动跳过
  - 自动重试：网络错误 / 5xx 自动重试（默认 3 次）
  - 进度显示：实时显示进度、耗时、剩余时间估算
  - manifest.json：记录所有文本到音频文件的映射
  - 命令行参数：可选择只处理某本词书、指定 voice、dry-run 等

用法：
  python scripts/generate_tts_cache.py                    # 处理全部词书
  python scripts/generate_tts_cache.py --book CET4        # 只处理 CET4
  python scripts/generate_tts_cache.py --dry-run           # 只统计不请求
  python scripts/generate_tts_cache.py --rpm 50            # 限制 50 RPM
  python scripts/generate_tts_cache.py --workers 10        # 10 线程并发
  python scripts/generate_tts_cache.py --voice Chloe       # 指定发音人

依赖：
  pip install requests
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait, FIRST_COMPLETED
from pathlib import Path
from typing import Optional

# ── Windows 控制台 UTF-8 修复 ──────────────────────────────────────────
# Windows 默认使用 GBK 编码，无法输出 emoji 等字符，强制切换为 UTF-8。
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import requests
except ImportError:
    print("错误: 需要安装 requests 库，请运行: pip install requests")
    sys.exit(1)

# ─── 常量 ───────────────────────────────────────────────────────────────

# 项目根目录（脚本在 scripts/ 下，往上一层就是项目根）
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# 词书 JSON 所在目录
WORDBOOKS_DIR = PROJECT_ROOT / "src" / "data" / "wordbooks"

# 音频输出目录
# 使用可变容器存储输出目录，以便运行时可通过 --output-dir 修改
_config = {
    "audio_output_dir": PROJECT_ROOT / "public" / "audio",
}

# manifest 文件路径（基于输出目录）
def _manifest_path() -> Path:
    return _config["audio_output_dir"] / "manifest.json"


def _set_output_dir(path: Path) -> None:
    """更新音频输出目录（模块级可变状态）。"""
    _config["audio_output_dir"] = path

# mimo TTS API 配置
MIMO_TTS_ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions"
MIMO_TTS_MODEL = "mimo-v2.5-tts"
MIMO_TTS_API_KEY = "sk-cjk5ja72yat4rn00w791762ntg959ley7cl3o4yr1pzig6kf"
DEFAULT_VOICE = "Chloe"
AUDIO_FORMAT = "wav"

# 默认 RPM 限制
DEFAULT_RPM = 100

# 默认线程数
DEFAULT_WORKERS = 4

# 最大重试次数
MAX_RETRIES = 3

# 重试间隔（秒）
RETRY_DELAY = 2

# ─── 线程安全打印 ───────────────────────────────────────────────────────

_print_lock = threading.Lock()


def safe_print(*args, **kwargs):
    """线程安全的 print，防止多线程输出交错混乱。"""
    with _print_lock:
        print(*args, **kwargs)


# ─── 工具函数 ───────────────────────────────────────────────────────────


def sanitize_filename(text: str, max_len: int = 80) -> str:
    """将文本转换为安全的文件名（去除特殊字符，截断长度）。"""
    # 只保留字母、数字、空格，空格替换为下划线
    safe = re.sub(r"[^\w\s-]", "", text.strip())
    safe = re.sub(r"[\s_-]+", "_", safe)
    safe = safe.strip("_").lower()
    if not safe:
        safe = hashlib.md5(text.encode("utf-8")).hexdigest()[:12]
    return safe[:max_len]


def text_hash(text: str) -> str:
    """计算文本的 MD5 哈希，用于去重和断点续传判断。"""
    return hashlib.md5(text.encode("utf-8")).hexdigest()


# ─── 速率限制器（线程安全）─────────────────────────────────────────────


class RateLimiter:
    """
    线程安全的滑动窗口速率限制器。

    在指定 RPM 内均匀分配请求，确保不超过限制。
    使用时间戳队列记录最近一分钟内的请求，若即将超限则自动等待。
    多线程环境下通过 threading.Lock 保护内部状态。
    """

    def __init__(self, rpm: int):
        self.rpm = rpm
        self.window = 60.0  # 窗口大小（秒）
        self.timestamps: deque[float] = deque()
        # 最小间隔（秒），用于平滑请求
        self.min_interval = self.window / rpm
        self._lock = threading.Lock()
        self._stop_event: Optional[threading.Event] = None

    def set_stop_event(self, event: threading.Event) -> None:
        """设置停止事件，使 acquire 中的等待可被中断。"""
        self._stop_event = event

    def _interruptible_sleep(self, seconds: float) -> bool:
        """
        可被 stop_event 中断的 sleep。
        返回 True 表示正常超时，False 表示被停止信号中断。
        """
        if self._stop_event is not None:
            return not self._stop_event.wait(timeout=seconds)
        time.sleep(seconds)
        return True

    def acquire(self) -> bool:
        """
        获取一个请求配额，若超限则阻塞等待。线程安全。
        返回 True 表示成功获取配额，False 表示被停止信号中断。
        """
        with self._lock:
            now = time.time()

            # 清理过期时间戳
            while self.timestamps and now - self.timestamps[0] > self.window:
                self.timestamps.popleft()

            # 如果窗口内请求数已达上限，等待最早的请求过期
            if len(self.timestamps) >= self.rpm:
                wait = self.window - (now - self.timestamps[0])
                if wait > 0:
                    safe_print(f"  ⏳ 速率限制：等待 {wait:.1f}s ...")
                # 在锁内等待（其他线程也会排队），使用可中断 sleep
                while True:
                    now = time.time()
                    while self.timestamps and now - self.timestamps[0] > self.window:
                        self.timestamps.popleft()
                    if len(self.timestamps) < self.rpm:
                        break
                    # 检查停止信号
                    if self._stop_event is not None and self._stop_event.is_set():
                        return False
                    # 计算需要等待的时间
                    wait = self.window - (now - self.timestamps[0]) + 0.05
                    if wait > 0:
                        # 释放锁后可中断等待
                        self._lock.release()
                        try:
                            self._interruptible_sleep(min(wait, 1.0))
                        finally:
                            self._lock.acquire()
                    now = time.time()

            now = time.time()

            # 计算距上次请求的时间，确保不小于最小间隔
            if self.timestamps:
                elapsed = now - self.timestamps[-1]
                if elapsed < self.min_interval:
                    sleep_time = self.min_interval - elapsed
                    # 可中断等待
                    self._lock.release()
                    try:
                        if not self._interruptible_sleep(sleep_time):
                            self._lock.acquire()
                            return False
                    finally:
                        self._lock.acquire()

            now = time.time()
            self.timestamps.append(now)
            return True


# ─── TTS 请求 ───────────────────────────────────────────────────────────


def request_tts(
    text: str,
    voice: str,
    rate_limiter: RateLimiter,
    max_retries: int = MAX_RETRIES,
    stop_event: Optional[threading.Event] = None,
) -> Optional[bytes]:
    """
    调用 mimo TTS API 获取音频数据。

    返回 WAV 格式的二进制数据，失败返回 None。
    线程安全：通过 rate_limiter 控制并发请求速率。
    若 stop_event 被设置，会尽快返回 None。
    """
    headers = {
        "Content-Type": "application/json",
        "api-key": MIMO_TTS_API_KEY,
    }
    payload = {
        "model": MIMO_TTS_MODEL,
        "messages": [
            {
                "role": "assistant",
                "content": text,
            }
        ],
        "audio": {
            "format": AUDIO_FORMAT,
            "voice": voice,
        },
    }

    def _stopped() -> bool:
        return stop_event is not None and stop_event.is_set()

    for attempt in range(1, max_retries + 1):
        if _stopped():
            return None
        if not rate_limiter.acquire():
            # 被停止信号中断
            return None

        try:
            resp = requests.post(
                MIMO_TTS_ENDPOINT,
                headers=headers,
                json=payload,
                timeout=60,
            )

            if resp.status_code == 429:
                # 速率被服务端拒绝，等待更长时间
                safe_print(f"  ⚠️  服务端返回 429 (Too Many Requests)，等待 10s 后重试 ...")
                if stop_event is not None:
                    stop_event.wait(timeout=10)
                else:
                    time.sleep(10)
                continue

            if resp.status_code >= 500:
                safe_print(
                    f"  ⚠️  服务端错误 {resp.status_code}，"
                    f"第 {attempt}/{max_retries} 次重试 ..."
                )
                if stop_event is not None:
                    stop_event.wait(timeout=RETRY_DELAY)
                else:
                    time.sleep(RETRY_DELAY)
                continue

            if resp.status_code != 200:
                safe_print(f"  ❌ HTTP {resp.status_code}: {resp.text[:200]}")
                return None

            content_type = resp.headers.get("content-type", "")

            # 情况 1：JSON 响应，音频以 base64 嵌入
            if "application/json" in content_type:
                data = resp.json()
                audio_data = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("audio", {})
                    .get("data")
                    if data.get("choices")
                    else None
                )
                if not audio_data:
                    # 尝试顶层 audio 字段
                    audio_data = data.get("audio", {}).get("data")

                if not audio_data:
                    safe_print(f"  ❌ 响应中未找到音频数据: {json.dumps(data)[:300]}")
                    return None

                return base64.b64decode(audio_data)

            # 情况 2：直接返回二进制音频
            if content_type.startswith("audio/") or len(resp.content) > 100:
                return resp.content

            safe_print(f"  ❌ 未知响应类型 ({content_type}): {resp.text[:200]}")
            return None

        except requests.exceptions.Timeout:
            safe_print(
                f"  ⚠️  请求超时，第 {attempt}/{max_retries} 次重试 ..."
            )
            if stop_event is not None:
                stop_event.wait(timeout=RETRY_DELAY)
            else:
                time.sleep(RETRY_DELAY)
        except requests.exceptions.ConnectionError as e:
            safe_print(
                f"  ⚠️  连接错误: {e}，第 {attempt}/{max_retries} 次重试 ..."
            )
            if stop_event is not None:
                stop_event.wait(timeout=RETRY_DELAY)
            else:
                time.sleep(RETRY_DELAY)
        except Exception as e:
            safe_print(f"  ❌ 未知错误: {e}")
            if attempt < max_retries:
                if stop_event is not None:
                    stop_event.wait(timeout=RETRY_DELAY)
                else:
                    time.sleep(RETRY_DELAY)
            else:
                return None

    safe_print(f"  ❌ 达到最大重试次数 ({max_retries})，放弃此条目")
    return None


# ─── 词书解析 ───────────────────────────────────────────────────────────


class TTSItem:
    """一个需要生成 TTS 的条目。"""

    def __init__(
        self,
        text: str,
        category: str,       # "word" | "sentence" | "example"
        book: str,           # 词书名
        sub_path: str,       # 子路径（如 "words" / "examples" / "bands_4"）
        filename: str,       # 文件名（不含扩展名）
    ):
        self.text = text
        self.category = category
        self.book = book
        self.sub_path = sub_path
        self.filename = filename
        self.h = text_hash(text)

    @property
    def relative_path(self) -> str:
        """相对于 audio 输出目录的路径（不含扩展名）。"""
        return f"{self.category}/{self.book}/{self.sub_path}/{self.filename}"

    @property
    def output_path(self) -> Path:
        """完整的输出文件路径。"""
        return _config["audio_output_dir"] / f"{self.relative_path}.{AUDIO_FORMAT}"


def parse_wordbook_simple(filepath: Path, book_name: str) -> list[TTSItem]:
    """
    解析简单格式词书: { "word": "translation", ... }
    如 zhongkao_words, CET4_words, CET6_words, gaokao_words
    """
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    items: list[TTSItem] = []
    for word in data.keys():
        word = word.strip()
        if not word:
            continue
        items.append(
            TTSItem(
                text=word,
                category="word",
                book=book_name,
                sub_path="words",
                filename=sanitize_filename(word),
            )
        )
    return items


def parse_wordbook_ielts_words(filepath: Path, book_name: str) -> list[TTSItem]:
    """
    解析 IELTS_words 格式: { "meta": {...}, "words": [ {word, example, ...}, ... ] }
    需要为每个单词和例句都生成音频。
    """
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    items: list[TTSItem] = []
    for idx, entry in enumerate(data.get("words", [])):
        word = entry.get("word", "").strip()
        if word:
            items.append(
                TTSItem(
                    text=word,
                    category="word",
                    book=book_name,
                    sub_path="words",
                    filename=sanitize_filename(word),
                )
            )

        example = entry.get("example", "").strip()
        if example:
            items.append(
                TTSItem(
                    text=example,
                    category="example",
                    book=book_name,
                    sub_path="examples",
                    filename=f"{idx:04d}_{sanitize_filename(word)}",
                )
            )
    return items


def parse_sentence_book_bands(filepath: Path, book_name: str) -> list[TTSItem]:
    """
    解析 IELTS_sentences 格式:
    { "key": { "bands": [ { "band": N, "topics": [ { "topic": ..., "dialogues": [{cn, en}] } ] } ] } }
    """
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    items: list[TTSItem] = []
    for _key, content in data.items():
        bands = content.get("bands", [])
        for band_info in bands:
            band = band_info.get("band", 0)
            for topic_idx, topic in enumerate(band_info.get("topics", [])):
                for dial_idx, dialogue in enumerate(topic.get("dialogues", [])):
                    en = dialogue.get("en", "").strip()
                    if not en:
                        continue
                    items.append(
                        TTSItem(
                            text=en,
                            category="sentence",
                            book=book_name,
                            sub_path=f"band_{band}",
                            filename=f"{topic_idx:03d}_{dial_idx:03d}",
                        )
                    )
    return items


def parse_sentence_book_levels(filepath: Path, book_name: str) -> list[TTSItem]:
    """
    解析 language_sense_sentences 格式:
    { "key": { "levels": [ { "level": "...", "topics": [ { "topic": ..., "dialogues": [{cn, en}] } ] } ] } }
    """
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    items: list[TTSItem] = []
    for _key, content in data.items():
        levels = content.get("levels", [])
        for lvl_idx, level_info in enumerate(levels):
            level_name = level_info.get("level", f"level_{lvl_idx}")
            level_safe = sanitize_filename(level_name, max_len=30)
            for topic_idx, topic in enumerate(level_info.get("topics", [])):
                for dial_idx, dialogue in enumerate(topic.get("dialogues", [])):
                    en = dialogue.get("en", "").strip()
                    if not en:
                        continue
                    items.append(
                        TTSItem(
                            text=en,
                            category="sentence",
                            book=book_name,
                            sub_path=level_safe,
                            filename=f"{topic_idx:03d}_{dial_idx:03d}",
                        )
                    )
    return items


def collect_all_items(book_filter: Optional[str] = None) -> list[TTSItem]:
    """
    收集所有词书中需要生成 TTS 的条目。

    返回 TTSItem 列表（可能包含重复文本，但文件路径不同）。
    """
    all_items: list[TTSItem] = []

    # 简单格式词书
    simple_books = {
        "zhongkao_words.json": "zhongkao",
        "CET4_words.json": "CET4",
        "CET6_words.json": "CET6",
        "gaokao_words.json": "gaokao",
    }

    # IELTS 单词格式
    ielts_word_books = {
        "IELTS_words.json": "IELTS",
    }

    # 句子格式 (bands)
    sentence_bands_books = {
        "IELTS_sentences.json": "IELTS_sentences",
    }

    # 句子格式 (levels)
    sentence_levels_books = {
        "language_sense_sentences.json": "language_sense_sentences",
    }

    def should_process(book_name: str) -> bool:
        if book_filter is None:
            return True
        return book_name.lower() == book_filter.lower()

    for filename, book_name in simple_books.items():
        if not should_process(book_name):
            continue
        filepath = WORDBOOKS_DIR / filename
        if filepath.exists():
            items = parse_wordbook_simple(filepath, book_name)
            all_items.extend(items)
            print(f"  📖 {book_name}: {len(items)} 个单词")

    for filename, book_name in ielts_word_books.items():
        if not should_process(book_name):
            continue
        filepath = WORDBOOKS_DIR / filename
        if filepath.exists():
            items = parse_wordbook_ielts_words(filepath, book_name)
            all_items.extend(items)
            print(f"  📖 {book_name}: {len(items)} 个条目（单词+例句）")

    for filename, book_name in sentence_bands_books.items():
        if not should_process(book_name):
            continue
        filepath = WORDBOOKS_DIR / filename
        if filepath.exists():
            items = parse_sentence_book_bands(filepath, book_name)
            all_items.extend(items)
            print(f"  📖 {book_name}: {len(items)} 个句子")

    for filename, book_name in sentence_levels_books.items():
        if not should_process(book_name):
            continue
        filepath = WORDBOOKS_DIR / filename
        if filepath.exists():
            items = parse_sentence_book_levels(filepath, book_name)
            all_items.extend(items)
            print(f"  📖 {book_name}: {len(items)} 个句子")

    return all_items


# ─── 多线程处理单个条目 ─────────────────────────────────────────────────


class ProcessingContext:
    """
    多线程处理期间共享的上下文对象。

    封装所有需要线程安全访问的状态：
    - 计数器（success / skipped / failed）
    - manifest 字典
    - manifest 文件写入锁
    - 失败列表
    """

    def __init__(self, manifest_path: Path, force: bool, voice: str,
                 rate_limiter: RateLimiter, total: int):
        self.manifest_path = manifest_path
        self.force = force
        self.voice = voice
        self.rate_limiter = rate_limiter
        self.total = total

        # 停止信号 — Ctrl+C 时设置，通知所有工作线程尽快退出
        self.stop_event = threading.Event()

        # 线程安全计数器
        self._lock = threading.Lock()
        self._manifest_lock = threading.Lock()
        self.success = 0
        self.skipped = 0
        self.failed = 0
        self.completed = 0  # 已处理总数（含跳过）
        self.manifest: dict[str, dict] = {}
        self.failed_items: list[TTSItem] = []
        self.start_time = time.time()

    def add_success(self, item: TTSItem, file_size: int):
        with self._lock:
            self.success += 1
            self.completed += 1

    def add_skip(self):
        with self._lock:
            self.skipped += 1
            self.completed += 1

    def add_failure(self, item: TTSItem):
        with self._lock:
            self.failed += 1
            self.completed += 1
            self.failed_items.append(item)

    def update_manifest(self, item: TTSItem):
        with self._manifest_lock:
            self.manifest[item.h] = {
                "text": item.text,
                "file": f"{item.relative_path}.{AUDIO_FORMAT}",
                "book": item.book,
                "category": item.category,
            }

    def save_manifest(self):
        with self._manifest_lock:
            try:
                with open(self.manifest_path, "w", encoding="utf-8") as f:
                    json.dump(self.manifest, f, ensure_ascii=False, indent=2)
            except Exception as e:
                safe_print(f"  ⚠️  保存 manifest 失败: {e}")

    def get_progress(self) -> tuple[int, int, int, int, float]:
        """返回 (completed, success, skipped, failed, elapsed)。"""
        with self._lock:
            elapsed = time.time() - self.start_time
            return self.completed, self.success, self.skipped, self.failed, elapsed


def process_single_item(item: TTSItem, idx: int, ctx: ProcessingContext) -> str:
    """
    处理单个 TTS 条目（在线程池中执行）。

    返回 "success" / "skipped" / "failed" / "cancelled"。
    若 ctx.stop_event 被设置，会尽快返回 "cancelled"。
    """
    # 检查停止信号
    if ctx.stop_event.is_set():
        return "cancelled"

    # 检查是否已存在（断点续传）
    if not ctx.force and item.output_path.exists():
        ctx.update_manifest(item)
        ctx.add_skip()
        return "skipped"

    # 再次检查停止信号（跳过检查可能耗时）
    if ctx.stop_event.is_set():
        return "cancelled"

    # 显示当前条目
    display_text = item.text if len(item.text) <= 60 else item.text[:57] + "..."
    safe_print(
        f"  [{idx}/{ctx.total}] 🎵 {item.book}/{item.category}/{item.filename}  "
        f"\"{display_text}\""
    )

    # 请求 TTS
    audio_data = request_tts(
        text=item.text,
        voice=ctx.voice,
        rate_limiter=ctx.rate_limiter,
        stop_event=ctx.stop_event,
    )

    if audio_data and len(audio_data) > 0:
        # 确保目录存在
        item.output_path.parent.mkdir(parents=True, exist_ok=True)
        # 写入文件（每个条目路径不同，无需加锁）
        with open(item.output_path, "wb") as f:
            f.write(audio_data)

        ctx.update_manifest(item)
        ctx.add_success(item, len(audio_data))
        file_size = len(audio_data)
        safe_print(f"  [{idx}/{ctx.total}] ✅ 成功 ({file_size:,} bytes)")
        return "success"
    else:
        ctx.add_failure(item)
        safe_print(f"  [{idx}/{ctx.total}] ❌ 失败")
        return "failed"


# ─── 主流程 ─────────────────────────────────────────────────────────────


def format_duration(seconds: float) -> str:
    """格式化时长为 HH:MM:SS。"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}h{m:02d}m{s:02d}s"
    return f"{m}m{s:02d}s"


def main():
    parser = argparse.ArgumentParser(
        description="VocabFlow TTS 音频缓存生成脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/generate_tts_cache.py                  # 处理全部词书
  python scripts/generate_tts_cache.py --book CET4       # 只处理 CET4
  python scripts/generate_tts_cache.py --dry-run          # 只统计不请求
  python scripts/generate_tts_cache.py --rpm 50           # 限制 50 RPM
  python scripts/generate_tts_cache.py --workers 10       # 10 线程并发
  python scripts/generate_tts_cache.py --voice Chloe      # 指定发音人
  python scripts/generate_tts_cache.py --force            # 强制重新生成
        """,
    )
    parser.add_argument(
        "--book",
        type=str,
        default=None,
        help="只处理指定的词书（如 CET4, CET6, IELTS 等）",
    )
    parser.add_argument(
        "--rpm",
        type=int,
        default=DEFAULT_RPM,
        help=f"每分钟最大请求数（默认 {DEFAULT_RPM}）",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"并发线程数（默认 {DEFAULT_WORKERS}）",
    )
    parser.add_argument(
        "--voice",
        type=str,
        default=DEFAULT_VOICE,
        help=f"TTS 发音人（默认 {DEFAULT_VOICE}）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只统计条目数量，不实际请求 TTS",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制重新生成（忽略已存在的文件）",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(_config["audio_output_dir"]),
        help=f"音频输出目录（默认 {_config['audio_output_dir']}）",
    )

    args = parser.parse_args()

    _set_output_dir(Path(args.output_dir))
    manifest_path = _manifest_path()

    print("=" * 60)
    print("  VocabFlow TTS 音频缓存生成脚本")
    print("=" * 60)
    print()

    # 1. 收集所有条目
    print("📋 第 1 步：收集所有词书条目 ...")
    print()
    items = collect_all_items(book_filter=args.book)
    print()
    print(f"  总计 {len(items)} 个条目")

    if not items:
        print("  没有找到任何条目，请检查词书文件是否存在。")
        return

    # 按文本去重（同一文本只需生成一次）
    seen_hashes: dict[str, TTSItem] = {}
    for item in items:
        if item.h not in seen_hashes:
            seen_hashes[item.h] = item

    unique_count = len(seen_hashes)
    print(f"  去重后 {unique_count} 个唯一条目")
    print()

    if args.dry_run:
        print("🔍 Dry-run 模式：仅统计，不请求 TTS")
        print()
        # 按类别统计
        from collections import Counter
        cat_counts = Counter(item.category for item in items)
        for cat, cnt in cat_counts.most_common():
            print(f"  {cat}: {cnt}")
        print()

        # 按词书统计
        book_counts = Counter(item.book for item in items)
        for book, cnt in book_counts.most_common():
            print(f"  {book}: {cnt}")
        print()

        # 估算时间
        est_seconds = unique_count / args.rpm * 60
        print(f"  预计耗时（{args.rpm} RPM, {args.workers} 线程）: {format_duration(est_seconds)}")
        print()
        return

    # 2. 创建输出目录
    output_dir = _config["audio_output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"📁 输出目录: {output_dir}")
    print()

    # 3. 加载已有 manifest（用于断点续传）
    manifest: dict[str, dict] = {}
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            print(f"📄 已加载 manifest: {len(manifest)} 条记录")
        except Exception as e:
            print(f"⚠️  加载 manifest 失败: {e}，将创建新的 manifest")
    else:
        print("📄 未找到 manifest，将创建新的")
    print()

    # 4. 速率限制器 & 上下文
    rate_limiter = RateLimiter(rpm=args.rpm)
    ctx = ProcessingContext(
        manifest_path=manifest_path,
        force=args.force,
        voice=args.voice,
        rate_limiter=rate_limiter,
        total=len(items),
    )
    # 将已加载的 manifest 传入上下文
    ctx.manifest = manifest
    # 将停止信号绑定到速率限制器，使其内部等待也可被中断
    rate_limiter.set_stop_event(ctx.stop_event)

    print(f"🚦 速率限制: {args.rpm} RPM（最小间隔 {rate_limiter.min_interval:.2f}s）")
    print(f"🔧 并发线程: {args.workers}")
    print(f"🎤 发音人: {args.voice}")
    print()

    # 5. 多线程生成
    print("🎙️  第 2 步：开始生成 TTS 音频（多线程）...")
    print()

    total = len(items)
    start_time = time.time()

    # ── 多线程处理（支持 Ctrl+C 优雅退出）──────────────────────────
    # 不使用 with 语句，因为 with 的 __exit__ 会调用 shutdown(wait=True)，
    # 阻塞直到所有线程完成，导致 Ctrl+C 无法立即终止。
    # 改为手动管理 executor，用 futures_wait(timeout=) 轮询，
    # 使主线程能及时响应 KeyboardInterrupt。
    executor = ThreadPoolExecutor(max_workers=args.workers)
    # 提交所有任务
    future_to_item: dict = {}
    for idx, item in enumerate(items, 1):
        future = executor.submit(process_single_item, item, idx, ctx)
        future_to_item[future] = (idx, item)

    manifest_save_counter = 0
    interrupted = False

    try:
        # 用 futures_wait + timeout 轮询，使主线程能响应 Ctrl+C
        pending = set(future_to_item.keys())
        while pending:
            done, pending = futures_wait(pending, timeout=0.5,
                                         return_when=FIRST_COMPLETED)
            for future in done:
                idx, item = future_to_item[future]
                try:
                    result = future.result()
                    if result == "cancelled":
                        # 被停止信号取消，不计入失败
                        pass
                except Exception as e:
                    safe_print(f"  [{idx}/{total}] ❌ 线程异常: {e}")
                    ctx.add_failure(item)

                # 定期保存 manifest（每 50 个完成保存一次）
                manifest_save_counter += 1
                if manifest_save_counter % 50 == 0:
                    ctx.save_manifest()

            # 定期显示进度
            completed, success, skipped, failed, elapsed = ctx.get_progress()
            if completed > 0 and (completed % 100 == 0 or completed == total):
                if elapsed > 0:
                    speed = completed / elapsed * 60  # items per minute
                    remaining = (total - completed) / speed * 60 if speed > 0 else 0
                else:
                    remaining = 0
                safe_print(
                    f"  📊 进度: {completed}/{total} "
                    f"(✅{success} ⏭️{skipped} ❌{failed})  "
                    f"{format_duration(elapsed)} 已过, "
                    f"剩余 ~{format_duration(remaining)}"
                )

    except KeyboardInterrupt:
        interrupted = True
        print()
        print("  ⛔ 收到 Ctrl+C，正在停止所有任务 ...")
        # 1. 设置停止信号，通知正在运行的工作线程尽快退出
        ctx.stop_event.set()
        # 2. 取消所有尚未开始执行的 future
        cancelled_count = 0
        for future in pending:
            future.cancel()
            cancelled_count += 1
        # 3. 等待正在运行的线程完成（最多等 10 秒）
        if pending:
            print(f"  ⏳ 等待 {cancelled_count} 个未执行任务取消，"
                  f"正在运行的线程最多等待 10s ...")
            # 对仍 pending 的 future 再等一轮（让运行中的线程有机会退出）
            _, still_pending = futures_wait(
                [f for f in future_to_item if not f.done()],
                timeout=10,
                return_when=FIRST_COMPLETED,
            )
            if still_pending:
                print(f"  ⚠️  {len(still_pending)} 个任务仍在运行，强制关闭。")
        # 4. 关闭线程池（不等待）
        executor.shutdown(wait=False, cancel_futures=True)
        print("  ✅ 已停止。")
        print()

    # 5b. 如果不是 with 块，需要手动关闭 executor
    if not interrupted:
        executor.shutdown(wait=True)

    # 6. 最终保存 manifest
    print()
    print("💾 保存 manifest ...")
    ctx.save_manifest()
    completed, success, skipped, failed, elapsed = ctx.get_progress()
    print(f"   manifest 已保存: {manifest_path} ({len(ctx.manifest)} 条)")

    # 7. 汇总
    print()
    print("=" * 60)
    print("  📊 生成完成！")
    print("=" * 60)
    print(f"  总条目:   {total}")
    print(f"  ✅ 成功:  {success}")
    print(f"  ⏭️  跳过: {skipped}")
    print(f"  ❌ 失败:  {failed}")
    print(f"  ⏱️  耗时:  {format_duration(elapsed)}")
    print(f"  📁 目录:  {output_dir}")
    print(f"  📄 Manifest: {manifest_path}")

    if ctx.failed_items:
        print()
        print("  失败条目列表:")
        for item in ctx.failed_items:
            print(f"    - {item.book}/{item.category}/{item.filename}: \"{item.text[:50]}\"")

        # 保存失败列表
        failed_path = output_dir / "failed_items.json"
        with open(failed_path, "w", encoding="utf-8") as f:
            json.dump(
                [
                    {
                        "text": item.text,
                        "book": item.book,
                        "category": item.category,
                        "filename": item.filename,
                    }
                    for item in ctx.failed_items
                ],
                f,
                ensure_ascii=False,
                indent=2,
            )
        print(f"  失败列表已保存: {failed_path}")
        print()
        print("  💡 可以重新运行脚本来重试失败的条目（已成功的会自动跳过）")

    print()


if __name__ == "__main__":
    main()
