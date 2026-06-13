# Security notes

Skull Studio is a **local creative tool**, not a hardened network service. Please
understand the model before running it.

## Threat model

- **Loopback only.** The Studio server binds to `127.0.0.1` (localhost). It is not
  exposed to your network by default. Do not put it behind a public reverse proxy
  or bind it to `0.0.0.0` without adding authentication.
- **No authentication.** Anything that can reach the local port can use every API,
  including reading your filesystem (below). Don't run it on a shared/multi-user
  machine you don't trust.
- **`/api/browse` lists your filesystem.** The editor's "Browse" picker calls a
  read-only directory-listing endpoint so you can choose import/export paths
  anywhere on disk. It returns names of files/folders (not contents). This is
  intentional for a local tool but means the listing is available to any local
  client of the port.
- **Imports/exports run external tools.** Tasks shell out to `node`, `ffmpeg`,
  `soffice`, and (optionally) MinerU. Commands are built from a fixed allow-list
  of task names and passed as argument lists (no shell interpolation), so there is
  no command injection from the task API — but you are still executing those tools
  on files you point it at.
- **Untrusted decks.** Importing a PDF/PPTX runs it through PyMuPDF, LibreOffice,
  and OCR. Open only decks you trust, the same as you would in any office app.

## Recommendations

- Run on a single-user, trusted machine.
- Keep the default `127.0.0.1` binding.
- Review exported HTML before publishing (it inlines your assets and the runtime).
- This is vibe-coded software without a formal audit — read the source if your use
  case is sensitive.

## Reporting

This is a hobby/creative project with no formal security process. Open a GitHub
issue for anything you find; there is no guaranteed response time.
