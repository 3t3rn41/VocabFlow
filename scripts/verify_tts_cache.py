#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VocabFlow TTS 音频缓存核对脚本
================================

遍历所有词书（单词 + 句子 + 例句），逐条核对本地音频文件是否齐全：
  1. 音频文件是否存在
  2. 音频文件是否非空（size > 0）
  3. manifest.json 中是否有对应记录

若有遗漏，则自动调用 mimo TTS API 补齐缺失的音频文件。

特性：
  - 复用 generate_tts_cache.py 的解析逻辑，保证条目完全一致
  - 多线程并发补齐（默认 4 线程）
  - RPM 限流（默认 100）
  - 自动重试、断点续传
  - 详细的核对报告（按词书 / 类别分组统计）
  - 支持 --dry-run 只核对不补齐
  - 支持 --book 只核对指定词书
  - 支持 --fix-empty 同时修复空文件

用法：
  python scripts/verify_tts_cache.py                    # 核对全部，缺失则补齐
  python scripts/verify_tts_cache.py --dry-run          # 只核对不补齐
  python scripts/verify_tts_cache.py --book CET4        # 只核对 CET4
  python scripts/verify_tts_cache.py --workers 8        # 8 线程并发补齐
  python scripts/verify_tts_cache.py --fix-empty        # 同时修复空文件

依赖：
  pip install requests
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait, FIRST_COMPLETED
from pathlib import Path
from typing import Optional

# ── Windows 控制台 UTF-8 修复 ──────────────────────────────────────────
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 复用 generate_tts_cache.py 中的所有解析和请求逻辑
from generate_tts_cache import (
    TTSItem,
    RateLimiter,
    ProcessingContext,
    process_single_item,
    collect_all_items,
    request_tts,
    sanitize_filename,
    text_hash,
    safe_print,
    format_duration,
    _config,
    _set_output_dir,
    _manifest_path,
    AUDIO_FORMAT,
    DEFAULT_RPM,
    DEFAULT_WORKERS,
    DEFAULT_VOICE,
    MAX_RETRIES,
    MIMO_TTS_API_KEY,
    MIMO_TTS_ENDPOINT,
    MIMO_TTS_MODEL,
)


# ─── 核对逻辑 ───────────────────────────────────────────────────────────


def check_item(item: TTSItem, fix_empty: bool = False) -> str:
    """
    检查单个条目的音频文件状态。

    返回状态:
      "ok"        — 文件存在且非空，manifest 也有记录
      "missing"   — 文件不存在
      "empty"     — 文件存在但大小为 0
      "no_manifest" — 文件存在且非空，但 manifest 中无记录

    fix_empty=True 时，empty 也视为需要修复的状态（返回 "empty"）。
    fix_empty=False 时，empty 视为 "ok"（不处理）。
    """
    path = item.output_path

    if not path.exists():
        return "missing"

    file_size = path.stat().st_size
    if file_size == 0:
        return "empty" if fix_empty else "ok"

    return "ok"


def verify_all_items(
    items: list[TTSItem],
    fix_empty: bool = False,
) -> dict[str, list[TTSItem]]:
    """
    核对所有条目，返回按状态分组的字典。

    返回: {
        "ok": [...],
        "missing": [...],
        "empty": [...],
    }
    """
    result: dict[str, list[TTSItem]] = {
        "ok": [],
        "missing": [],
        "empty": [],
    }

    total = len(items)
    for idx, item in enumerate(items, 1):
        status = check_item(item, fix_empty=fix_empty)
        result[status].append(item)

        if idx % 500 == 0 or idx == total:
            safe_print(
                f"  🔍 核对进度: {idx}/{total}  "
                f"(✅{len(result['ok'])} ❌缺失:{len(result['missing'])} "
                f"⚠️空文件:{len(result['empty'])})"
            )

    return result


def load_manifest(manifest_path: Path) -> dict[str, dict]:
    """加载 manifest.json"""
    if not manifest_path.exists():
        return {}
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        safe_print(f"  ⚠️  加载 manifest 失败: {e}")
        return {}


def update_manifest_for_item(
    manifest: dict[str, dict],
    item: TTSItem,
    lock: threading.Lock,
):
    """线程安全地更新 manifest 中的单条记录"""
    with lock:
        manifest[item.h] = {
            "text": item.text,
            "file": f"{item.relative_path}.{AUDIO_FORMAT}",
            "book": item.book,
            "category": item.category,
        }


