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
    button.textContent = "Copied";
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
        <span class="meta-label">Git target</span>
        <div class="mono">${escapeHtml(installer.git_url)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Branch</span>
        <div class="mono">${escapeHtml(installer.git_branch)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Short installer URL</span>
        <div class="url-box mono">${escapeHtml(preferredUrl)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Aliases</span>
        <div class="mono">${escapeHtml(aliasText)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Full installer URL</span>
        <div class="mono">${escapeHtml(directUrl)}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Binary</span>
        <div class="mono">${formatBytes(installer.size_bytes)} · sha256 ${escapeHtml(installer.sha256)}</div>
      </div>
    </div>
  `;

  article.appendChild(renderActions([
    { type: "copy", label: "Copy URL", url: preferredUrl },
    { type: "open", label: "Open Binary", url: preferredUrl },
  ]));

  return article;
}

function parseBranchInput(rawValue) {
  const raw = rawValue.trim();
  if (!raw) {
    return { error: "Paste a GitHub branch URL, installer URL, owner/branch, or owner/repo/branch first." };
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
    return { error: "That does not look like a valid URL or owner/branch pair." };
  }

  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

  if (host === "github.com") {
    if (parts.length < 4 || parts[2] !== "tree") {
      return { error: "Paste the GitHub branch root URL. Example: https://github.com/owner/repo/tree/branch-name" };
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

  return { error: "Only GitHub branch URLs, installer.comma.ai URLs, and owner/branch input are supported here." };
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
        title: "Could not parse that input",
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
        title: "Short installer link is ready",
        body: "This branch already has a published static installer on this site.",
        rows: [
          { label: "Input", value: parsed.sourceLabel },
          { label: "Short installer URL", value: shortUrl, highlight: true },
          { label: "Full installer URL", value: fullUrl },
          { label: "Git target", value: `${published.git_url} @ ${published.git_branch}` },
        ],
        actions: [
          { type: "copy", label: "Copy short URL", url: shortUrl },
          { type: "open", label: "Open binary", url: shortUrl },
        ],
        note: "Use the short installer URL directly on the comma device.",
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
          title: isPublished ? "Short installer link is ready" : "Dynamic installer URL generated",
          body: isPublished
            ? "This branch already has a published short alias on the server."
            : "This server can generate an installer on demand for the requested GitHub repo and branch.",
          rows: [
            { label: "Input", value: parsed.sourceLabel },
            { label: isPublished ? "Short installer URL" : "Dynamic installer URL", value: dynamicUrl, highlight: true },
            { label: "Git target", value: `${resolved.git_url} @ ${resolved.git_branch}` },
          ],
          actions: [
            { type: "copy", label: isPublished ? "Copy short URL" : "Copy dynamic URL", url: dynamicUrl },
            { type: "open", label: "Open binary", url: dynamicUrl },
          ],
          note: isPublished
            ? "Use the short installer URL directly on the comma device."
            : "This link works on the comma device as long as this server stays reachable from the internet.",
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
        title: "Official installer URL generated",
        body: "This branch does not have a short static alias on this site yet, but the standard comma installer URL can be generated for openpilot-compatible targets.",
        rows: [
          { label: "Input", value: parsed.sourceLabel },
          { label: "Official installer URL", value: officialUrl, highlight: true },
          { label: "Requested Git target", value: `https://github.com/${parsed.owner}/${parsed.repo}.git @ ${parsed.branch}` },
        ],
        actions: [
          { type: "copy", label: "Copy official URL", url: officialUrl },
          { type: "open", label: "Open official URL", url: officialUrl },
        ],
        note: "If you want a shorter link on this site, add this branch to the static catalog and publish a new alias.",
      }));
      return;
    }

    setResult(makeResultCard({
      tone: "info",
      title: "No short link can be generated live here",
      body: "This Pages site is static, so it cannot mint a new working short installer URL for an arbitrary branch on demand.",
      rows: [
        { label: "Input", value: parsed.sourceLabel },
        { label: "Requested Git target", value: `https://github.com/${parsed.owner}/${parsed.repo}.git @ ${parsed.branch}` },
      ],
      actions: [],
      note: "For non-openpilot repos, slash-based branch paths, or any custom git target, publish a pre-generated installer in this catalog first.",
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
      container.innerHTML = `<p class="empty-state">No installers have been generated yet.</p>`;
      renderConverter([], { dynamicApiAvailable });
      return;
    }

    installers.forEach((installer) => {
      container.appendChild(renderInstallerCard(installer));
    });
    renderConverter(installers, { dynamicApiAvailable });
  } catch (error) {
    console.error(error);
    container.innerHTML = `<p class="error-state">Failed to load installer catalog.</p>`;
  }
}

bootstrap();
