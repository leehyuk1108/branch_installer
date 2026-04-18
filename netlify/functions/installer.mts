import type { Config } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

type ParsedInput =
  | {
      owner: string;
      repo: string;
      branch: string;
      sourceLabel: string;
    }
  | {
      error: string;
    };

type InstallerRecord = {
  git_url: string;
  git_branch: string;
  aliases?: string[] | null;
  short_download_path?: string | null;
};

type AliasRecord = {
  git_url: string;
  git_branch: string;
};

const DEFAULT_BASE_INSTALLER_URL = "https://openpilot.comma.ai";
const DEFAULT_INSTALLER_USER_AGENT = "AGNOSSetup-10.1.0";
const DEFAULT_INSTALLER_DEVICE_TYPE = "tizi";

const URL_SLOT_PATTERN = /https:\/\/github\.com\/commaai\/openpilot\.git\?[ ]+/;
const BRANCH_SLOT_PATTERN = /release3\?[ ]+/;
const ALIAS_STORE_NAME = "branch-installer-aliases";
const FEATURED_ALIAS_PREFIXES = new Map<string, string>([
  ["https://github.com/ajouatom/openpilot.git", "cp"],
  ["https://github.com/FrogAi/FrogPilot.git", "fp"],
  ["https://github.com/sunnypilot/sunnypilot.git", "sp"],
  ["https://github.com/commaai/openpilot.git", "op"],
]);
const RESERVED_ALIASES = new Set([
  "",
  "api",
  "i",
  "app.js",
  "styles.css",
  "installers.json",
  "featured-branches.json",
  "favicon.ico",
]);

