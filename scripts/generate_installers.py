#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from installer_lib import (
  DOCS_PATH,
  INSTALLERS_PATH,
  build_installer_for_target,
  cleanup_generated_root_aliases,
  ensure_dir,
  fetch_base_installer,
  load_targets,
  manifest_entry_from_target,
  write_manifest,
)


def reset_output_dirs() -> None:
  ensure_dir(DOCS_PATH)
  cleanup_generated_root_aliases()
  if INSTALLERS_PATH.exists():
    shutil.rmtree(INSTALLERS_PATH)
  ensure_dir(INSTALLERS_PATH)


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
  print(f"generated {len(manifest)} installer(s)")
  for entry in manifest:
    print(f"- {entry['slug_owner']}/{entry['slug_branch']} -> {entry['download_path']}")


if __name__ == "__main__":
  main()
