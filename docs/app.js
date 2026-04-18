function toAbsoluteDownloadUrl(path) {
  return new URL(path, window.location.href).toString();
}

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

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
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

function renderInstallerCard(installer) {
  const article = document.createElement("article");
  article.className = "installer-card";

  const directUrl = toAbsoluteDownloadUrl(installer.download_path);
  const shortUrl = installer.short_download_path
    ? toAbsoluteDownloadUrl(installer.short_download_path)
    : null;
  const preferredUrl = shortUrl || directUrl;
  const aliasText = Array.isArray(installer.aliases) && installer.aliases.length > 0
    ? installer.aliases.join(", ")
    : "none";

  article.innerHTML = `
    <div class="meta-grid">
      <p class="panel-kicker">${escapeHtml(installer.slug_owner)}/${escapeHtml(installer.slug_branch)}</p>
      <h3>${escapeHtml(installer.title)}</h3>
      <p>${escapeHtml(installer.description)}</p>
    </div>
    <div class="meta-grid">
      <div class="meta-row">
        <span class="meta-label">Git 대상</span>
        <div class="mono">${escapeHtml(installer.git_url)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">브랜치</span>
        <div class="mono">${escapeHtml(installer.git_branch)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">짧은 인스톨러 URL</span>
        <div class="url-box mono">${escapeHtml(preferredUrl)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">별칭</span>
        <div class="mono">${escapeHtml(aliasText)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">전체 인스톨러 URL</span>
        <div class="mono">${escapeHtml(directUrl)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">바이너리</span>
        <div class="mono">${formatBytes(installer.size_bytes)} · sha256 ${escapeHtml(installer.sha256)}</div>
      </div>
    </div>
  `;

  article.appendChild(renderActions([
    { type: "copy", label: "URL 복사", url: preferredUrl },
    { type: "open", label: "바이너리 열기", url: preferredUrl },
  ]));

  return article;
}