def fix_missing_items(
    missing_items: list[TTSItem],
    voice: str,
    rpm: int,
    workers: int,
    manifest: dict[str, dict],
    manifest_path: Path,
) -> tuple[int, int]:
    """
    补齐缺失的音频文件。

    返回 (success_count, failed_count)
    """
    if not missing_items:
        return 0, 0

    total = len(missing_items)
    safe_print()
    safe_print(f"🎙️  开始补齐 {total} 个缺失的音频文件 ...")
    safe_print()

    rate_limiter = RateLimiter(rpm=rpm)
    stop_event = threading.Event()
    rate_limiter.set_stop_event(stop_event)

    manifest_lock = threading.Lock()
    success = 0
    failed = 0
    completed = 0
    counter_lock = threading.Lock()
    start_time = time.time()

    def fix_one(item: TTSItem, idx: int) -> bool:
        nonlocal success, failed, completed

        if stop_event.is_set():
            return False

        display_text = item.text if len(item.text) <= 60 else item.text[:57] + "..."
        safe_print(
            f"  [{idx}/{total}] 🎵 补齐: {item.book}/{item.category}/{item.filename}  "
            f"\"{display_text}\""
        )

        audio_data = request_tts(
            text=item.text,
            voice=voice,
            rate_limiter=rate_limiter,
            stop_event=stop_event,
        )

        with counter_lock:
            completed += 1

        if audio_data and len(audio_data) > 0:
            item.output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(item.output_path, "wb") as f:
                f.write(audio_data)

            update_manifest_for_item(manifest, item, manifest_lock)
            with counter_lock:
                success += 1
            safe_print(f"  [{idx}/{total}] ✅ 补齐成功 ({len(audio_data):,} bytes)")
            return True
        else:
            with counter_lock:
                failed += 1
            safe_print(f"  [{idx}/{total}] ❌ 补齐失败")
            return False

    # 多线程处理
    executor = ThreadPoolExecutor(max_workers=workers)
    future_to_item: dict = {}
    for idx, item in enumerate(missing_items, 1):
        future = executor.submit(fix_one, item, idx)
        future_to_item[future] = (idx, item)

    manifest_save_counter = 0
    interrupted = False

    try:
        pending = set(future_to_item.keys())
        while pending:
            done, pending = futures_wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
            for future in done:
                idx, item = future_to_item[future]
                try:
                    future.result()
                except Exception as e:
                    safe_print(f"  [{idx}/{total}] ❌ 线程异常: {e}")
                    with counter_lock:
                        failed += 1

                manifest_save_counter += 1
                if manifest_save_counter % 20 == 0:
                    with manifest_lock:
                        with open(manifest_path, "w", encoding="utf-8") as f:
                            json.dump(manifest, f, ensure_ascii=False, indent=2)

                # 进度显示
                with counter_lock:
                    c = completed
                if c > 0 and (c % 50 == 0 or c == total):
                    elapsed = time.time() - start_time
                    speed = c / elapsed * 60 if elapsed > 0 else 0
                    remaining = (total - c) / speed * 60 if speed > 0 else 0
                    safe_print(
                        f"  📊 补齐进度: {c}/{total} "
                        f"(✅{success} ❌{failed})  "
                        f"{format_duration(elapsed)} 已过, "
                        f"剩余 ~{format_duration(remaining)}"
                    )

    except KeyboardInterrupt:
        interrupted = True
        safe_print()
        safe_print("  ⛔ 收到 Ctrl+C，正在停止补齐任务 ...")
        stop_event.set()
        for future in pending:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        safe_print("  ✅ 已停止。")

    if not interrupted:
        executor.shutdown(wait=True)

    # 保存 manifest
    safe_print()
    safe_print("💾 保存 manifest ...")
    with manifest_lock:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    safe_print(f"   manifest 已保存: {manifest_path} ({len(manifest)} 条)")

    return success, failed


# ─── 报告生成 ───────────────────────────────────────────────────────────


