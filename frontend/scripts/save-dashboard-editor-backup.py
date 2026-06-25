#!/usr/bin/env python3
"""從瀏覽器 LevelDB 完整備份儀表板編輯器資料（不覆寫 demoPlane.snapshot.json）。"""
from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONSTANTS_DIR = ROOT / "src/features/dashboard/constants"
BACKUPS_DIR = CONSTANTS_DIR / "backups"
TEMPLATES_DIR = ROOT / "public/dashboard-templates"
SNAPSHOT_PATH = CONSTANTS_DIR / "demoPlane.snapshot.json"

STORAGE_KEYS = [
    "syncdrive_dashboard_planes",
    "syncdrive_dashboard_layout_seed",
    "syncdrive_datasources",
    "syncdrive_vehicle_definitions",
    "syncdrive-map-library-v1",
]

LEVELDB_SOURCES = [
    Path.home() / "Library/Application Support/Google/Chrome/Default/Local Storage/leveldb",
    Path.home() / "Library/Application Support/Cursor/Partitions/cursor-browser/Local Storage/leveldb",
]


def read_leveldb_blob(directory: Path) -> bytes:
    if not directory.is_dir():
        return b""
    parts: list[bytes] = []
    for name in sorted(directory.iterdir()):
        if name.suffix not in {".ldb", ".log"}:
            continue
        try:
            parts.append(name.read_bytes())
        except OSError:
            pass
    return b"".join(parts)


def parse_json_value(raw: bytes) -> object | None:
    if not raw:
        return None

    candidates: list[str] = []
    for enc in ("utf-16-le", "utf-8"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        text = text.strip("\x00").strip()
        if text:
            candidates.append(text)

    for text in candidates:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

    for text in candidates:
        for match in re.finditer(r"(\{.*\}|\[.*\])", text, re.DOTALL):
            snippet = match.group(1)
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                continue
    return None


def extract_after_key(blob: bytes, key: str) -> object | None:
    needle = key.encode("utf-8")
    idx = blob.find(needle)
    if idx < 0:
        return None

    after = blob[idx + len(needle) :]

    utf16_arr = after.find(b"[\x00")
    utf16_obj = after.find(b"{\x00")
    utf8_arr = after.find(b"[")
    utf8_obj = after.find(b"{")

    candidates: list[tuple[int, str]] = []
    if utf16_arr >= 0:
        candidates.append((utf16_arr, "utf-16-le"))
    if utf16_obj >= 0:
        candidates.append((utf16_obj, "utf-16-le"))
    if utf8_arr >= 0:
        candidates.append((utf8_arr, "utf-8"))
    if utf8_obj >= 0:
        candidates.append((utf8_obj, "utf-8"))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0])

    for start, enc in candidates:
        segment = after[start:]
        if enc == "utf-16-le":
            # Chrome LevelDB 以 UTF-16LE 儲存；一次解碼後截取完整 JSON
            text = segment[:12_000_000].decode("utf-16-le", errors="ignore").strip("\x00").strip()
        else:
            text = segment[:6_000_000].decode("utf-8", errors="ignore").strip("\x00").strip()

        parsed = parse_top_level_json(text)
        if parsed is not None:
            return parsed

    return None


