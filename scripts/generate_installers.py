#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "installer_targets.json"
DOCS_PATH = ROOT / "docs"
INSTALLERS_PATH = DOCS_PATH / "installers"
MANIFEST_PATH = DOCS_PATH / "installers.json"
CACHE_PATH = ROOT / ".cache"
BASE_INSTALLER_PATH = CACHE_PATH / "base_installer.bin"

BASE_INSTALLER_URL = os.environ.get("BASE_INSTALLER_URL", "https://openpilot.comma.ai")
INSTALLER_USER_AGENT = os.environ.get("INSTALLER_USER_AGENT", "AGNOSSetup-10.1.0")
INSTALLER_DEVICE_TYPE = os.environ.get("INSTALLER_DEVICE_TYPE", "tizi")

URL_SLOT_PATTERN = re.compile(rb"https://github\.com/commaai/openpilot\.git\?[ ]+")
BRANCH_SLOT_PATTERN = re.compile(rb"release3\?[ ]+")


def sha256_bytes(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


def ensure_dir(path: Path) -> None:
  path.mkdir(parents=True, exist_ok=True)


def fetch_base_installer() -> bytes:
  ensure_dir(CACHE_PATH)
  if BASE_INSTALLER_PATH.exists():
    data = BASE_INSTALLER_PATH.read_bytes()
    validate_elf(data, f"cached installer at {BASE_INSTALLER_PATH}")
    return data

  headers = {
    "User-Agent": INSTALLER_USER_AGENT,
    "X-openpilot-device-type": INSTALLER_DEVICE_TYPE,
  }
  request = urllib.request.Request(BASE_INSTALLER_URL, headers=headers)
  with urllib.request.urlopen(request, timeout=30) as response:
    data = response.read()

  validate_elf(data, f"download from {BASE_INSTALLER_URL}")
  BASE_INSTALLER_PATH.write_bytes(data)
  return data


def validate_elf(data: bytes, source: str) -> None:
  if data[:4] != b"\x7fELF":
    raise RuntimeError(f"expected ELF data from {source}, got {data[:32]!r}")


def patch_slot(blob: bytearray, pattern: re.Pattern[bytes], value: str, label: str) -> None:
  match = pattern.search(blob)
  if match is None:
    raise RuntimeError(f"could not find {label} slot in installer template")

  slot_len = match.end() - match.start()
  encoded = value.encode("utf-8")
  if len(encoded) + 1 > slot_len:
    raise RuntimeError(
      f"{label} value is too long for template slot: {value!r} ({len(encoded)} bytes > {slot_len - 1})"
    )

  replacement = encoded + b"?" + (b" " * (slot_len - len(encoded) - 1))
  blob[match.start():match.end()] = replacement


def load_targets() -> list[dict]:
  with CONFIG_PATH.open() as f:
    data = json.load(f)

  if not isinstance(data, list) or not data:
    raise RuntimeError("installer_targets.json must contain a non-empty array")

  required = {"slug_owner", "slug_branch", "git_url", "git_branch", "title", "description"}
  for target in data:
    missing = sorted(required - set(target))
    if missing:
      raise RuntimeError(f"target is missing required keys: {missing}")
  return data


def build_installer(base_installer: bytes, target: dict) -> bytes:
  blob = bytearray(base_installer)
  patch_slot(blob, URL_SLOT_PATTERN, target["git_url"], "git_url")
  patch_slot(blob, BRANCH_SLOT_PATTERN, target["git_branch"], "git_branch")
  return bytes(blob)


def reset_output_dirs() -> None:
  ensure_dir(DOCS_PATH)
  if INSTALLERS_PATH.exists():
    shutil.rmtree(INSTALLERS_PATH)
  ensure_dir(INSTALLERS_PATH)


def write_manifest(entries: list[dict]) -> None:
  MANIFEST_PATH.write_text(json.dumps(entries, indent=2) + "\n")


def main() -> None:
  targets = load_targets()
  base_installer = fetch_base_installer()
  reset_output_dirs()

  manifest: list[dict] = []
  for target in targets:
    installer_bytes = build_installer(base_installer, target)
    validate_elf(installer_bytes, f"patched installer for {target['slug_owner']}/{target['slug_branch']}")

    out_dir = INSTALLERS_PATH / target["slug_owner"] / target["slug_branch"]
    ensure_dir(out_dir)
    out_path = out_dir / "installer"
    out_path.write_bytes(installer_bytes)

    manifest.append({
      "slug_owner": target["slug_owner"],
      "slug_branch": target["slug_branch"],
      "git_url": target["git_url"],
      "git_branch": target["git_branch"],
      "title": target["title"],
      "description": target["description"],
      "download_path": f"installers/{target['slug_owner']}/{target['slug_branch']}/installer",
      "download_url_hint": f"/installers/{target['slug_owner']}/{target['slug_branch']}/installer",
      "sha256": sha256_bytes(installer_bytes),
      "size_bytes": len(installer_bytes),
    })

  write_manifest(manifest)
  print(f"generated {len(manifest)} installer(s)")
  for entry in manifest:
    print(f"- {entry['slug_owner']}/{entry['slug_branch']} -> {entry['download_path']}")


if __name__ == "__main__":
  main()