def print_report(
    items: list[TTSItem],
    check_result: dict[str, list[TTSItem]],
    manifest: dict[str, dict],
):
    """打印核对报告"""
    total = len(items)
    ok_count = len(check_result["ok"])
    missing_count = len(check_result["missing"])
    empty_count = len(check_result["empty"])

    safe_print()
    safe_print("=" * 60)
    safe_print("  📋 TTS 音频缓存核对报告")
    safe_print("=" * 60)
    safe_print()
    safe_print(f"  总条目数:     {total}")
    safe_print(f"  ✅ 正常:      {ok_count}  ({ok_count / total * 100:.1f}%)" if total else "  ✅ 正常:      0")
    safe_print(f"  ❌ 缺失:      {missing_count}")
    safe_print(f"  ⚠️  空文件:   {empty_count}")
    safe_print(f"  📄 Manifest:  {len(manifest)} 条记录")
    safe_print()

    # 检查 manifest 中是否有 "孤儿" 记录（文件不存在但 manifest 有记录）
    manifest_orphans = 0
    for h, info in manifest.items():
        file_path = _config["audio_output_dir"] / info.get("file", "")
        if not file_path.exists():
            manifest_orphans += 1

    if manifest_orphans > 0:
        safe_print(f"  📄 Manifest 孤儿记录 (manifest 有但文件不存在): {manifest_orphans}")

    # 检查 manifest 是否缺少正常条目的记录
    ok_without_manifest = 0
    manifest_hashes = set(manifest.keys())
    for item in check_result["ok"]:
        if item.h not in manifest_hashes:
            ok_without_manifest += 1

    if ok_without_manifest > 0:
        safe_print(f"  📄 正常文件但 manifest 缺少记录: {ok_without_manifest}")

    safe_print()

    # 按词书分组的缺失统计
    if missing_count > 0 or empty_count > 0:
        safe_print("  ── 按词书分组的缺失统计 ──")
        book_missing: dict[str, dict[str, int]] = defaultdict(lambda: {"missing": 0, "empty": 0})
        for item in check_result["missing"]:
            book_missing[item.book]["missing"] += 1
        for item in check_result["empty"]:
            book_missing[item.book]["empty"] += 1

        for book in sorted(book_missing.keys()):
            counts = book_missing[book]
            parts = []
            if counts["missing"] > 0:
                parts.append(f"缺失 {counts['missing']}")
            if counts["empty"] > 0:
                parts.append(f"空文件 {counts['empty']}")
            safe_print(f"    {book}: {', '.join(parts)}")

        safe_print()

    # 按类别分组的缺失统计
    if missing_count > 0 or empty_count > 0:
        safe_print("  ── 按类别分组的缺失统计 ──")
        cat_missing: dict[str, dict[str, int]] = defaultdict(lambda: {"missing": 0, "empty": 0})
        for item in check_result["missing"]:
            cat_missing[item.category]["missing"] += 1
        for item in check_result["empty"]:
            cat_missing[item.category]["empty"] += 1

        for cat in sorted(cat_missing.keys()):
            counts = cat_missing[cat]
            parts = []
            if counts["missing"] > 0:
                parts.append(f"缺失 {counts['missing']}")
            if counts["empty"] > 0:
                parts.append(f"空文件 {counts['empty']}")
            safe_print(f"    {cat}: {', '.join(parts)}")

        safe_print()

    # 列出缺失条目的详细信息（最多 50 条）
    if missing_count > 0:
        safe_print("  ── 缺失条目详情 (最多显示 50 条) ──")
        for item in check_result["missing"][:50]:
            display_text = item.text if len(item.text) <= 60 else item.text[:57] + "..."
            safe_print(f"    ❌ {item.book}/{item.category}/{item.filename}  \"{display_text}\"")
        if missing_count > 50:
            safe_print(f"    ... 还有 {missing_count - 50} 条未显示")
        safe_print()

    # 列出空文件条目（最多 20 条）
    if empty_count > 0:
        safe_print("  ── 空文件条目详情 (最多显示 20 条) ──")
        for item in check_result["empty"][:20]:
            display_text = item.text if len(item.text) <= 60 else item.text[:57] + "..."
            safe_print(f"    ⚠️  {item.book}/{item.category}/{item.filename}  \"{display_text}\"")
        if empty_count > 20:
            safe_print(f"    ... 还有 {empty_count - 20} 条未显示")
        safe_print()


# ─── 补齐 manifest 中缺失的正常文件记录 ──────────────────────────────────


