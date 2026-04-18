function toAbsoluteDownloadUrl(path) {
  return new URL(path, window.location.href).toString();
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

function renderInstallerCard(installer) {
  const article = document.createElement("article");
  article.className = "installer-card";

  const directUrl = toAbsoluteDownloadUrl(installer.download_path);

  article.innerHTML = `
    <div class="meta-grid">
      <p class="panel-kicker">${installer.slug_owner}/${installer.slug_branch}</p>
      <h3>${installer.title}</h3>
      <p>${installer.description}</p>
    </div>
    <div class="meta-grid">
      <div class="meta-row">
        <span class="meta-label">Git target</span>
        <div class="mono">${installer.git_url}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Branch</span>
        <div class="mono">${installer.git_branch}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Direct installer URL</span>
        <div class="url-box mono">${directUrl}</div>
      </div>
      <div class="meta-row">
        <span class="meta-label">Binary</span>
        <div class="mono">${formatBytes(installer.size_bytes)} · sha256 ${installer.sha256}</div>
      </div>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const copyButton = document.createElement("button");
  copyButton.className = "action-button action-primary";
  copyButton.textContent = "Copy URL";
  copyButton.addEventListener("click", () => copyText(directUrl, copyButton));

  const openButton = document.createElement("a");
  openButton.className = "action-button action-secondary";
  openButton.textContent = "Open Binary";
  openButton.href = directUrl;
  openButton.target = "_blank";
  openButton.rel = "noreferrer";

  actions.append(copyButton, openButton);
  article.append(actions);
  return article;
}

async function bootstrap() {
  const container = document.getElementById("installer-list");

  try {
    const response = await fetch("./installers.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load installers.json: ${response.status}`);
    }

    const installers = await response.json();
    container.innerHTML = "";

    if (!Array.isArray(installers) || installers.length === 0) {
      container.innerHTML = `<p class="empty-state">No installers have been generated yet.</p>`;
      return;
    }

    installers.forEach((installer) => {
      container.appendChild(renderInstallerCard(installer));
    });
  } catch (error) {
    console.error(error);
    container.innerHTML = `<p class="error-state">Failed to load installer catalog.</p>`;
  }
}

bootstrap();

