# Claude Sessions

A VS Code extension that lets you browse, search, and replay your local [Claude Code](https://claude.ai/code) session history — organised by project.

---

## Features

- **Session browser** — sessions grouped by workspace project in the Activity Bar
- **Live pending-input badge** — a count badge appears when any Claude session is waiting for your reply; the session is highlighted with a bell icon
- **Focus session** — clicking a pending session jumps to the terminal running that Claude process
- **Session viewer** — clicking any past session opens the full conversation in a webview panel
- **Auto-expand active project** — the currently active project group expands automatically on load
- **Live refresh** — the tree refreshes every 5 s and reacts immediately to file-system changes

---

## Installation

### Quick install (recommended)

```bash
git clone https://github.com/sepehrn0107/ClaudeSession-vs-extention.git
cd ClaudeSession-vs-extention
bash install.sh
```

The script compiles the TypeScript source and copies the built extension into your VS Code extensions folder.

After it finishes, open VS Code and run:

```
Ctrl+Shift+P → Developer: Reload Window
```

The Claude Sessions icon will appear in the Activity Bar.

### Manual install

```bash
npm install
npm run compile
```

Then copy the `out/`, `media/`, and `package.json` into a new folder inside `~/.vscode/extensions/`.

---

## Setup

Open VS Code settings (`Ctrl+,`) and configure:

| Setting | Required | Description |
|---|---|---|
| `claudeSessions.workspaceRoot` | **Yes** | Absolute path to the directory whose subdirectories are your projects. Example: `/home/you/workspace` or `C:\Users\you\workspace`. |
| `claudeSessions.activeProjectFile` | No | Path to a file containing `active: <name>` on the first matching line. When set, that project group is expanded by default. |

**Example `settings.json`:**

```json
{
  "claudeSessions.workspaceRoot": "/home/you/workspace",
  "claudeSessions.activeProjectFile": "/home/you/workspace/memory/active-project.md"
}
```

If `workspaceRoot` is not set the tree shows a prompt instead of sessions.

---

## How it works

### Session discovery

Claude Code writes every session as a `.jsonl` file under:

```
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

Each line is a JSON object representing one turn (user message, assistant reply, tool call, etc.). The extension reads the first 20 lines of each file to extract:

- **Start time** — from the first `timestamp` field
- **First user message** — used as the session title in the tree
- **Working directory** — from the `cwd` field, used for project grouping

### Project grouping

The extension resolves which project a session belongs to by comparing the session's `cwd` (or the last opened file path extracted from the conversation) against the subdirectories of `workspaceRoot`. A session is placed under the first project whose root is a prefix of the session path. Sessions that do not match any project land in an **other** group.

### Pending-input detection

When a Claude Code process is waiting for your reply it writes a status snapshot to:

```
~/.claude/sessions-status/<pid>.json
```

The extension maps PIDs to session IDs via `~/.claude/sessions/<pid>.json`, reads the `pendingInput` field from the status file, and reflects the count as an Activity Bar badge. The tree and badge update within 5 seconds (or immediately on a file-system event).

### Focus session

Clicking a pending session attempts to identify the VS Code terminal that is running the Claude process by walking up the process tree from the Claude PID to its parent shell PID, then matching against open terminals. If a match is found the terminal is brought into focus. Otherwise the session viewer opens as a fallback.

---

## Requirements

- VS Code 1.85 or later
- Node.js 18+ (for building from source)
- [Claude Code](https://claude.ai/code) CLI installed and used at least once (so `~/.claude/projects/` exists)