const getEnv = (key: string, fallback: string) => {
  try {
    return Netlify.env.get(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const getCache = () => {
  const scope = globalThis as typeof globalThis & {
    __branchInstallerBase?: Uint8Array;
  };
  return scope;
};

const validateElf = (bytes: Uint8Array, source: string) => {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46
  ) {
    throw new Error(`Expected ELF data from ${source}.`);
  }
};

const fetchBaseInstaller = async () => {
  const cache = getCache();
  if (cache.__branchInstallerBase) {
    return cache.__branchInstallerBase;
  }

  const response = await fetch(getEnv("BASE_INSTALLER_URL", DEFAULT_BASE_INSTALLER_URL), {
    headers: {
      "User-Agent": getEnv("INSTALLER_USER_AGENT", DEFAULT_INSTALLER_USER_AGENT),
      "X-openpilot-device-type": getEnv("INSTALLER_DEVICE_TYPE", DEFAULT_INSTALLER_DEVICE_TYPE),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch installer template: ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  validateElf(bytes, "installer template");
  cache.__branchInstallerBase = bytes;
  return bytes;
};

const patchSlot = (buffer: Buffer, pattern: RegExp, value: string, label: string) => {
  const latin1 = buffer.toString("latin1");
  const match = latin1.match(pattern);
  if (!match || match.index === undefined) {
    throw new Error(`Could not find ${label} slot in installer template.`);
  }

  const slotLength = match[0].length;
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length + 1 > slotLength) {
    throw new Error(`${label} is too long for installer template.`);
  }

  const replacement = Buffer.concat([
    encoded,
    Buffer.from("?"),
    Buffer.alloc(slotLength - encoded.length - 1, " "),
  ]);

  replacement.copy(buffer, match.index, 0, slotLength);
};

const buildInstaller = (baseInstaller: Uint8Array, gitUrl: string, gitBranch: string) => {
  const patched = Buffer.from(baseInstaller);
  patchSlot(patched, URL_SLOT_PATTERN, gitUrl, "git_url");
  patchSlot(patched, BRANCH_SLOT_PATTERN, gitBranch, "git_branch");
  validateElf(patched, `${gitUrl}@${gitBranch}`);
  return patched;
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const binaryResponse = (request: Request, bytes: Uint8Array) => {
  const body = Buffer.from(bytes);
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": 'attachment; filename="installer"',
    "Content-Length": String(body.byteLength),
    "Cache-Control": "public, max-age=600",
  });

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(body, { status: 200, headers });
};

const encodeBranchPath = (branch: string) =>
  branch
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

const sanitizeBranchAlias = (branch: string) =>
  branch
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim().replace(/\s+/g, "-").replace(/~/g, "-"))
    .filter(Boolean)
    .join("~");

const buildBranchAlias = (gitUrl: string, branch: string) => {
  const aliasCore = sanitizeBranchAlias(branch);
  const prefix = FEATURED_ALIAS_PREFIXES.get(gitUrl);
  const alias = prefix ? `${prefix}-${aliasCore}` : aliasCore;

  if (!alias || RESERVED_ALIASES.has(alias)) {
    return null;
  }

  return alias;
};

const getPreferredPublishedAlias = (installer: InstallerRecord) => {
  const aliases = Array.isArray(installer.aliases) ? installer.aliases.filter(Boolean) : [];
  if (aliases.length > 0) {
    return [...aliases].sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
  }

  return installer.short_download_path ?? null;
};

const getAliasStore = () => {
  const deployContext = Netlify.context?.deploy?.context;
  if (deployContext === "production") {
    return getStore({
      name: ALIAS_STORE_NAME,
      consistency: "strong",
    });
  }

  return getDeployStore({
    name: ALIAS_STORE_NAME,
    consistency: "strong",
  });
};

const rememberAlias = async (alias: string, gitUrl: string, gitBranch: string) => {
  const store = getAliasStore();
  await store.setJSON(alias, {
    git_url: gitUrl,
    git_branch: gitBranch,
  });
};

const loadAlias = async (alias: string) => {
  const store = getAliasStore();
  return (await store.get(alias, { type: "json" })) as AliasRecord | null;
};

const parseBranchInput = (rawValue: string): ParsedInput => {
  const raw = rawValue.trim();
  if (!raw) {
    return {
      error: "Paste a GitHub branch URL, installer URL, owner/branch, or owner/repo/branch first.",
    };
  }

  const ownerRepoBranchMatch = raw.match(/^([^/]+)\/([^/]+)\/(.+)$/);
  if (ownerRepoBranchMatch) {
    return {
      owner: ownerRepoBranchMatch[1],
      repo: ownerRepoBranchMatch[2],
      branch: ownerRepoBranchMatch[3],
      sourceLabel: raw,
    };
  }

  const ownerBranchMatch = raw.match(/^([^/]+)\/([^/]+)$/);
  if (ownerBranchMatch) {
    return {
      owner: ownerBranchMatch[1],
      repo: "openpilot",
      branch: ownerBranchMatch[2],
      sourceLabel: raw,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "That does not look like a valid URL or owner/branch pair." };
  }

  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (host === "github.com") {
    if (parts.length < 4 || parts[2] !== "tree") {
      return {
        error: "Paste the GitHub branch root URL. Example: https://github.com/owner/repo/tree/branch-name",
      };
    }

    return {
      owner: parts[0],
      repo: parts[1],
      branch: parts.slice(3).join("/"),
      sourceLabel: raw,
    };
  }

  if (host === "installer.comma.ai") {
    if (parts.length < 2) {
      return { error: "Expected installer URL format: https://installer.comma.ai/owner/branch" };
    }

    return {
      owner: parts[0],
      repo: "openpilot",
      branch: parts.slice(1).join("/"),
      sourceLabel: raw,
    };
  }

  return {
    error: "Only GitHub branch URLs, installer.comma.ai URLs, and owner/branch input are supported here.",
  };
};

const findPublishedInstaller = async (request: Request, gitUrl: string, gitBranch: string) => {
  try {
    const manifestUrl = new URL("/installers.json", request.url);
    const response = await fetch(manifestUrl.toString(), {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return null;
    }

    const installers = (await response.json()) as InstallerRecord[];
    return (
      installers.find((installer) => installer.git_url === gitUrl && installer.git_branch === gitBranch) ?? null
    );
  } catch {
    return null;
  }
};

const handleResolve = async (request: Request, url: URL) => {
  const parsed = parseBranchInput(url.searchParams.get("input") ?? "");
  if ("error" in parsed) {
    return jsonResponse(parsed, 400);
  }

  const gitUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
  const published = await findPublishedInstaller(request, gitUrl, parsed.branch);
  const preferredPublishedAlias = published ? getPreferredPublishedAlias(published) : null;
  if (preferredPublishedAlias) {
    const shortPath = `/${preferredPublishedAlias}`;
    return jsonResponse({
      mode: "published",
      installer_url: new URL(shortPath, request.url).toString(),
      installer_path: shortPath,
      git_url: gitUrl,
      git_branch: parsed.branch,
    });
  }

  const alias = buildBranchAlias(gitUrl, parsed.branch);
  if (alias) {
    await rememberAlias(alias, gitUrl, parsed.branch);
    const shortPath = `/${encodeURIComponent(alias)}`;
    return jsonResponse({
      mode: "dynamic",
      installer_url: new URL(shortPath, request.url).toString(),
      installer_path: shortPath,
      git_url: gitUrl,
      git_branch: parsed.branch,
    });
  }

  const dynamicPath = `/i/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/${encodeBranchPath(parsed.branch)}`;
  return jsonResponse({
    mode: "dynamic",
    installer_url: new URL(dynamicPath, request.url).toString(),
    installer_path: dynamicPath,
    git_url: gitUrl,
    git_branch: parsed.branch,
  });
};

const handleInstaller = async (request: Request, url: URL) => {
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (segments.length < 4 || segments[0] !== "i") {
    return new Response("Expected /i/<owner>/<repo>/<branch>.", {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const owner = segments[1];
  const repo = segments[2];
  const branch = segments.slice(3).join("/");
  const gitUrl = `https://github.com/${owner}/${repo}.git`;

  const baseInstaller = await fetchBaseInstaller();
  const installer = buildInstaller(baseInstaller, gitUrl, branch);
  return binaryResponse(request, installer);
};

const handleShortAlias = async (request: Request, url: URL) => {
  const alias = decodeURIComponent(url.pathname.slice(1));
  if (!alias || alias.includes("/")) {
    return new Response("Not found.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const aliasRecord = await loadAlias(alias);
  if (!aliasRecord) {
    return new Response("Not found.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const baseInstaller = await fetchBaseInstaller();
  const installer = buildInstaller(baseInstaller, aliasRecord.git_url, aliasRecord.git_branch);
  return binaryResponse(request, installer);
};

export default async (request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/status") {
      return jsonResponse({ dynamic: true, provider: "netlify" });
    }

    if (url.pathname === "/api/resolve") {
      return handleResolve(request, url);
    }

    if (url.pathname.startsWith("/i/")) {
      return handleInstaller(request, url);
    }

    if (url.pathname !== "/") {
      return handleShortAlias(request, url);
    }

    return new Response("Not found.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
};

export const config: Config = {
  path: ["/api/status", "/api/resolve", "/i/*", "/*"],
  preferStatic: true,
};
