# html2img Screenshot Utility

`html2img` is a lightweight Puppeteer-based CLI that renders local or remote HTML pages and captures full-page PNG screenshots. It ships with a flexible config file, smart iframe detection, and DOM cleanup options—ideal for turning exported static sites into handoff assets.

## Highlights

- **Batch screenshots with one command**: point `input` to either a directory or a single HTML/URL, and everything ends up in the target folder.
- **Smart iframe mode**: when `followIframe=auto`, the tool decides whether to enter an embedded iframe (perfect for Canva-style exports) or stay on the top page.
- **DOM cleanup hooks**: hide or remove unwanted selectors (e.g., translation plugins, overlays) before capturing.
- **Multiple config formats**: `.toml`, `.json`, and `.env` are supported, with `screenshot.config.toml` provided by default.

## Requirements

- Node.js ≥ 18 (20+ recommended)
- npm
- Optional Chromium install if you need a custom executable path for Puppeteer

## Quick Start

```bash
npm install            # install dependencies
# adjust screenshot.config.toml if needed
npm run screenshot     # capture screenshots
```

## Key Settings

| Field | Description |
| --- | --- |
| `input` / `output` | Directory, single HTML file, or URL to read from, and the target folder for PNGs |
| `followIframe` | Accepts `true` / `false` / `auto`; `auto` tries to follow the most relevant iframe |
| `hideSelectors` | List of selectors to hide via injected CSS |
| `removeSelectors` | List of selectors to remove from the DOM entirely |
| `wait`, `timeout`, `width`, `height` | Rendering wait time, navigation timeout, and viewport options |
| `noSandbox` | Set to `true` when Chromium must run without sandboxing |

## Common Commands

```bash
node capture-screenshot.js --config config.toml
node capture-screenshot.js --input exported --output shots
node capture-screenshot.js --follow-iframe=false
```

## Structure

```
html2img/
├── capture-screenshot.js
├── package.json
├── screenshot.config.toml
├── screenshots/
├── sample *.html + asset folders
├── README.md
└── README.en.md
```

## License

This repository is internal tooling and does not ship with a public license. Add the license of your choice before redistributing.
