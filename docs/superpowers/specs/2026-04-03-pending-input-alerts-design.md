# TB-02: Pending Input Alerts — Design Spec

**Date:** 2026-04-03  
**Ticket:** TB-02  
**Status:** Approved

## Goal

Visually surface live Claude Code sessions that are stalled waiting for user input so they are never silently buried in the Sessions tree panel.

---

## Architecture Overview

Three files change. Everything flows through the existing disk-file pipeline; no new IPC or polling loop is introduced.

```
Claude Code process
  └─ statusline-command.js  (stdin → writes sessions-status/<pid>.json)
       └─ ~/.claude/sessions-status/<pid>.json  (new field: pendingInput)
            └─ extension.js  (fs.watch → provider.refresh())
                 └─ SessionsProvider  (reads status files, decorates tree)
```

---

## Section 1: Data Pipeline

### `statusline-command.js`

The statusline command already receives the full Claude Code state payload via stdin and writes a snapshot to `~/.claude/sessions-status/<pid>.json` (named by `process.ppid`, the Claude Code process PID).

**Change:** capture `pendingInput` from the payload and include it in the snapshot when truthy:

```js
if (data.pendingInput) snapshot.pendingInput = true;
```

The field is omitted when false. This keeps snapshot files minimal and makes truthy checks cheap.

### `extension.js`

Add a second `fs.watch` on `~/.claude/sessions-status/` alongside the existing watcher on `~/.claude/projects/`. Both watchers call `provider.refresh()`. A `setInterval` polling fallback at 5 s runs alongside the watcher — `fs.watch` is unreliable on Windows for fast consecutive writes, so the interval ensures state is eventually consistent even when events are missed.

```js
const statusDir = path.join(os.homedir(), '.claude', 'sessions-status');
if (fs.existsSync(statusDir)) {
  const statusWatcher = fs.watch(statusDir, () => provider.refresh());
  context.subscriptions.push({ dispose: () => statusWatcher.close() });
}
const pollTimer = setInterval(() => provider.refresh(), 5000);
context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
```

### Join key: sessionId → pid

- `~/.claude/sessions/<pid>.json` maps `pid` → `sessionId` (UUID)
- `SessionReader.listSessions()` returns sessions keyed by their JSONL filename = `sessionId`
- `~/.claude/sessions-status/<pid>.json` is keyed by `pid`

On each tree refresh, `SessionsProvider` scans both `sessions/` and `sessions-status/` to build a `Map<sessionId, snapshot>` and passes it down to `SessionNode` construction.

---

## Section 2: Tree Decoration

### `SessionNode`

When `pendingInput` is true on the matched snapshot:

| Property | Normal | Pending |
|---|---|---|
| `iconPath` | `ThemeIcon("comment-discussion")` | `ThemeIcon("bell-dot")` |
| `description` | `"Apr 3, 2:14 PM"` | `"Apr 3, 2:14 PM · Waiting"` |
| `contextValue` | `"session"` | `"session-pending"` |

`bell-dot` is amber-tinted in most VS Code themes and communicates "needs attention" without requiring a custom SVG. The `· Waiting` description suffix ensures the state is legible when icon size is small or for colorblind users.

### Count badge

Use `vscode.window.createTreeView` (replacing `registerTreeDataProvider`) to get a handle on the view, then set `treeView.badge`:

```ts
treeView.badge = pendingCount > 0
  ? { value: pendingCount, tooltip: `${pendingCount} session${pendingCount > 1 ? 's' : ''} waiting for input` }
  : undefined;
```

The badge renders on the view's title bar in the sidebar and on the Claude Sessions activity bar icon — both at the top of the panel and visible from peripheral vision. This is distinct from a root-level tree item; it does not add noise to the session list itself.

### Clearing

When `pendingInput` goes back to false, the statusline command writes a new snapshot without the field. The `fs.watch` fires, `provider.refresh()` runs, and `getChildren()` rebuilds the tree. The decoration and badge disappear automatically with no extra logic.

---

## Section 3: Terminal Focus

### Command: `claudeSessions.focusSession`

A new command registered alongside the existing `claudeSessions.openSession`. The `SessionNode` constructor sets its `command` property conditionally: `claudeSessions.focusSession` when `pendingInput` is true, `claudeSessions.openSession` otherwise. The `contextValue` change to `"session-pending"` is for future context-menu use only — it does not drive the click behavior.

### `findTerminalForPid(claudePid: number): Promise<vscode.Terminal | undefined>`

```
1. wmic process where (ProcessId=<claudePid>) get ParentProcessId
   → shellPid
2. for each terminal in vscode.window.terminals:
     termPid = await terminal.processId
     if termPid === shellPid → return terminal
3. return undefined
```

The `wmic` query runs once per click. It is Windows-only; on macOS/Linux use `ps -o ppid= -p <claudePid>`.

Platform detection via `process.platform` selects the right command.

### Fallback

If `findTerminalForPid` returns `undefined` (session started outside VS Code, terminal already closed), the handler falls back to `SessionPanel.open()` so the click is never a no-op.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Status file exists but Claude Code process is dead | Next statusline write never comes; file stays stale. Cleared on extension restart or manual refresh. A future improvement could check process liveness, but out of scope for TB-02. |
| Multiple sessions pending in same project | Each `SessionNode` decorated independently; badge count reflects total across all projects. |
| Terminal closed but session still running | Focus falls back to session detail panel. |
| `sessions-status/` does not exist yet | Extension skips the watcher gracefully (same `existsSync` guard as `projects/`). |
| `wmic` not available (Win Server Core, etc.) | Catch + fall back to session detail panel. |

---

## Files Changed

| File | Change |
|---|---|
| `templates/claude-sessions/statusline-command.js` | Capture and write `pendingInput` to snapshot |
| `templates/claude-sessions/out/extension.js` | Add `sessions-status/` watcher; switch to `createTreeView` for badge support |
| `templates/claude-sessions/out/SessionsProvider.js` | Load status files; decorate `SessionNode`; set badge; register `focusSession` command |
| `templates/claude-sessions/out/SessionReader.js` | Expose helper to read `sessions/<pid>.json` for the `sessionId → pid` join |

No new dependencies. No `package.json` changes required.
