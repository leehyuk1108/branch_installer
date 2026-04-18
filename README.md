# branch_installer

Comma installer hosting with short aliases, Netlify Functions, and optional local server mode.

This project does two things:

1. builds pre-patched `installer` ELF files that point at a chosen Git repository and branch
2. publishes those files through GitHub Pages, Netlify, or a local dynamic server

## Why this repo exists

comma devices do not install from HTML. They download a file from the entered URL and only continue if the file starts with the ELF magic bytes.

That means GitHub Pages can host a working installer only if the final install URL points directly at a prebuilt ELF file such as:

```text
https://<user>.github.io/branch_installer/installers/<owner>/<branch>/installer
```

The landing page is for humans. The direct installer URL is for the comma device.

## Hosting modes

### GitHub Pages

- pre-generated aliases such as `/c` or `/h`
- zero infrastructure beyond GitHub
- best when you already know which repos and branches to publish

GitHub Pages is static hosting, so every supported installer must be generated ahead of time.

### Dynamic server

- serves the same catalog UI
- can generate installers on demand for arbitrary GitHub repo and branch pairs
- can be exposed from a home PC with port forwarding or a tunnel

### Netlify

- serves the `docs/` site as static assets
- handles `/api/*` and `/i/*` through Netlify Functions
- keeps short published aliases like `/c` and `/h`
- removes the need to keep your own PC online

## Layout

- `installer_targets.json`: list of installers to publish
- `installer_lib.py`: shared installer patching logic
- `scripts/generate_installers.py`: patches the official installer template
- `netlify/functions/installer.mts`: dynamic installer function for Netlify
- `server.py`: optional dynamic server for your own machine
- `docs/`: GitHub Pages site and generated installer files

## Generate installers locally

```bash
cd /Users/ijonghyeog/Desktop/Coding/branch_installer
python3 scripts/generate_installers.py
```

By default this:

- downloads the official installer template from `https://openpilot.comma.ai`
- patches the embedded Git URL and branch
- writes installers under `docs/installers/...`
- writes `docs/installers.json` for the site

## Publish with GitHub Pages

1. Create a GitHub repository named `branch_installer`.
2. Push this project.
3. Enable GitHub Pages for the repository.
4. Set the Pages source to GitHub Actions, or serve from the `docs/` folder on `main`.

If you use GitHub Actions, the included workflow can regenerate installers after config changes.

## Publish with Netlify

This repo is already set up for Netlify:

- static assets publish from `docs`
- dynamic routes are handled by `netlify/functions/installer.mts`
- config lives in `netlify.toml`

For local Netlify emulation:

```bash
cd /Users/ijonghyeog/Desktop/Coding/branch_installer
npm install
npm run netlify:dev
```

## Add another installer

Edit `installer_targets.json` and add another object:

```json
{
  "slug_owner": "example",
  "slug_branch": "release-c3",
  "aliases": ["rc3"],
  "git_url": "https://github.com/example/openpilot.git",
  "git_branch": "release-c3",
  "title": "Example release-c3",
  "description": "Example static installer target."
}
```

If `aliases` is present, the first alias becomes the preferred short direct URL:

```text
https://<user>.github.io/branch_installer/<alias>
```

Extra aliases still work. For example, `["h", "hl"]` makes both `/h` and `/hl` valid.

Then rerun:

```bash
python3 scripts/generate_installers.py
```

## Run the dynamic server

```bash
cd /Users/ijonghyeog/Desktop/Coding/branch_installer
python3 server.py --host 0.0.0.0 --port 8080
```

Useful routes:

- `/c`, `/h`: short aliases from `installer_targets.json`
- `/i/<owner>/<repo>/<branch>`: on-demand installer generation
- `/api/resolve?input=<github branch url>`: converter endpoint for the UI

Examples:

```text
http://YOUR-PC:8080/h
http://YOUR-PC:8080/i/leehyuk1108/sunny-hl/release-c3-hl
```

## Expose it outside your house

You have two practical options:

1. Port forward `80` or `8080` on your router to the PC running `server.py`
2. Put a reverse proxy or tunnel in front of it and use your own short domain

If you want the shortest usable links, pair the server with a short domain and single-letter aliases:

```text
https://p.example/h
https://p.example/c
```

That is the piece GitHub Pages cannot solve by itself because the `github.io` hostname is long and the hosting is static.
