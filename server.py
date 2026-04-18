#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

from installer_lib import (
  DOCS_PATH,
  build_installer_for_target,
  fetch_base_installer,
  find_target_by_alias,
  find_target_by_git_ref,
  load_or_build_cached_installer,
  load_targets,
  manifest_entry_from_target,
  parse_branch_input,
)

FEATURED_ALIAS_PREFIXES = {
  "https://github.com/ajouatom/openpilot.git": "cp",
  "https://github.com/FrogAi/FrogPilot.git": "fp",
  "https://github.com/sunnypilot/sunnypilot.git": "sp",
  "https://github.com/commaai/openpilot.git": "op",
}

RESERVED_ALIASES = {
  "",
  "api",
  "i",
  "app.js",
  "styles.css",
  "installers.json",
  "featured-branches.json",
  "favicon.ico",
}


def encode_path_segment(value: str, keep_slashes: bool = False) -> str:
  safe = "/-._~" if keep_slashes else "-._~"
  return quote(value, safe=safe)


def sanitize_branch_alias(branch: str) -> str:
  normalized = branch.strip().replace("\\", "/")
  parts = [part.strip().replace(" ", "-").replace("~", "-") for part in normalized.split("/") if part.strip()]
  return "~".join(parts)


def build_dynamic_alias(git_url: str, git_branch: str) -> str | None:
  alias_core = sanitize_branch_alias(git_branch)
  if not alias_core:
    return None

  prefix = FEATURED_ALIAS_PREFIXES.get(git_url)
  alias = f"{prefix}-{alias_core}" if prefix else alias_core
  if alias in RESERVED_ALIASES:
    return None

  return alias


def get_preferred_alias(target: dict) -> str | None:
  aliases = [alias for alias in target.get("aliases", []) if alias]
  if not aliases:
    return None
  return sorted(aliases, key=lambda value: (len(value), value.lower()))[0]


class BranchInstallerHTTPServer(ThreadingHTTPServer):
  def __init__(self, server_address: tuple[str, int], handler_class: type[SimpleHTTPRequestHandler]):
    super().__init__(server_address, handler_class)
    self.base_installer = fetch_base_installer()
    self.alias_map: dict[str, dict[str, str]] = {}