def parse_top_level_json(text: str) -> object | None:
    if not text:
        return None
    opener = text[0]
    if opener not in "[{":
        return None
    closer = "]" if opener == "[" else "}"
    depth = 0
    in_string = False
    escaped = False
    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[: i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def collect_referenced_data_sources(plane: dict, all_sources: list[dict]) -> list[dict]:
    needed: set[str] = set()
    for el in plane.get("elements", []) or []:
        if el.get("dataSourceId"):
            needed.add(el["dataSourceId"])
        for child in el.get("children", []) or []:
            if child.get("dataSourceId"):
                needed.add(child["dataSourceId"])
            if child.get("mqttDataSourceId"):
                needed.add(child["mqttDataSourceId"])
    return [ds for ds in all_sources if ds.get("id") in needed]


def main() -> int:
    import sys

    label = re.sub(r"[^a-zA-Z0-9_-]", "-", sys.argv[1] if len(sys.argv) > 1 else "user-tuned")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    backup_base = f"dashboard-editor-backup-{stamp}-{label}"

    blobs = [(src, read_leveldb_blob(src)) for src in LEVELDB_SOURCES]
    blobs = [(src, blob) for src, blob in blobs if blob]

    if not blobs:
        print("找不到任何 LevelDB 資料")
        return 1

    storage: dict[str, object | None] = {}
    source_used: dict[str, str] = {}

    for key in STORAGE_KEYS:
        storage[key] = None
        for src, blob in blobs:
            value = extract_after_key(blob, key)
            if value is not None:
                storage[key] = value
                source_used[key] = str(src)
                break

    planes = storage.get("syncdrive_dashboard_planes")
    if not isinstance(planes, list) or not planes:
        print("找不到 syncdrive_dashboard_planes")
        print("已搜尋：")
        for src, _ in blobs:
            print(f"  - {src}")
        return 1

    demo_plane = next((p for p in planes if p.get("id") == "demo-plane"), planes[0])
    data_sources = storage.get("syncdrive_datasources") or []
    if not isinstance(data_sources, list):
        data_sources = []

    exported_at = datetime.now(timezone.utc).isoformat()
    full_backup = {
        "kind": "syncdrive-dashboard-editor-backup",
        "version": 1,
        "exportedAt": exported_at,
        "label": label,
        "sourcePaths": source_used,
        "storage": storage,
        "summary": {
            "planeCount": len(planes),
            "demoPlaneName": demo_plane.get("name"),
            "demoElementCount": len(demo_plane.get("elements", []) or []),
            "demoLayoutVersion": demo_plane.get("demoLayoutVersion"),
            "vehicleDefinitionCount": len(storage.get("syncdrive_vehicle_definitions") or []),
            "dataSourceCount": len(data_sources),
            "mapLibraryCount": len(storage.get("syncdrive-map-library-v1") or []),
        },
    }

    plane_body = dict(demo_plane)
    plane_body.pop("id", None)
    plane_body.pop("createdAt", None)
    plane_body.pop("updatedAt", None)

    template_file = {
        "kind": "syncdrive-dashboard-template",
        "version": 1,
        "exportedAt": exported_at,
        "meta": {
            "name": demo_plane.get("name", "Dashboard backup"),
            "description": f"User backup ({label}) — do not auto-restore",
        },
        "dataSources": collect_referenced_data_sources(demo_plane, data_sources),
        "plane": plane_body,
    }

    vehicle_backup = {
        "kind": "syncdrive-vehicle-definitions-backup",
        "version": 1,
        "exportedAt": exported_at,
        "label": label,
        "vehicles": storage.get("syncdrive_vehicle_definitions") or [],
    }

    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

    full_backup_path = BACKUPS_DIR / f"{backup_base}.full.json"
    template_path = TEMPLATES_DIR / f"{backup_base}.template.json"
    plane_snapshot_path = BACKUPS_DIR / f"{backup_base}.demo-plane.json"
    vehicle_path = BACKUPS_DIR / f"{backup_base}.vehicles.json"
    preserved_snapshot_path = BACKUPS_DIR / f"demoPlane.snapshot.preserved-{stamp}.json"

    full_backup_path.write_text(json.dumps(full_backup, ensure_ascii=False, indent=2), encoding="utf-8")
    template_path.write_text(json.dumps(template_file, ensure_ascii=False, indent=2), encoding="utf-8")
    plane_snapshot_path.write_text(json.dumps(demo_plane, ensure_ascii=False, indent=2), encoding="utf-8")
    vehicle_path.write_text(json.dumps(vehicle_backup, ensure_ascii=False, indent=2), encoding="utf-8")

    if SNAPSHOT_PATH.exists():
        shutil.copy2(SNAPSHOT_PATH, preserved_snapshot_path)

    print("Dashboard editor backup saved (existing files NOT overwritten):")
    print(f"  full:      {full_backup_path}")
    print(f"  template:  {template_path}")
    print(f"  demoPlane: {plane_snapshot_path}")
    print(f"  vehicles:  {vehicle_path}")
    if preserved_snapshot_path.exists():
        print(f"  preserved: {preserved_snapshot_path}")
    print(
        "  summary: "
        f"{full_backup['summary']['planeCount']} plane(s), "
        f"{full_backup['summary']['demoElementCount']} elements, "
        f"v{full_backup['summary']['demoLayoutVersion']}, "
        f"{full_backup['summary']['vehicleDefinitionCount']} vehicle defs"
    )
    print("  source: Chrome/Cursor LevelDB")
    for key, path in source_used.items():
        print(f"    {key}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
