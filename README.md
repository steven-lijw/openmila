# OpenMila 🎨

> OpenMila — a local-first, Milanote-like canvas app that runs entirely in your browser and stores all data in your local filesystem. No login, no cloud sync, no account required.

![screenshot](https://img.shields.io/badge/status-alpha-orange)
![platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge-blue)
![license](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

- **Visual canvas** — drag, drop, arrange cards freely
- **Note cards** — write rich-text notes with Markdown support
- **Todo cards** — checklists with progress tracking
- **Link cards** — save URLs with auto-preview
- **Image cards** — paste or upload images
- **File cards** — attach local files
- **Columns & Boards** — organize cards into columns, nest boards inside boards
- **100% local** — your data lives in a folder you choose, stored as plain files
- **No login, no cloud** — zero accounts, zero tracking

## 🚀 Quick Start

### Install globally via npm

```bash
npm install -g openmila
```

### Launch

```bash
openmila
```

This will start a local server and open the app in your default browser.

### Options

```bash
openmila --port 3456      # Use a specific port
openmila --no-open        # Start server without opening browser
openmila --help           # Show all options
```

> **⚠️ Browser requirement** — OpenMila is designed for **Chromium-based browsers** (Chrome, Edge). It uses the File System Access API for local storage.

---

## 🛠️ Development

### Prerequisites

- Node.js >= 18
- npm >= 9

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/openmila.git
cd openmila
npm install
npm run dev
```

### Build

```bash
npm run build
npm run preview   # preview the production build locally
```

### Project structure

```
openmila/
├── bin/
│   └── openmila.js        # CLI launcher
├── src/
│   ├── components/        # React components
│   ├── core/              # Business logic
│   ├── state/             # State management
│   ├── storage/           # File system & IndexedDB
│   ├── App.tsx            # Root component
│   ├── main.tsx           # Entry point
│   ├── types.ts           # TypeScript types
│   └── styles.css         # Global styles
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

## 📦 Publishing (for maintainers)

```bash
# 1. Build the production bundle
npm run build

# 2. Bump version (semver)
npm version patch   # or minor / major

# 3. Publish to npm
npm publish
```

## 📄 License

MIT
