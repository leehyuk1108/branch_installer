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
    return { error: "브랜치 Github URL을 입력해주세요." };
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
      return { error: "브랜치 Github URL을 넣어주세요." };
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

function getPreferredShortPath(installer) {
  const aliases = Array.isArray(installer.aliases) ? installer.aliases.filter(Boolean) : [];
  if (aliases.length > 0) {
    const [bestAlias] = [...aliases].sort((left, right) => left.length - right.length || left.localeCompare(right, "en"));
    return `/${bestAlias}`;
  }

  return `/${installer.download_path}`;
}

function findInstallerByGitRef(installerCatalog, gitUrl, gitBranch) {
  return installerCatalog.find((installer) => installer.git_url === gitUrl && installer.git_branch === gitBranch) || null;
}

function buildGithubBranchUrl(group, branch) {
  const encodedBranch = branch
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://github.com/${group.owner}/${group.repo}/tree/${encodedBranch}`;
}

function createGroupShell(group) {
  const wrapper = document.createElement("article");
  wrapper.className = "featured-group";
  wrapper.innerHTML = `
    <div class="featured-group-head">
      <p class="featured-group-kicker">${escapeHtml(group.kicker || "자주 쓰는 브랜치")}</p>
      <h3>${escapeHtml(group.name)}</h3>
    </div>
  `;
  return wrapper;
}

function createPickerGroup(group, installerCatalog, dynamicApiAvailable) {
  const wrapper = createGroupShell(group);
  const picker = document.createElement("div");
  picker.className = "branch-picker";

  const label = document.createElement("label");
  label.className = "sr-only";
  label.htmlFor = `featured-select-${group.id}`;
  label.textContent = `${group.name} 브랜치 선택`;
  picker.appendChild(label);

  const select = document.createElement("select");
  select.id = `featured-select-${group.id}`;
  select.className = "branch-select";
  picker.appendChild(select);

  const result = document.createElement("div");
  result.className = "converter-result";

  const setResult = (node) => {
    result.innerHTML = "";
    result.appendChild(node);
  };

  const branches = Array.isArray(group.branches) ? group.branches : [];

  if (branches.length === 0) {
    select.innerHTML = '<option value="">표시할 브랜치가 없습니다.</option>';
    setResult(makeResultCard({
      tone: "info",
      title: "안내",
      body: "표시할 브랜치가 없습니다.",
      rows: [],
      actions: [],
    }));
    wrapper.appendChild(picker);
    wrapper.appendChild(result);
    return wrapper;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "브랜치를 선택해주세요";
  select.appendChild(placeholder);

  const branchMap = new Map();
  branches.forEach((branch) => {
    const option = document.createElement("option");
    option.value = branch;
    option.textContent = branch;
    select.appendChild(option);
    branchMap.set(branch, branch);
  });

  setResult(makeResultCard({
    tone: "info",
    title: "안내",
    body: "브랜치를 선택하면 설치 링크가 출력됩니다.",
    rows: [],
    actions: [],
  }));

  select.addEventListener("change", async () => {
    const branch = branchMap.get(select.value);
    if (!branch) {
      setResult(makeResultCard({
        tone: "info",
        title: "안내",
        body: "브랜치를 선택하면 설치 링크가 출력됩니다.",
        rows: [],
        actions: [],
      }));
      return;
    }

    const published = findInstallerByGitRef(installerCatalog, group.git_url, branch);
    if (published) {
      const shortPath = getPreferredShortPath(published);
      const downloadUrl = toAbsoluteDownloadUrl(shortPath);
      setResult(makeResultCard({
        tone: "success",
        title: `${group.name} ${branch}`,
        rows: [
          { label: "링크", value: downloadUrl, highlight: true },
          { label: "브랜치", value: branch },
        ],
        actions: [
          { type: "copy", label: "복사", url: downloadUrl },
          { type: "open", label: "열기", url: downloadUrl },
        ],
      }));
      return;
    }

    if (!dynamicApiAvailable) {
      setResult(makeResultCard({
        tone: "warning",
        title: "로컬 정적 미리보기",
        body: "동적 링크 생성은 API가 켜진 서버에서 확인할 수 있습니다.",
        rows: [
          { label: "브랜치", value: branch },
        ],
        actions: [],
      }));
      return;
    }

    setResult(makeResultCard({
      tone: "info",
      title: "링크 생성 중",
      body: "짧은 링크를 만들고 있습니다.",
      rows: [
        { label: "브랜치", value: branch },
      ],
      actions: [],
    }));

    try {
      const resolved = await resolveDynamicInstaller(buildGithubBranchUrl(group, branch));
      setResult(makeResultCard({
        tone: "success",
        title: `${group.name} ${branch}`,
        rows: [
          { label: "링크", value: resolved.installer_url, highlight: true },
          { label: "브랜치", value: branch },
        ],
        actions: [
          { type: "copy", label: "복사", url: resolved.installer_url },
          { type: "open", label: "열기", url: resolved.installer_url },
        ],
      }));
    } catch (error) {
      console.error(error);
      setResult(makeResultCard({
        tone: "warning",
        title: "링크 생성 실패",
        body: "이 브랜치의 링크를 만들지 못했습니다.",
        rows: [
          { label: "브랜치", value: branch },
        ],
        actions: [],
      }));
    }
  });

  wrapper.appendChild(picker);
  wrapper.appendChild(result);
  return wrapper;
}

function renderFeaturedGroups(featuredGroups, installerCatalog, options = {}) {
  const container = document.getElementById("featured-groups");
  if (!container) {
    return;
  }

  container.innerHTML = "";

  const groups = Array.isArray(featuredGroups) ? featuredGroups : [];
  const dynamicApiAvailable = options.dynamicApiAvailable === true;

  if (groups.length === 0) {
    container.innerHTML = '<p class="empty-state">표시할 브랜치가 없습니다.</p>';
    return;
  }

  groups.forEach((group) => {
    const card = createPickerGroup(group, installerCatalog, dynamicApiAvailable);
    container.appendChild(card);
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
      const shortUrl = toAbsoluteDownloadUrl(getPreferredShortPath(published));

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
    const [installerResponse, featuredResponse] = await Promise.all([
      fetch("./installers.json", { cache: "no-store" }),
      fetch("./featured-branches.json", { cache: "no-store" }),
    ]);

    if (!installerResponse.ok) {
      throw new Error(`Failed to load installers.json: ${installerResponse.status}`);
    }

    if (!featuredResponse.ok) {
      throw new Error(`Failed to load featured-branches.json: ${featuredResponse.status}`);
    }

    const installers = await installerResponse.json();
    const featuredGroups = await featuredResponse.json();
    const installerCatalog = Array.isArray(installers) ? installers : [];
    renderConverter(installerCatalog, { dynamicApiAvailable });
    renderFeaturedGroups(featuredGroups, installerCatalog, { dynamicApiAvailable });
  } catch (error) {
    console.error(error);
    renderConverter([], { dynamicApiAvailable });
    renderFeaturedGroups([], [], { dynamicApiAvailable });
  }
}

bootstrap();
