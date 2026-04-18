#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from installer_lib import (
  DOCS_PATH,
  ROOT,
  INSTALLERS_PATH,
  build_installer_for_target,
  cleanup_generated_root_aliases,
  ensure_dir,
  fetch_base_installer,
  load_targets,
  manifest_entry_from_target,
  write_manifest,
)

FEATURED_GROUPS_PATH = ROOT / "featured_groups.json"
FEATURED_BRANCHES_PATH = DOCS_PATH / "featured-branches.json"


def reset_output_dirs() -> None:
  ensure_dir(DOCS_PATH)
  cleanup_generated_root_aliases()
  if INSTALLERS_PATH.exists():
    shutil.rmtree(INSTALLERS_PATH)
  ensure_dir(INSTALLERS_PATH)


def load_featured_groups() -> list[dict]:
  if not FEATURED_GROUPS_PATH.exists():
    return []

  import json

  with FEATURED_GROUPS_PATH.open() as f:
    groups = json.load(f)

  if not isinstance(groups, list):
    raise RuntimeError("featured_groups.json must contain an array")

  return groups


def fetch_remote_branches(git_url: str) -> list[str]:
  output = subprocess.check_output(
    ["git", "ls-remote", "--heads", git_url],
    text=True,
  )
  branches = []
  for line in output.splitlines():
    if "refs/heads/" not in line:
      continue
    branches.append(line.split("refs/heads/", 1)[1])

  return sorted(branches, key=lambda value: value.lower())


def write_featured_branches() -> None:
  import json

  featured_groups = load_featured_groups()
  payload = []
  for group in featured_groups:
    payload.append({
      **group,
      "branches": fetch_remote_branches(group["git_url"]),
    })

  FEATURED_BRANCHES_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
  targets = load_targets()
  base_installer = fetch_base_installer()
  reset_output_dirs()

  manifest: list[dict] = []
  for target in targets:
    installer_bytes = build_installer_for_target(base_installer, target)

    out_dir = INSTALLERS_PATH / target["slug_owner"] / target["slug_branch"]
    ensure_dir(out_dir)
    (out_dir / "installer").write_bytes(installer_bytes)

    for alias in target.get("aliases", []):
      (DOCS_PATH / alias).write_bytes(installer_bytes)

    manifest.append(manifest_entry_from_target(target, installer_bytes))

  write_manifest(manifest)
  write_featured_branches()
  print(f"generated {len(manifest)} installer(s)")
  for entry in manifest:
    print(f"- {entry['slug_owner']}/{entry['slug_branch']} -> {entry['download_path']}")


if __name__ == "__main__":
  main()