function parseBranchInput(rawValue) {
  const raw = rawValue.trim();
  if (!raw) {
    return { error: "GitHub 브랜치 URL, installer URL, owner/branch, 또는 owner/repo/branch를 먼저 입력해주세요." };
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
    return { error: "올바른 URL 또는 owner/branch 형식으로 보이지 않습니다." };
  }

  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

  if (host === "github.com") {
    if (parts.length < 4 || parts[2] !== "tree") {
      return { error: "GitHub 브랜치 루트 URL을 넣어주세요. 예: https://github.com/owner/repo/tree/branch-name" };
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
      return { error: "installer URL 형식은 https://installer.comma.ai/owner/branch 이어야 합니다." };
    }

    return {
      owner: parts[0],
      repo: "openpilot",
      branch: parts.slice(1).join("/"),
      sourceLabel: raw,
    };
  }

  return { error: "여기서는 GitHub 브랜치 URL, installer.comma.ai URL, owner/branch 입력만 지원합니다." };
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

  wrapper.innerHTML = `
    <div class="meta-grid">
      <p class="result-title">${escapeHtml(title)}</p>
      <p class="result-copy">${escapeHtml(body)}</p>
    </div>
  `;

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
        title: "입력을 해석할 수 없습니다",
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
      const fullUrl = toAbsoluteDownloadUrl(published.download_path);

      setResult(makeResultCard({
        tone: "success",
        title: "짧은 인스톨러 링크가 준비되었습니다",
        body: "이 브랜치는 이미 이 사이트에 정적 인스톨러로 등록되어 있습니다.",
        rows: [
          { label: "입력값", value: parsed.sourceLabel },
          { label: "짧은 인스톨러 URL", value: shortUrl, highlight: true },
          { label: "전체 인스톨러 URL", value: fullUrl },
          { label: "Git 대상", value: `${published.git_url} @ ${published.git_branch}` },
        ],
        actions: [
          { type: "copy", label: "짧은 URL 복사", url: shortUrl },
          { type: "open", label: "바이너리 열기", url: shortUrl },
        ],
        note: "comma 기기에는 이 짧은 인스톨러 URL을 그대로 넣으면 됩니다.",
      }));
      return;
    }

    if (dynamicApiAvailable) {
      try {
        const resolved = await resolveDynamicInstaller(input.value);
        const dynamicUrl = resolved.installer_url;
        const isPublished = resolved.mode === "published";

        setResult(makeResultCard({
          tone: "success",
          title: isPublished ? "짧은 인스톨러 링크가 준비되었습니다" : "동적 인스톨러 URL이 생성되었습니다",
          body: isPublished
            ? "이 브랜치는 이미 서버에 짧은 별칭으로 등록되어 있습니다."
            : "이 서버는 요청한 GitHub repo와 브랜치에 대해 즉시 인스톨러를 생성할 수 있습니다.",
          rows: [
            { label: "입력값", value: parsed.sourceLabel },
            { label: isPublished ? "짧은 인스톨러 URL" : "동적 인스톨러 URL", value: dynamicUrl, highlight: true },
            { label: "Git 대상", value: `${resolved.git_url} @ ${resolved.git_branch}` },
          ],
          actions: [
            { type: "copy", label: isPublished ? "짧은 URL 복사" : "동적 URL 복사", url: dynamicUrl },
            { type: "open", label: "바이너리 열기", url: dynamicUrl },
          ],
          note: isPublished
            ? "comma 기기에는 이 짧은 인스톨러 URL을 그대로 넣으면 됩니다."
            : "이 링크는 서버가 외부에서 계속 접근 가능한 동안 comma 기기에서 사용할 수 있습니다.",
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
        title: "공식 installer URL을 생성했습니다",
        body: "이 브랜치는 아직 이 사이트에 짧은 정적 별칭으로 등록되어 있지 않지만, openpilot 호환 대상이라면 표준 comma installer URL을 만들 수 있습니다.",
        rows: [
          { label: "입력값", value: parsed.sourceLabel },
          { label: "공식 installer URL", value: officialUrl, highlight: true },
          { label: "요청한 Git 대상", value: `https://github.com/${parsed.owner}/${parsed.repo}.git @ ${parsed.branch}` },
        ],
        actions: [
          { type: "copy", label: "공식 URL 복사", url: officialUrl },
          { type: "open", label: "공식 URL 열기", url: officialUrl },
        ],
        note: "이 사이트에서 더 짧은 링크를 쓰려면, 이 브랜치를 정적 카탈로그에 추가하고 새 별칭을 발행해야 합니다.",
      }));
      return;
    }

    setResult(makeResultCard({
      tone: "info",
      title: "여기서는 즉석에서 짧은 링크를 만들 수 없습니다",
      body: "이 Pages 사이트는 정적 호스팅이라서, 임의 브랜치에 대한 새 짧은 인스톨러 URL을 즉석에서 발급할 수 없습니다.",
      rows: [
        { label: "입력값", value: parsed.sourceLabel },
        { label: "요청한 Git 대상", value: `https://github.com/${parsed.owner}/${parsed.repo}.git @ ${parsed.branch}` },
      ],
      actions: [],
      note: "non-openpilot repo, 슬래시가 들어간 브랜치 경로, 또는 커스텀 Git 대상은 먼저 이 카탈로그에 미리 생성된 인스톨러로 등록해야 합니다.",
    }));
  });
}

async function bootstrap() {
  const container = document.getElementById("installer-list");
  const dynamicApiAvailable = await checkDynamicApi();

  try {
    const response = await fetch("./installers.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load installers.json: ${response.status}`);
    }

    const installers = await response.json();
    container.innerHTML = "";

    if (!Array.isArray(installers) || installers.length === 0) {
      container.innerHTML = `<p class="empty-state">아직 생성된 인스톨러가 없습니다.</p>`;
      renderConverter([], { dynamicApiAvailable });
      return;
    }

    installers.forEach((installer) => {
      container.appendChild(renderInstallerCard(installer));
    });
    renderConverter(installers, { dynamicApiAvailable });
  } catch (error) {
    console.error(error);
    container.innerHTML = `<p class="error-state">인스톨러 목록을 불러오지 못했습니다.</p>`;
  }
}

bootstrap();
