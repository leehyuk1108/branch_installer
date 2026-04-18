function toAbsoluteDownloadUrl(path) {
  return new URL(path, window.location.href).toString();
}

const FEATURED_REPO_URL = "https://github.com/ajouatom/openpilot.git";

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function copyText(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    button.textContent = "복사됨";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  });
}

function renderActions(urls) {
  const actions = document.createElement("div");
  actions.className = "card-actions";

  urls.forEach((entry, index) => {
    if (!entry?.url) return;

    if (entry.type === "copy") {
      const button = document.createElement("button");
      button.className = `action-button ${index === 0 ? "action-primary" : "action-secondary"}`;
      button.textContent = entry.label;
      button.addEventListener("click", () => copyText(entry.url, button));
      actions.appendChild(button);
      return;
    }

    const link = document.createElement("a");
    link.className = `action-button ${index === 0 ? "action-primary" : "action-secondary"}`;
    link.textContent = entry.label;
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    actions.appendChild(link);
  });

  return actions;
}

function parseBranchInput(rawValue) {
  const raw = rawValue.trim();
  if (!raw) {
    return { error: "링크를 입력해주세요." };
  }

  const ownerRepoBranchMatch = raw.match(/^([^/]+)\/([^/]+)\/(.+)$/);
  if (ownerRepoBranchMatch) {
    return {
      owner: ownerRepoBranchMatch[1],
      repo: ownerRepoBranchMatch[2],
      branch: ownerRepoBranchMatch[3],
      sourceLabel: `${ownerRepoBranchMatch[1]}/${ownerRepoBranchMatch[2]}/${ownerRepoBranchMatch[3]}`,
    };
  }

  const ownerBranchMatch = raw.match(/^([^/]+)\/([^/]+)$/);
  if (ownerBranchMatch) {
    return {
      owner: ownerBranchMatch[1],
      repo: "openpilot",
      branch: ownerBranchMatch[2],
      sourceLabel: `${ownerBranchMatch[1]}/${ownerBranchMatch[2]}`,
    };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "형식을 확인해주세요." };
  }

  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

  if (host === "github.com") {
    if (parts.length < 4 || parts[2] !== "tree") {
      return { error: "브랜치 링크를 넣어주세요." };
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
      return { error: "installer 링크 형식을 확인해주세요." };
    }

    return {
      owner: parts[0],
      repo: "openpilot",
      branch: parts.slice(1).join("/"),
      sourceLabel: raw,
    };
  }

  return { error: "지원하지 않는 형식입니다." };
}

function findPublishedInstaller(parsed, installers) {
  const gitUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
  return installers.find((installer) => installer.git_url === gitUrl && installer.git_branch === parsed.branch) || null;
}

function buildOfficialInstallerUrl(parsed) {
  if (parsed.repo !== "openpilot") {
    return null;
  }

  if (parsed.branch.includes("/")) {
    return null;
  }

  return `https://installer.comma.ai/${parsed.owner}/${parsed.branch}`;
}

async function checkDynamicApi() {
  try {
    const response = await fetch("./api/status", { cache: "no-store" });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.dynamic === true;
  } catch {
    return false;
  }
}

async function resolveDynamicInstaller(rawValue) {
  const params = new URLSearchParams({ input: rawValue });
  const response = await fetch(`./api/resolve?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Dynamic resolve failed: ${response.status}`);
  }
  return response.json();
}

function makeResultCard({ tone, title, body, rows, actions, note }) {
  const wrapper = document.createElement("article");
  wrapper.className = `result-card ${tone}`;

  const head = document.createElement("div");
  head.className = "meta-grid";
  head.innerHTML = `<p class="result-title">${escapeHtml(title)}</p>`;
  if (body) {
    const copy = document.createElement("p");
    copy.className = "result-copy";
    copy.textContent = body;
    head.appendChild(copy);
  }
  wrapper.appendChild(head);

  if (Array.isArray(rows) && rows.length > 0) {
    const rowsContainer = document.createElement("div");
    rowsContainer.className = "meta-grid";
    rows.forEach((row) => {
      const rowElement = document.createElement("div");
      rowElement.className = "meta-row";
      rowElement.innerHTML = `
        <span class="meta-label">${escapeHtml(row.label)}</span>
        <div class="${row.highlight ? "url-box mono" : "mono"}">${escapeHtml(row.value)}</div>
      `;
      rowsContainer.appendChild(rowElement);
    });
    wrapper.appendChild(rowsContainer);
  }

  if (Array.isArray(actions) && actions.length > 0) {
    wrapper.appendChild(renderActions(actions));
  }

  if (note) {
    const noteElement = document.createElement("p");
    noteElement.className = "result-note";
    noteElement.textContent = note;
    wrapper.appendChild(noteElement);
  }

  return wrapper;
}

