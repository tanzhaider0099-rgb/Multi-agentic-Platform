# Hydra

A local-first research desk: organize work into projects, ingest files/web pages/text, ask questions grounded only in what you've ingested, track entities, fact-check claims against the live web, and export findings as PDF, CSV, or Excel — with a choice of online or fully offline AI.

Everything lives on your machine. Nothing is sent anywhere except the API calls you explicitly configure (OpenAI, Anthropic, Tavily, ElevenLabs, or your own local Ollama server) — and those only fire when a feature that needs them is used.

## What's intentionally not in here

The original architecture this was based on included fields and a workflow for tracking a named person's physical movements and security gaps — logging their schedule, home address, and "best window" to approach them when least protected. That's left out entirely, in this version and every version before it. Hydra only ever describes *what a source claims* and *how reliable it is*, never a real person's current or future physical whereabouts.

---

## 1. Installing

### Option A — Run the installer (fastest)
1. Copy `release/Hydra Setup 1.0.0.exe` to your Windows machine.
2. Double-click it. Windows SmartScreen will likely warn "unknown publisher" the first time — expected for an unsigned installer; click **More info → Run anyway**.
3. Finish the wizard. A shortcut is added to your Start Menu and Desktop.

### Option B — Build it yourself from source
Requires [Node.js 18+](https://nodejs.org) on Windows.
```powershell
cd hydra-app
npm install     # also rebuilds the native SQLite module for your machine automatically
npm start        # launches the app directly
```
To produce your own installer:
```powershell
npm run dist
```
Output appears in `release/Hydra Setup 1.0.0.exe`.

---

## 2. Projects — how files get organized

A **project** is just a folder. The first time you create or open one, Hydra scaffolds this structure inside it:

```
Your Project Folder/
├── 01_Raw_Sources/       # exact copies of every file you ingest, timestamped
├── 02_Processed_Notes/   # one Markdown note per ingested item, with YAML frontmatter
├── 03_Entities/
│   ├── People/
│   └── Places/
├── 04_Intelligence/
│   └── Daily-Logs/
└── .hydra/               # the project's private SQLite database — don't edit by hand
```

Everything you ingest for that project — raw files, notes, and the database — stays inside that one folder. Nothing is shared between projects; switching projects switches the entire database.

- **Create new project** — pick a parent folder, name it, Hydra creates the subfolder and structure.
- **Open existing folder** — point Hydra at any folder (empty or not) and it adds the structure alongside whatever's already there, without touching existing files.
- **Remove** (in Settings → Manage projects) only forgets the project from Hydra's list — it never deletes anything on disk.

Switch projects anytime from the pill in the top-right corner of the header.

---

## 3. First launch — setup

The onboarding panel walks through: create/open a project, add an OpenAI key, add a "brain" key. Every step is optional — the app stays usable however far you get. Revisit all of it anytime in **Settings**.

Get keys here:
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/settings/keys
- Tavily (fact-checking): https://tavily.com
- ElevenLabs (alt. transcription): https://elevenlabs.io
- Ollama (fully offline brain/embeddings): https://ollama.com — install it, run `ollama pull llama3.1` (or any model you like), then select "Ollama" as a provider in Settings.

Keys are encrypted at rest using Windows' built-in credential encryption where available.

---

## 4. AI Providers — online or fully offline

Settings → **AI Providers** lets you choose, independently:

| Role | Options |
|---|---|
| **Brain** (writes research answers) | Anthropic · OpenAI · **Ollama (offline)** · Custom CLI command |
| **Embeddings** (powers search) | OpenAI · **Ollama (offline)** |
| **Transcription** (audio/video) | OpenAI Whisper · ElevenLabs |

To run Hydra **fully offline**: install [Ollama](https://ollama.com), pull a chat model (e.g. `llama3.1`) and an embedding model (e.g. `nomic-embed-text`), then set both Brain and Embeddings to Ollama in Settings. OCR and audio transcription still require an online provider today (see "Known limitations" below).

**Custom CLI brain**: point Hydra at any local command — it pipes the prompt to that command's stdin and reads the reply from stdout. Useful for wiring in a local model runner that isn't Ollama, or your own script.

---

## 5. Using it

### Ingest
Add material three ways — file, web page, or pasted text. Supported files: images (OCR), audio/video under 25MB (transcription), PDF, **PowerPoint (.pptx)**, **Excel/CSV**, and plain text/Markdown.

Each entry gets: a title, mentioned people/places, and a date (via a quick AI classification pass); an optional AI rewrite into a clean note (edit or disable this in Settings → Prompts → "Rewrite prompt"); an embedding for search; a copy of the raw file in `01_Raw_Sources`; and a processed note in `02_Processed_Notes` with unified YAML frontmatter (`id`, `title`, `type`, `source_raw_link`, `processed_date`, `tags`, plus reliability tracking fields). New names are automatically added to **Entities**.

Every new entry starts **"Not yet verified"** — nothing is auto-scored. Verification (via Tavily) is a separate, deliberate step you trigger per entry, so you control when live web calls and their cost happen.

### Ask
Type a research question. Hydra runs **hybrid search** — SQLite FTS5 keyword search and vector similarity search, merged with Reciprocal Rank Fusion — against the *current project only*, then returns a four-section answer: **Direct answer**, **Timeline & matrix**, **Perspectives & source reliability**, **Research next steps**. A small badge on the answer shows which search mode ran (hybrid, or keyword-only if no embeddings are configured — search still works either way). If nothing relevant is ingested, it says so rather than guessing. Export any answer as PDF or CSV.

### Entities
Public-record profiles only: role, organization, summary, documented/verified facts, and disputed claims (clearly labeled as disputed). There is no field for physical security or movement patterns — deliberate, not an oversight.

Each entity has two extra actions:
- **Generate wiki page** — synthesizes every ingested source that mentions this entity, plus its known relationships, into a sourced overview page written to `05_Wiki/` in the project vault. Every claim traces back to a numbered source.
- **View in graph** — jumps to the Graph tab focused on this entity's connections.

### Graph
A knowledge graph of entities and the relationships between them, built automatically during ingestion — either an AI-labeled relation (`WORKS_FOR`, `MET_WITH`, etc.) when the classifier can extract one, or a generic "co-mentioned" edge (with a weight that increases each time two entities appear together) when it can't. Rendered as an interactive force-directed graph — drag nodes, scroll to zoom, click a node to see its connections and jump to its entity profile. "Show full graph" loads everything in the project; "Focus" narrows to one entity's neighborhood.

### Export
Bulk CSV/Excel of everything ingested, plus a PDF style choice — **Simple** or **Branded** (Hydra header/footer) — that applies to every PDF export across the app.

### Settings
- **Projects** — see section 2.
- **AI Providers** — see section 4.
- **Connections** — API keys, each with a live "Test" button.
- **MCP Servers** — you can register MCP server name/URL pairs here now. This is a *scaffold*: it saves the list, but Ask does not yet call out to these servers. Wiring an actual MCP tool-use loop into the Ask flow is the natural next step if you want to extend this yourself, or ask for it in a follow-up.
- **Prompts** — every prompt Hydra sends to the AI, editable in plain text, with a reset-to-defaults button.

---

## 6. Troubleshooting

- **Nothing happens / a red toast appears** — the app never fails silently; every error surfaces as a toast or, for serious issues, a modal. The message tells you what to fix.
- **"Open log file"** (Settings, bottom) — a plain-text log of everything the app has done.
- **"No project is open"** errors — create or open a project from the pill in the top-right first; nothing can be ingested or searched without one.
- **Whisper fails on a large file** — 25MB API cap; compress/split first, or switch to ElevenLabs.
- **A PDF ingests with no text** — likely scanned/image-only; export the page as an image and ingest that instead (goes through OCR).
- **Ollama errors** — confirm `ollama serve` is running and the model name in Settings matches one you've pulled (`ollama list`).

---

## 7. Known limitations (so nothing here is oversold)

- **OCR** is OpenAI Vision only right now — no offline OCR provider is wired up yet.
- **MCP servers** are stored but not yet queried during Ask — see the note in section 5.
- **This is a local, single-user knowledge graph**, not a graph database server — relationships are stored in the project's SQLite file and rendered on demand. It handles a personal research archive comfortably; it is not Neo4j and isn't trying to be.
- **Supabase/cloud sync**, multi-user accounts, RBAC, and hosted deployment described in earlier architecture discussions are not implemented — Hydra is a single-user desktop app by design, not an enterprise multi-tenant platform. That would be a different project (a hosted web app with a real backend), not a mode this Electron app can honestly grow into.
- **ElevenLabs transcription** is implemented against their documented Speech-to-Text endpoint but hasn't been exercised against a live account in this build environment (no outbound network access to elevenlabs.io from where this was built) — test it with your own key before relying on it.

---

## 8. Project structure (for anyone building from source)

```
hydra-app/
├── main.js               # Electron main process, error handling, IPC wiring
├── preload.js             # Safe bridge exposed to the renderer as window.hydra
├── src/
│   ├── config.js          # Settings, encrypted keys, prompts, provider config
│   ├── projects.js        # Project registry — create/open/switch/remove
│   ├── db.js               # Per-project SQLite storage, FTS5 keyword search, vector search, graph edges
│   ├── vault.js            # Raw file copying + Markdown note/entity/wiki page writing
│   ├── ingest.js           # Ingestion orchestrator (all file types + URL + text + relationship extraction)
│   ├── extract.js          # PDF / PPTX / XLSX / plain text extraction
│   ├── llm.js               # Brain (Anthropic/OpenAI/Ollama/CLI) + OCR + transcription
│   ├── embeddings.js       # OpenAI / Ollama embedding dispatch
│   ├── search.js            # Hybrid RAG query engine (vector + keyword, Reciprocal Rank Fusion)
│   ├── graph.js             # Knowledge graph queries (full graph / entity neighborhood)
│   ├── wiki.js              # Entity wiki page generation
│   ├── factcheck.js         # Tavily-based claim verification
│   ├── entities.js          # Entity CRUD + vault sync
│   └── exporter.js          # PDF (simple/branded) / CSV / XLSX export
├── renderer/                # UI (vanilla HTML/CSS/JS, no build step)
├── assets/                  # App icon
├── test/manual-test.js      # Headless smoke test — no API keys needed
└── package.json
```

Run the smoke test anytime:
```
node test/manual-test.js
```
It exercises project creation/isolation, ingestion storage, hybrid (vector + keyword) search, PPTX/XLSX extraction, entity/vault writing, the knowledge graph and relationship weighting, wiki generation's error handling, and all three export formats — 33 checks, no network required.