class BranchInstallerHandler(SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(DOCS_PATH), **kwargs)

  @property
  def typed_server(self) -> BranchInstallerHTTPServer:
    return self.server  # type: ignore[return-value]

  def do_GET(self) -> None:
    self.handle_request(head_only=False)

  def do_HEAD(self) -> None:
    self.handle_request(head_only=True)

  def handle_request(self, head_only: bool) -> None:
    parsed = urlparse(self.path)
    path = unquote(parsed.path)

    if path == "/api/status":
      self.send_json(200, {"dynamic": True}, head_only=head_only)
      return

    if path == "/api/resolve":
      self.handle_api_resolve(parsed, head_only=head_only)
      return

    if path == "/installers.json":
      self.handle_manifest(head_only=head_only)
      return

    if path.startswith("/installers/"):
      if self.handle_catalog_installer(path, head_only=head_only):
        return

    if path.startswith("/i/"):
      self.handle_dynamic_installer(path, head_only=head_only)
      return

    alias = path.lstrip("/")
    if alias and "/" not in alias:
      target = find_target_by_alias(load_targets(), alias)
      if target is not None:
        self.serve_installer_for_target(target, head_only=head_only)
        return

      alias_record = self.typed_server.alias_map.get(alias)
      if alias_record is not None:
        installer_bytes, _ = load_or_build_cached_installer(
          self.typed_server.base_installer,
          alias_record["git_url"],
          alias_record["git_branch"],
        )
        self.serve_installer_bytes(installer_bytes, head_only=head_only)
        return

    self.path = path
    if head_only:
      super().do_HEAD()
    else:
      super().do_GET()

  def handle_manifest(self, head_only: bool = False) -> None:
    targets = load_targets()
    manifest = []
    for target in targets:
      installer_bytes, _ = load_or_build_cached_installer(
        self.typed_server.base_installer,
        target["git_url"],
        target["git_branch"],
      )
      manifest.append(manifest_entry_from_target(target, installer_bytes))
    self.send_json(200, manifest, head_only=head_only)

  def handle_api_resolve(self, parsed, head_only: bool = False) -> None:
    query = parse_qs(parsed.query)
    raw_input = query.get("input", [""])[0]
    parsed_input = parse_branch_input(raw_input)
    if "error" in parsed_input:
      self.send_json(400, parsed_input, head_only=head_only)
      return

    git_url = f"https://github.com/{parsed_input['owner']}/{parsed_input['repo']}.git"
    git_branch = parsed_input["branch"]
    targets = load_targets()
    published = find_target_by_git_ref(targets, git_url, git_branch)

    preferred_alias = get_preferred_alias(published) if published is not None else None
    if preferred_alias is not None:
      path = "/" + encode_path_segment(preferred_alias)
      self.send_json(200, {
        "mode": "published",
        "installer_url": self.absolute_url(path),
        "installer_path": path,
        "git_url": git_url,
        "git_branch": git_branch,
      }, head_only=head_only)
      return

    alias = build_dynamic_alias(git_url, git_branch)
    if alias is not None:
      self.typed_server.alias_map[alias] = {
        "git_url": git_url,
        "git_branch": git_branch,
      }
      path = "/" + encode_path_segment(alias)
    else:
      path = "/i/{owner}/{repo}/{branch}".format(
        owner=encode_path_segment(parsed_input["owner"]),
        repo=encode_path_segment(parsed_input["repo"]),
        branch=encode_path_segment(parsed_input["branch"], keep_slashes=True),
      )

    self.send_json(200, {
      "mode": "dynamic",
      "installer_url": self.absolute_url(path),
      "installer_path": path,
      "git_url": git_url,
      "git_branch": git_branch,
    }, head_only=head_only)

  def handle_catalog_installer(self, path: str, head_only: bool = False) -> bool:
    parts = path.split("/")
    if len(parts) < 5 or parts[-1] != "installer":
      return False

    slug_owner = parts[2]
    slug_branch = "/".join(parts[3:-1])
    for target in load_targets():
      if target["slug_owner"] == slug_owner and target["slug_branch"] == slug_branch:
        self.serve_installer_for_target(target, head_only=head_only)
        return True
    return False

  def handle_dynamic_installer(self, path: str, head_only: bool = False) -> None:
    parts = path.split("/")
    if len(parts) < 5:
      self.send_text(400, "Expected /i/<owner>/<repo>/<branch>.", head_only=head_only)
      return

    owner = parts[2]
    repo = parts[3]
    branch = "/".join(parts[4:])
    git_url = f"https://github.com/{owner}/{repo}.git"

    installer_bytes, _ = load_or_build_cached_installer(self.typed_server.base_installer, git_url, branch)
    self.serve_installer_bytes(installer_bytes, head_only=head_only)

  def serve_installer_for_target(self, target: dict, head_only: bool = False) -> None:
    installer_bytes, _ = load_or_build_cached_installer(
      self.typed_server.base_installer,
      target["git_url"],
      target["git_branch"],
    )
    self.serve_installer_bytes(installer_bytes, head_only=head_only)

  def serve_installer_bytes(self, installer_bytes: bytes, head_only: bool = False) -> None:
    self.send_response(200)
    self.send_header("Content-Type", "application/octet-stream")
    self.send_header("Content-Disposition", 'attachment; filename="installer"')
    self.send_header("Content-Length", str(len(installer_bytes)))
    self.send_header("Cache-Control", "public, max-age=600")
    self.end_headers()
    if not head_only:
      self.safe_write(installer_bytes)

  def send_text(self, status: int, text: str, head_only: bool = False) -> None:
    data = text.encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "text/plain; charset=utf-8")
    self.send_header("Content-Length", str(len(data)))
    self.end_headers()
    if not head_only:
      self.safe_write(data)

  def send_json(self, status: int, payload, head_only: bool = False) -> None:
    data = json.dumps(payload, indent=2).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(data)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    if not head_only:
      self.safe_write(data)

  def safe_write(self, data: bytes) -> None:
    try:
      self.wfile.write(data)
    except (BrokenPipeError, ConnectionResetError):
      pass

  def absolute_url(self, path: str) -> str:
    scheme = self.headers.get("X-Forwarded-Proto")
    if not scheme:
      scheme = "https" if self.server.server_port == 443 else "http"

    host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host")
    if not host:
      host = f"{self.server.server_name}:{self.server.server_port}"
    return f"{scheme}://{host}{path}"


def main() -> None:
  parser = argparse.ArgumentParser(description="Run a dynamic comma installer server.")
  parser.add_argument("--host", default="127.0.0.1", help="Bind host. Use 0.0.0.0 for LAN or internet exposure.")
  parser.add_argument("--port", type=int, default=8080, help="Bind port.")
  args = parser.parse_args()

  server = BranchInstallerHTTPServer((args.host, args.port), BranchInstallerHandler)
  print(f"branch_installer serving on http://{args.host}:{args.port}")
  print("Routes: /<alias>, /i/<owner>/<repo>/<branch>, /api/resolve?input=...")
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    print("\nstopping server")
  finally:
    server.server_close()


if __name__ == "__main__":
  main()
