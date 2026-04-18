#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "installer_targets.json"
DOCS_PATH = ROOT / "docs"
INSTALLERS_PATH = DOCS_PATH / "installers"
MANIFEST_PATH = DOCS_PATH / "installers.json"
CACHE_PATH = ROOT / ".cache"
BASE_INSTALLER_PATH = CACHE_PATH / "base_installer.bin"
DYNAMIC_CACHE_PATH = CACHE_PATH / "dynamic"

BASE_INSTALLER_URL = os.environ.get("BASE_INSTALLER_URL", "https://openpilot.comma.ai")
INSTALLER_USER_AGENT = os.environ.get("INSTALLER_USER_AGENT", "AGNOSSetup-10.1.0")
INSTALLER_DEVICE_TYPE = os.environ.get("INSTALLER_DEVICE_TYPE", "tizi")

URL_SLOT_PATTERN = re.compile(rb"https://github\.com/commaai/openpilot\.git\?[ ]+")
BRANCH_SLOT_PATTERN = re.compile(rb"release3\?[ ]+")


def sha256_bytes(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


def ensure_dir(path: Path) -> None:
  path.mkdir(parents=True, exist_ok=True)


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


def load_targets(config_path: Path = CONFIG_PATH) -> list[dict]:
  with config_path.open() as f:
    data = json.load(f)

  if not isinstance(data, list) or not data:
    raise RuntimeError("installer_targets.json must contain a non-empty array")

  required = {"slug_owner", "slug_branch", "git_url", "git_branch", "title", "description"}
  for target in data:
    missing = sorted(required - set(target))
    if missing:
      raise RuntimeError(f"target is missing required keys: {missing}")
    aliases = target.get("aliases", [])
    if not isinstance(aliases, list):
      raise RuntimeError("aliases must be a list when present")
    for alias in aliases:
      if not isinstance(alias, str) or not alias:
        raise RuntimeError("aliases must contain non-empty strings")
      if "/" in alias:
        raise RuntimeError(f"alias must not contain '/': {alias!r}")
  return data


def build_installer(base_installer: bytes, git_url: str, git_branch: str) -> bytes:
  blob = bytearray(base_installer)
  patch_slot(blob, URL_SLOT_PATTERN, git_url, "git_url")
  patch_slot(blob, BRANCH_SLOT_PATTERN, git_branch, "git_branch")
  return bytes(blob)


def build_installer_for_target(base_installer: bytes, target: dict) -> bytes:
  installer_bytes = build_installer(base_installer, target["git_url"], target["git_branch"])
  validate_elf(installer_bytes, f"patched installer for {target['slug_owner']}/{target['slug_branch']}")
  return installer_bytes


def make_cache_key(git_url: str, git_branch: str) -> str:
  return sha256_bytes(f"{git_url}\n{git_branch}".encode("utf-8"))


def load_or_build_cached_installer(base_installer: bytes, git_url: str, git_branch: str) -> tuple[bytes, str]:
  ensure_dir(DYNAMIC_CACHE_PATH)
  cache_key = make_cache_key(git_url, git_branch)
  cache_path = DYNAMIC_CACHE_PATH / f"{cache_key}.bin"
  if cache_path.exists():
    data = cache_path.read_bytes()
    validate_elf(data, f"cached installer at {cache_path}")
    return data, cache_key

  data = build_installer(base_installer, git_url, git_branch)
  validate_elf(data, f"patched installer for {git_url}@{git_branch}")
  cache_path.write_bytes(data)
  return data, cache_key


def cleanup_generated_root_aliases(manifest_path: Path = MANIFEST_PATH, docs_path: Path = DOCS_PATH) -> None:
  manifest_data = []
  if manifest_path.exists():
    with manifest_path.open() as f:
      manifest_data = json.load(f)

  for entry in manifest_data:
    for alias in entry.get("aliases", []):
      alias_path = docs_path / alias
      if alias_path.is_file():
        alias_path.unlink()


def manifest_entry_from_target(target: dict, installer_bytes: bytes) -> dict:
  aliases = target.get("aliases", [])
  return {
    "slug_owner": target["slug_owner"],
    "slug_branch": target["slug_branch"],
    "aliases": aliases,
    "git_url": target["git_url"],
    "git_branch": target["git_branch"],
    "title": target["title"],
    "description": target["description"],
    "download_path": f"installers/{target['slug_owner']}/{target['slug_branch']}/installer",
    "download_url_hint": f"/installers/{target['slug_owner']}/{target['slug_branch']}/installer",
    "short_download_path": aliases[0] if aliases else None,
    "sha256": sha256_bytes(installer_bytes),
    "size_bytes": len(installer_bytes),
  }


def write_manifest(entries: list[dict], manifest_path: Path = MANIFEST_PATH) -> None:
  manifest_path.write_text(json.dumps(entries, indent=2) + "\n")


def parse_branch_input(raw_value: str) -> dict:
  raw = raw_value.strip()
  if not raw:
    return {"error": "Paste a GitHub branch URL, installer URL, owner/branch, or owner/repo/branch first."}

  owner_repo_branch_match = re.match(r"^([^/]+)/([^/]+)/(.+)$", raw)
  if owner_repo_branch_match:
    return {
      "owner": owner_repo_branch_match.group(1),
      "repo": owner_repo_branch_match.group(2),
      "branch": owner_repo_branch_match.group(3),
      "source_label": raw,
    }

  owner_branch_match = re.match(r"^([^/]+)/([^/]+)$", raw)
  if owner_branch_match:
    return {
      "owner": owner_branch_match.group(1),
      "repo": "openpilot",
      "branch": owner_branch_match.group(2),
      "source_label": raw,
    }

  try:
    from urllib.parse import urlparse, unquote

    parsed_url = urlparse(raw)
  except ValueError:
    return {"error": "That does not look like a valid URL or owner/branch pair."}

  if not parsed_url.scheme or not parsed_url.netloc:
    return {"error": "That does not look like a valid URL or owner/branch pair."}

  host = re.sub(r"^www\.", "", parsed_url.netloc)
  parts = [unquote(part) for part in parsed_url.path.split("/") if part]

  if host == "github.com":
    if len(parts) < 4 or parts[2] != "tree":
      return {"error": "Paste the GitHub branch root URL. Example: https://github.com/owner/repo/tree/branch-name"}

    return {
      "owner": parts[0],
      "repo": parts[1],
      "branch": "/".join(parts[3:]),
      "source_label": raw,
    }

  if host == "installer.comma.ai":
    if len(parts) < 2:
      return {"error": "Expected installer URL format: https://installer.comma.ai/owner/branch"}

    return {
      "owner": parts[0],
      "repo": "openpilot",
      "branch": "/".join(parts[1:]),
      "source_label": raw,
    }

  return {"error": "Only GitHub branch URLs, installer.comma.ai URLs, and owner/branch input are supported here."}


def find_target_by_alias(targets: list[dict], alias: str) -> dict | None:
  for target in targets:
    if alias in target.get("aliases", []):
      return target
  return None


def find_target_by_git_ref(targets: list[dict], git_url: str, git_branch: str) -> dict | None:
  for target in targets:
    if target["git_url"] == git_url and target["git_branch"] == git_branch:
      return target
  return None