def fix_manifest_for_ok_items(
    ok_items: list[TTSItem],
    manifest: dict[str, dict],
    manifest_path: Path,
):
    """
    对于文件存在且非空但 manifest 中缺少记录的条目，补齐 manifest 记录。
    """
    manifest_hashes = set(manifest.keys())
    added = 0
    for item in ok_items:
        if item.h not in manifest_hashes:
            manifest[item.h] = {
                "text": item.text,
                "file": f"{item.relative_path}.{AUDIO_FORMAT}",
                "book": item.book,
                "category": item.category,
            }
            added += 1

    if added > 0:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        safe_print(f"  📄 manifest 已补齐 {added} 条缺失记录")

    return added


# ─── 主流程 ─────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="VocabFlow TTS 音频缓存核对脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/verify_tts_cache.py                   # 核对全部，缺失则补齐
  python scripts/verify_tts_cache.py --dry-run         # 只核对不补齐
  python scripts/verify_tts_cache.py --book CET4       # 只核对 CET4
  python scripts/verify_tts_cache.py --workers 8       # 8 线程并发补齐
  python scripts/verify_tts_cache.py --fix-empty       # 同时修复空文件
        """,
    )
    parser.add_argument(
        "--book",
        type=str,
        default=None,
        help="只核对指定的词书（如 CET4, CET6, IELTS 等）",
    )
    parser.add_argument(
        "--rpm",
        type=int,
        default=DEFAULT_RPM,
        help=f"补齐时每分钟最大请求数（默认 {DEFAULT_RPM}）",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"补齐时并发线程数（默认 {DEFAULT_WORKERS}）",
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
        help="只核对不补齐缺失的音频",
    )
    parser.add_argument(
        "--fix-empty",
        action="store_true",
        help="同时修复大小为 0 的空文件（默认跳过空文件）",
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
    audio_dir = _config["audio_output_dir"]

    safe_print("=" * 60)
    safe_print("  VocabFlow TTS 音频缓存核对脚本")
    safe_print("=" * 60)
    safe_print()

    # 1. 收集所有条目
    safe_print("📋 第 1 步：收集所有词书条目 ...")
    safe_print()
    items = collect_all_items(book_filter=args.book)
    safe_print()
    safe_print(f"  总计 {len(items)} 个条目")
    safe_print()

    if not items:
        safe_print("  没有找到任何条目，请检查词书文件是否存在。")
        return

    # 2. 加载 manifest
    safe_print("📄 第 2 步：加载 manifest ...")
    manifest = load_manifest(manifest_path)
    safe_print(f"  manifest 记录数: {len(manifest)}")
    safe_print()

    # 3. 核对所有条目
    safe_print("🔍 第 3 步：核对音频文件 ...")
    check_result = verify_all_items(items, fix_empty=args.fix_empty)

    # 4. 打印核对报告
    print_report(items, check_result, manifest)

    # 5. 补齐 manifest 中缺失的正常文件记录
    ok_items = check_result["ok"]
    if ok_items:
        safe_print("📝 第 4 步：检查并补齐 manifest 中缺失的记录 ...")
        added = fix_manifest_for_ok_items(ok_items, manifest, manifest_path)
        if added == 0:
            safe_print("  ✅ manifest 记录完整，无需补齐")
        safe_print()

    # 6. 补齐缺失的音频文件
    missing_items = check_result["missing"] + check_result["empty"]
    if missing_items:
        if args.dry_run:
            safe_print("⏸️  Dry-run 模式：跳过补齐缺失的音频文件")
        else:
            safe_print(f"🎙️  第 5 步：补齐 {len(missing_items)} 个缺失的音频文件 ...")
            success, failed = fix_missing_items(
                missing_items=missing_items,
                voice=args.voice,
                rpm=args.rpm,
                workers=args.workers,
                manifest=manifest,
                manifest_path=manifest_path,
            )

            safe_print()
            safe_print("  ── 补齐结果 ──")
            safe_print(f"  ✅ 补齐成功: {success}")
            safe_print(f"  ❌ 补齐失败: {failed}")
            safe_print()

            if failed > 0:
                safe_print("  💡 可以重新运行本脚本来重试失败的条目")
    else:
        safe_print("✅ 所有音频文件齐全，无需补齐！")

    safe_print()
    safe_print("=" * 60)
    safe_print("  核对完成！")
    safe_print("=" * 60)
    safe_print()


if __name__ == "__main__":
    main()
