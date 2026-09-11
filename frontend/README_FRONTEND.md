# Gita Guide — Frontend

React (Vite) client for **Gita Guide**, a three-pane RAG chat UI over the Bhagavad Gita. It streams answers from the FastAPI backend, shows retrieved verses, supports Explore browsing, light/dark themes, bookmarks, and chat history.

This document describes **everything** in the `frontend/` folder and how the UI system works.

---

## Table of contents

1. [What this app does](#1-what-this-app-does)
2. [Directory layout](#2-directory-layout)
3. [Tech stack](#3-tech-stack)
4. [Setup & scripts](#4-setup--scripts)
5. [Talking to the backend](#5-talking-to-the-backend)
6. [Architecture](#6-architecture)
7. [Source file reference](#7-source-file-reference)
8. [Application state (`App.jsx`)](#8-application-state-appjsx)
9. [Layout: flyout left + push right](#9-layout-flyout-left--push-right)
10. [Components](#10-components)
11. [API client (`api.js`)](#11-api-client-apijs)
12. [localStorage (`bookmarks.js`)](#12-localstorage-bookmarksjs)
13. [Theming (`index.css`)](#13-theming-indexcss)
14. [User-facing features](#14-user-facing-features)
15. [Build tooling](#15-build-tooling)
16. [Mobile / LAN access](#16-mobile--lan-access)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. What this app does

| Area | Behavior |
|------|----------|
| Chat | Draft sessions (local UUID), streaming SSE replies, stop / retry |
| Modes | Brief / Deep / Practical + optional memory context + temperature |
| Sources | Contextual right panel with verse cards, neighbors, multi-translator expand |
| Explore | Browse chapters 1–18; ask about a verse (prefills composer) |
| History | Search, date filters, delete, server-side chat bookmarks |
| Saved | Bookmarked chats + locally saved verses |
| UX | Overlay history flyout, push Sources panel, light/dark themes |
| Meta | Usage meter (30/hour), Markdown export, copy, thumbs feedback |

Default URLs:

- UI: [http://localhost:5173](http://localhost:5173)
- API: `http://localhost:8000` (see `src/api.js`)

---

## 2. Directory layout

```text
frontend/
├── index.html              # Shell, Google Fonts (Cormorant Garamond + DM Sans)
├── package.json
├── package-lock.json
├── vite.config.js          # React plugin, port 5173
├── tailwind.config.js      # class darkMode, sage/gold/ink/clay extensions
├── postcss.config.js       # tailwind + autoprefixer
├── dist/                   # Production build output (generated)
├── node_modules/           # Dependencies (generated)
└── src/
    ├── main.jsx            # React root mount
    ├── App.jsx             # Orchestrator: state, panels, streaming
    ├── api.js              # Axios + SSE streamMessage
    ├── bookmarks.js        # Verse bookmarks + temperature persistence
    ├── index.css           # CSS variables, flyout, panel transitions
    └── components/
        ├── Sidebar.jsx     # History flyout, Saved, settings, usage
        ├── ChatWindow.jsx  # Chat, modes, starters, message actions
        └── SourcePanel.jsx # Sources + Explore
```

There is no React Router — the whole product is a single-page three-pane shell.

---

## 3. Tech stack

- **React 18** + **Vite 8**
- **Tailwind CSS 3** (utility classes + CSS variables for themes)
- **Axios** for REST
- **Fetch + ReadableStream** for SSE
- **lucide-react** icons
- Fonts: **DM Sans** (UI), **Cormorant Garamond** (serif headings / logo)

---

## 4. Setup & scripts

### First time

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The backend must already be running on port **8000** with verses ingested.

### Scripts (`package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite` | Dev server (port **5173**) |
| `build` | `vite build` | Production bundle → `dist/` |
| `preview` | `vite preview` | Serve production build locally |

No test/lint scripts are defined.

### Daily use

```bash
cd frontend
npm run dev
```

---

## 5. Talking to the backend

`src/api.js`:

```js
const API_BASE = 'http://localhost:8000'
```

Change this (or uncomment a LAN IP) when accessing from another device. There is **no** Vite proxy and **no** `VITE_*` env wiring today — the base URL is hardcoded.

Required backend capabilities used by the UI:

- `GET /chats`, `GET /chats/{id}`, `DELETE /chats`, `DELETE /chats/{id}`
- `PATCH /chats/{id}/bookmark`
- `POST /chat/{id}/stream` (primary chat path)
- `GET /verses`, `GET /usage`
- `POST /messages/{id}/feedback`

Unused but exported helpers: `createChat`, `getVerse`, `sendMessage` (non-stream).

---

## 6. Architecture

```text
┌────────────────────────────────────────────────────────────┐
│ App.jsx                                                     │
│  state: chats, messages, sources, panels, bookmarks, …      │
└───────┬──────────────────┬──────────────────┬──────────────┘
        │                  │                  │
   Sidebar.jsx        ChatWindow.jsx     SourcePanel.jsx
   (overlay flyout)   (flex-1 main)      (push aside)
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                        api.js → FastAPI :8000
```

- **Sidebar** is `position: fixed` overlay (does not shrink the chat).
- **SourcePanel** is a flex sibling that **pushes** the chat when open.
- **ChatWindow** always fills remaining horizontal space.

---

## 7. Source file reference

### `main.jsx`

Mounts `<App />` into `#root` under `React.StrictMode`. Imports `index.css`.

### `App.jsx`

Owns all cross-cutting state and wires children. Key responsibilities:

- Load / refresh chats & usage
- Draft chat IDs (`crypto.randomUUID()`)
- Streaming send / stop / retry
- Dark mode (`html.dark` + `localStorage`)
- Left flyout + right contextual panel logic
- Verse bookmarks (local) + chat bookmarks (API)
- Markdown export
- Feedback, clear-all, settings temperature

Helpers:

- `exportMarkdown(messages, sources, title)` — downloads `.md`
- `snapshotVerse(v)` — fields kept for local verse bookmarks

### `api.js`

Axios instance + `streamMessage()` SSE parser. See [§11](#11-api-client-apijs).

### `bookmarks.js`

localStorage helpers for verse bookmarks and temperature. See [§12](#12-localstorage-bookmarksjs).

### `index.css`

Design tokens, flyout CSS, panel width transitions, title fade mask, scrollbars. See [§13](#13-theming-indexcss).

### Components

Documented in [§10](#10-components).

---

## 8. Application state (`App.jsx`)

### Chat & history

| State | Meaning |
|-------|---------|
| `chats` | Sidebar summaries from `GET /chats` |
| `chatsLoading` | List loading |
| `activeChatId` | Current session UUID (always set; starts as new UUID) |
| `chatTitle` | Header/export title |
| `searchQuery` | Debounced 250 ms → `listChats` |
| `dateFilter` | `"all"` \| `"today"` \| `"7d"` |

**Draft chats:** clicking New Chat only sets a new UUID and clears local messages — no `POST /chats`. Persistence happens when the first stream completes (`done` → `upsertChatInSidebar`).

### Messages & streaming

| State | Meaning |
|-------|---------|
| `messages` | Active transcript (optimistic user + streaming assistant) |
| `sources` | Latest retrieved verses |
| `sending` | Stream in progress |
| `draft` | Composer text |
| `error` / `retryText` | Toast + retry |
| `abortRef` | `AbortController` for Stop |

Stream handlers:

- `meta` → set `sources` (opens right panel unless user closed it)
- `token` → append to assistant content
- `done` → finalize ID/title, refresh usage
- abort → keep partial text
- error → toast; enable Retry

### Modes & limits

| State | Default | Notes |
|-------|---------|--------|
| `attachMemory` | `true` | Sent as `attach_memory_context` |
| `responseMode` | `"practical"` | `brief` / `deep` / `practical` |
| `temperature` | `0.4` | From localStorage; Settings slider |
| `usage` | from API | `rateLimited` when `remaining === 0` |

### Bookmarks

| Kind | Storage | API |
|------|---------|-----|
| Verses | `localStorage` `gita-bookmarks` | none |
| Chats | Server `bookmarked` flag | `PATCH /chats/{id}/bookmark` |

### Panels

| State | Meaning |
|-------|---------|
| `leftPinned` / `leftPeek` | History flyout visibility |
| `canHover` | `(hover: hover) and (pointer: fine)` |
| `rightUserOpened` / `rightUserClosed` | Manual override for Sources |
| `panelTab` | `"sources"` \| `"explore"` |
| `highlightedSourceKey` | `"chapter-verse"` for citation scroll |
| `focusVerse` | Explore selection seed |
| `darkMode` | Theme |

Right panel formula:

```text
rightOpen = (sources.length > 0 || rightUserOpened) && !rightUserClosed
```

New Chat resets `rightUserOpened` / `rightUserClosed` so the next retrieval can auto-open Sources again.

---

## 9. Layout: flyout left + push right

### Left — auto-hide overlay flyout

- Closed: 14 px **edge cue** (faint line + chevron).
- Desktop hover on cue/panel → `leftPeek` (slides over chat with shadow).
- Leave delay ~160 ms to avoid flicker.
- **☰** in chat header **pins** the drawer; pinned mode shows a dim **scrim**.
- Touch devices: edge cue is non-interactive; use ☰ only.
- CSS: `.flyout-shell` fixed, width 288 px, `translateX` transition, `z-index: 45`.

### Right — contextual push panel

- Width animates **0 ↔ 320 px** (`.panel-collapse`).
- Remains in the flex row → **shrinks** the chat (side-by-side reading).
- Auto-opens when sources arrive; respects manual close until user opens Sources again or starts a new chat.
- Tabs: **Sources** | **Explore**.

---

## 10. Components

### `Sidebar.jsx`

**Role:** History, Saved library, usage, theme, settings.

**Props (high level):** chats, selection/new/delete/bookmark handlers, search/date filters, dark mode, usage, verse bookmarks, temperature, clear-all, `open`, `onClose`.

**Internal UI:**

- Tabs: **Chats** | **Saved**
- Chats: search, All / Today / 7 days, list with ⋮ menu (**Bookmark** / **Delete**) that stays open until action, outside click, or Escape
- Saved: **Saved Chats** (server bookmarks) + **Saved Verses** (local)
- Footer: usage bar, Light/Dark, Settings gear
- Settings modal: temperature `0–1` step `0.05`, clear conversations, clear verse bookmarks

### `ChatWindow.jsx`

**Role:** Main conversation surface.

**Props:** messages, send/stop, memory & mode, citations, export, feedback, draft, rate limit, left/right toggles.

**Features:**

- Header: ☰, Sources, Export, Brief/Deep/Practical chips, Attach Memory checkbox (flex-aligned)
- Empty state: quote + **4 starter prompt chips** (send on click)
- Assistant rendering: paragraphs, lists, `**bold**`, `*italic*`, clickable `[Chapter N, Verse M]`
- Message actions: Copy, Thumbs up/down
- Composer always enabled on empty draft chat (no “start a new chat first”)
- Stop button while streaming; auto-scroll to bottom

Starter prompts (hardcoded):

1. What does the Gita say about finding purpose?
2. How do I deal with anxiety at work?
3. How can I practice detachment without becoming indifferent?
4. What is karma yoga in daily life?

### `SourcePanel.jsx`

**Role:** Retrieved context + verse explorer.

**Sources tab:** verse cards (Sanskrit, transliteration, translations, similarity %), neighbors, bookmark toggle, citation highlight + `scrollIntoView`.

**Explore tab:** chapter select → verse list → detail card with **scrollable** translation area + “Ask about this verse” (creates draft chat and prefills a prompt).

**TranslationsList:** first block shown; expand for additional labeled translators.

---

## 11. API client (`api.js`)

### REST (Axios)

| Export | Method & path |
|--------|----------------|
| `listChats({ q, since })` | `GET /chats` |
| `getChat(id)` | `GET /chats/{id}` |
| `deleteChat(id)` | `DELETE /chats/{id}` |
| `deleteAllChats()` | `DELETE /chats` |
| `setChatBookmark(id, bookmarked)` | `PATCH /chats/{id}/bookmark` |
| `listVerses(chapter)` | `GET /verses?chapter=` |
| `getUsage()` | `GET /usage` |
| `sendFeedback(id, rating)` | `POST /messages/{id}/feedback` |
| `sendMessage(...)` | `POST /chat/{id}` (unused by App) |
| `createChat()` | `POST /chats` (unused by App) |
| `getVerse(c, v)` | `GET /verses/{c}/{v}` (unused by App) |

### Streaming (`streamMessage`)

`POST /chat/{id}/stream` with JSON body:

- `message`
- `attach_memory_context`
- `response_mode`
- `temperature`

Parses SSE (`event:` / `data:` blocks split on `\n\n`). Dispatches `onMeta`, `onToken`, `onDone`, `onError`.

Error codes surfaced to App:

- `aborted` — user Stop
- `offline` — network / backend down
- `rate_limit` — HTTP 429
- `http` / `stream` — other failures

---

## 12. localStorage (`bookmarks.js`)

| Key | Contents |
|-----|----------|
| `gita-bookmarks` | JSON array of verse snapshots |
| `gita-temperature` | Number string `0–1` (default `0.4`) |
| `gita-dark` | `"1"` dark / `"0"` light (written from `App.jsx`) |

`verseKey(v)` → `"${chapter}-${verse}"`.

Chat bookmarks are **not** in localStorage — they live on the backend.

---

## 13. Theming (`index.css`)

Themes are driven by CSS variables on `:root` vs `html.dark` (class toggled by App). Components use `var(--…)` so light and dark stay distinct without relying only on Tailwind `dark:` classes.

### Light (sage + parchment)

- App/chat background: warm parchment (`#faf7f0`)
- Sidebar: pale sage (`#e9efe4`), dark olive text
- Accent: gold (`#c4841a`)
- Active mode chips: dark olive on cream text
- New Chat: outline button

### Dark (warm charcoal + terracotta)

- Chat: `#1a1a1a`; sidebar: muted forest charcoal `#151914`
- Text: cream `#e8e6e1`; muted gray-brown
- Accent / active chips: terracotta `#d97757`
- Elevated surfaces / input: `#2b2b2b`

### Layout CSS

| Class | Purpose |
|-------|---------|
| `.flyout-shell` | Left overlay slide |
| `.flyout-scrim` | Dim backdrop when pinned |
| `.left-edge-cue` | Discoverability strip |
| `.panel-collapse` | Right panel width 0↔320 |
| `.chat-title-fade` | Gradient mask instead of hard ellipsis |
| `.font-serif` | Cormorant Garamond |

Tailwind still provides spacing/layout utilities. Extended palettes (`sage`, `gold`, `ink`, `clay`) exist in `tailwind.config.js` but most chrome uses CSS variables.

---

## 14. User-facing features

| Feature | Where |
|---------|--------|
| New chat / history / search / filters | Sidebar → Chats |
| ⋮ Bookmark / Delete chat | Sidebar chat row |
| Saved chats & verses | Sidebar → Saved |
| Starter prompts | Empty ChatWindow |
| Brief / Deep / Practical | Chat header |
| Attach Memory Context | Chat header checkbox |
| Stream, Stop, Retry | Chat + error toast |
| Copy / Thumbs | Under assistant bubbles |
| Export Markdown | Chat header |
| Citations → Sources highlight | Inline in assistant text |
| Explore + Ask about verse | SourcePanel |
| Verse bookmark | Verse card icon |
| Usage meter | Sidebar footer |
| Light / Dark | Sidebar footer |
| Temperature, clear data | Settings modal (gear) |
| History flyout / Sources toggle | Chat header ☰ and Sources |

---

## 15. Build tooling

### Vite (`vite.config.js`)

- `@vitejs/plugin-react`
- Dev server port **5173**
- No API proxy

### Tailwind (`tailwind.config.js`)

- `darkMode: 'class'`
- Content: `./index.html`, `./src/**/*.{js,jsx}`
- Extended colors and font families

### PostCSS

- `tailwindcss`, `autoprefixer`

### Runtime dependencies

- `react`, `react-dom`, `axios`, `lucide-react`

### Dev dependencies

- `vite`, `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`

---

## 16. Mobile / LAN access

1. Same Wi‑Fi as the PC.
2. Backend: `--host 0.0.0.0 --port 8000`
3. Frontend: `npm run dev -- --host 0.0.0.0`
4. Set `API_BASE` in `api.js` to the PC’s LAN IP (e.g. `http://192.168.1.42:8000`).
5. Open `http://<pc-ip>:5173` on the phone.
6. Allow firewall for ports 5173 / 8000; update backend CORS if the browser blocks cross-origin calls.

Hover flyout does not apply on touch — use the hamburger.

---

## 17. Troubleshooting

| Problem | Fix |
|---------|-----|
| “Could not reach the backend” | Start uvicorn on `:8000`; check `API_BASE` |
| Chat bookmark fails | Backend must include `PATCH /chats/{id}/bookmark` — restart API |
| Empty Explore / no sources | Ingest dataset on backend |
| Rate limit placeholder | Soft 30/hour; wait or check usage meter |
| Themes look the same | Ensure `html.dark` toggles; hard-refresh |
| Explore translation clipped | Detail pane is scrollable (max ~55% height) |
| ⋮ menu vanishes on hover | Fixed to stay open until click outside / Escape / action |
| Phone can’t call API | LAN IP in `api.js` + CORS origins on backend |

### Production build

```bash
npm run build
npm run preview
```

Serve `dist/` behind any static host; the API must still be reachable at the configured `API_BASE` (or you must change that constant / add env-based config).
