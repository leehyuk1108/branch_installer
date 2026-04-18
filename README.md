# branch_installer

Static comma installer hosting for GitHub Pages.

This project does two things:

1. builds pre-patched `installer` ELF files that point at a chosen Git repository and branch
2. publishes those files and a small human-friendly catalog through GitHub Pages

## Why this repo exists

comma devices do not install from HTML. They download a file from the entered URL and only continue if the file starts with the ELF magic bytes.

That means GitHub Pages can host a working installer only if the final install URL points directly at a prebuilt ELF file such as:

```text
https://<user>.github.io/branch_installer/installers/<owner>/<branch>/installer
```

The landing page is for humans. The direct `/installer` file is for the comma device.

## What this does not do

- It does not dynamically generate installers on request.
- It does not inspect arbitrary owner/branch input at runtime.
- It does not replace a real application server when you need per-request logic.

GitHub Pages is static hosting, so every supported installer must be generated ahead of time.

## Layout

- `installer_targets.json`: list of installers to publish
- `scripts/generate_installers.py`: patches the official installer template
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

If `aliases` is present, the first alias becomes the short direct URL:

```text
https://<user>.github.io/branch_installer/<alias>
```

Then rerun:

```bash
python3 scripts/generate_installers.py
```