function renderFeaturedBranches(installerCatalog) {
  const container = document.getElementById("featured-branches");
  if (!container) {
    return;
  }

  const branches = installerCatalog
    .filter((installer) => installer.git_url === FEATURED_REPO_URL)
    .sort((left, right) => left.git_branch.localeCompare(right.git_branch, "en", { numeric: true }));

  if (branches.length === 0) {
    container.innerHTML = '<p class="empty-state">표시할 브랜치가 없습니다.</p>';
    return;
  }

  container.innerHTML = "";

  branches.forEach((installer) => {
    const shortPath = installer.short_download_path
      ? `/${installer.short_download_path}`
      : `/${installer.download_path}`;
    const downloadUrl = toAbsoluteDownloadUrl(shortPath);

    const row = document.createElement("article");
    row.className = "branch-row";
    row.innerHTML = `
      <div class="branch-main">
        <p class="branch-name">${escapeHtml(installer.git_branch)}</p>
        <a class="branch-link mono" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noreferrer">${escapeHtml(shortPath)}</a>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "branch-actions";

    const copyButton = document.createElement("button");
    copyButton.className = "action-button action-secondary";
    copyButton.textContent = "복사";
    copyButton.addEventListener("click", () => copyText(downloadUrl, copyButton));
    actions.appendChild(copyButton);

    row.appendChild(actions);
    container.appendChild(row);
  });
}

function renderConverter(installerCatalog, options = {}) {
  const form = document.getElementById("converter-form");
  const input = document.getElementById("branch-input");
  const result = document.getElementById("converter-result");
  const dynamicApiAvailable = options.dynamicApiAvailable === true;

  function setResult(node) {
    result.innerHTML = "";
    result.appendChild(node);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const parsed = parseBranchInput(input.value);
    if (parsed.error) {
      setResult(makeResultCard({
        tone: "warning",
        title: "입력을 확인해주세요",
        body: parsed.error,
        rows: [],
        actions: [],
      }));
      return;
    }

    const published = findPublishedInstaller(parsed, installerCatalog);

    if (published) {
      const shortUrl = published.short_download_path
        ? toAbsoluteDownloadUrl(published.short_download_path)
        : toAbsoluteDownloadUrl(published.download_path);

      setResult(makeResultCard({
        tone: "success",
        title: "변환 완료",
        rows: [
          { label: "링크", value: shortUrl, highlight: true },
          { label: "대상", value: `${published.git_url} @ ${published.git_branch}` },
        ],
        actions: [
          { type: "copy", label: "복사", url: shortUrl },
          { type: "open", label: "열기", url: shortUrl },
        ],
      }));
      return;
    }

    if (dynamicApiAvailable) {
      try {
        const resolved = await resolveDynamicInstaller(input.value);
        const dynamicUrl = resolved.installer_url;

        setResult(makeResultCard({
          tone: "success",
          title: "변환 완료",
          rows: [
            { label: "링크", value: dynamicUrl, highlight: true },
            { label: "대상", value: `${resolved.git_url} @ ${resolved.git_branch}` },
          ],
          actions: [
            { type: "copy", label: "복사", url: dynamicUrl },
            { type: "open", label: "열기", url: dynamicUrl },
          ],
        }));
        return;
      } catch (error) {
        console.error(error);
      }
    }

    const officialUrl = buildOfficialInstallerUrl(parsed);
    if (officialUrl) {
      setResult(makeResultCard({
        tone: "warning",
        title: "공식 링크",
        rows: [
          { label: "링크", value: officialUrl, highlight: true },
          { label: "대상", value: `https://github.com/${parsed.owner}/${parsed.repo}.git @ ${parsed.branch}` },
        ],
        actions: [
          { type: "copy", label: "복사", url: officialUrl },
          { type: "open", label: "열기", url: officialUrl },
        ],
      }));
      return;
    }

    setResult(makeResultCard({
      tone: "info",
      title: "등록된 링크가 없습니다",
      rows: [
        { label: "대상", value: `https://github.com/${parsed.owner}/${parsed.repo}.git @ ${parsed.branch}` },
      ],
      actions: [],
    }));
  });
}

async function bootstrap() {
  const dynamicApiAvailable = await checkDynamicApi();

  try {
    const response = await fetch("./installers.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load installers.json: ${response.status}`);
    }

    const installers = await response.json();
    const installerCatalog = Array.isArray(installers) ? installers : [];
    renderConverter(installerCatalog, { dynamicApiAvailable });
    renderFeaturedBranches(installerCatalog);
  } catch (error) {
    console.error(error);
    renderConverter([], { dynamicApiAvailable });
    renderFeaturedBranches([]);
  }
}

bootstrap();
