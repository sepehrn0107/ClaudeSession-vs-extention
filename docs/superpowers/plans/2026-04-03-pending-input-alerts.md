# Pending Input Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface live Claude Code sessions waiting for user input via an amber icon, "· Waiting" label, activity bar badge, and click-to-focus in the VS Code Sessions tree panel.

**Architecture:** The statusline command (already receiving Claude Code's live state) is extended to write `pendingInput` into per-session status snapshots on disk. The VS Code extension adds a watcher + polling interval on those snapshot files, joins them to the session list, and decorates the tree accordingly. Clicking a pending session finds and shows its VS Code terminal by walking the process tree.

**Tech Stack:** Node.js (plain JS, no build step), VS Code Extension API (`createTreeView`, `ThemeIcon`, `TreeView.badge`), `fs.watch`, `setInterval`, `child_process.execSync` (wmic on Windows / ps on Unix).

---

## File Map

| File | Role |
|---|---|
| `templates/claude-sessions/statusline-command.js` | Source of truth for status snapshots — add `pendingInput` passthrough |
| `templates/claude-sessions/out/SessionReader.js` | Add `loadSessionPidMap()` — builds `Map<sessionId, pid>` from `~/.claude/sessions/*.json` |
| `templates/claude-sessions/out/SessionsProvider.js` | Add `loadStatusMap()`, `pendingCount`, `SessionNode` decoration, `claudeSessions.focusSession` |
| `templates/claude-sessions/out/extension.js` | Switch to `createTreeView`, add badge update, status watcher, 5 s poll timer |
| `~/.claude/statusline-command.js` | Deployment target for the statusline script (copy from template) |
| `~/.vscode/extensions/sepehrn.claude-sessions-0.1.0/out/` | Deployment target for extension JS files (copy from template/out/) |

---

## Task 1: Write `pendingInput` to status snapshot

**Files:**
- Modify: `templates/claude-sessions/statusline-command.js:76-92`

- [ ] **Step 1: Add `pendingInput` to the snapshot object**

  Open `templates/claude-sessions/statusline-command.js`. After the existing conditional snapshot fields (around line 82), add:

  ```js
  if (data.pendingInput) snapshot.pendingInput = true;
  ```

  The full snapshot block should now read:

  ```js
  const snapshot = {
    pid:       ppid,
    updatedAt: Date.now(),
    cwd,
    model,
  };
  if (usedPct     !== null) snapshot.contextUsedPct     = Math.round(usedPct);
  if (usedTokens  !== null) snapshot.contextUsedTokens  = Math.round(usedTokens);
  if (totalTokens !== null) snapshot.contextTotalTokens = Math.round(totalTokens);
  if (fiveHour    !== null) snapshot.fiveHourUsedPct    = Math.round(fiveHour);
  if (data.pendingInput)    snapshot.pendingInput        = true;
  ```

- [ ] **Step 2: Test — pipe payload with `pendingInput: true` and check the file**

  ```bash
  node templates/claude-sessions/statusline-command.js \
    <<< '{"pendingInput":true,"workspace":{"current_dir":"/tmp"},"model":{"display_name":"test"}}'
  cat ~/.claude/sessions-status/$$.json 2>/dev/null || \
    ls ~/.claude/sessions-status/ | tail -1 | xargs -I{} cat ~/.claude/sessions-status/{}
  ```

  Expected: the JSON file contains `"pendingInput":true`.

  Then verify it is absent when false:

  ```bash
  node templates/claude-sessions/statusline-command.js \
    <<< '{"pendingInput":false,"workspace":{"current_dir":"/tmp"},"model":{"display_name":"test"}}'
  ```

  Expected: the written file does **not** contain `pendingInput`.

- [ ] **Step 3: Commit**

  ```bash
  git -C "$(dirname "$(realpath templates/claude-sessions/statusline-command.js)")" \
    add templates/claude-sessions/statusline-command.js 2>/dev/null || \
  git add templates/claude-sessions/statusline-command.js
  git commit -m "feat(sessions): write pendingInput to status snapshot"
  ```

---

## Task 2: Add `loadSessionPidMap()` to SessionReader

This function reads `~/.claude/sessions/*.json` and returns a `Map<sessionId, pid>` used to join status files to the session tree.

**Files:**
- Modify: `templates/claude-sessions/out/SessionReader.js` (append before the last `//# sourceMappingURL` line)

- [ ] **Step 1: Add the function**

  Append the following to `templates/claude-sessions/out/SessionReader.js` (before the `//# sourceMappingURL` comment at the bottom):

  ```js
  function loadSessionPidMap() {
      const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
      const map = new Map();
      if (!fs.existsSync(sessionsDir)) return map;
      for (const file of fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))) {
          const pid = parseInt(file.replace('.json', ''), 10);
          if (isNaN(pid)) continue;
          try {
              const meta = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
              if (meta.sessionId) map.set(meta.sessionId, pid);
          } catch { /* skip malformed */ }
      }
      return map;
  }
  exports.loadSessionPidMap = loadSessionPidMap;
  ```

- [ ] **Step 2: Verify the function returns data**

  ```bash
  node -e "
    const { loadSessionPidMap } = require('./templates/claude-sessions/out/SessionReader');
    const m = loadSessionPidMap();
    console.log('entries:', m.size);
    for (const [sid, pid] of m) { console.log(sid, '->', pid); break; }
  "
  ```

  Expected: prints `entries: N` (N ≥ 0) and at least one `<uuid> -> <pid>` if any Claude Code sessions have run.

- [ ] **Step 3: Commit**

  ```bash
  git add templates/claude-sessions/out/SessionReader.js
  git commit -m "feat(sessions): add loadSessionPidMap helper to SessionReader"
  ```

---

## Task 3: Build status map and expose `pendingCount` in SessionsProvider

**Files:**
- Modify: `templates/claude-sessions/out/SessionsProvider.js`

- [ ] **Step 1: Add required imports at the top of the file**

  After the existing `const vscode = __importStar(require("vscode"));` and `const SessionReader_1 = require("./SessionReader");` lines, add:

  ```js
  const fs   = require("fs");
  const os   = require("os");
  const path = require("path");
  ```

- [ ] **Step 2: Add `loadStatusMap()` function**

  After the `exports.ProjectNode = ProjectNode;` line (after the `ProjectNode` class), add:

  ```js
  function loadStatusMap() {
      const statusDir = path.join(os.homedir(), '.claude', 'sessions-status');
      const pidMap    = SessionReader_1.loadSessionPidMap();   // Map<sessionId, pid>
      // Invert to Map<pid, sessionId>
      const pidToSid  = new Map();
      for (const [sid, pid] of pidMap) pidToSid.set(pid, sid);

      const result = new Map();   // Map<sessionId, snapshot>
      if (!fs.existsSync(statusDir)) return result;
      for (const file of fs.readdirSync(statusDir).filter(f => f.endsWith('.json'))) {
          const pid = parseInt(file.replace('.json', ''), 10);
          if (isNaN(pid)) continue;
          const sid = pidToSid.get(pid);
          if (!sid) continue;
          try {
              const snap = JSON.parse(fs.readFileSync(path.join(statusDir, file), 'utf8'));
              result.set(sid, snap);
          } catch { /* skip malformed */ }
      }
      return result;
  }
  ```

- [ ] **Step 3: Update `SessionsProvider` class to cache the map and expose `pendingCount`**

  Replace the existing `SessionsProvider` class body with:

  ```js
  class SessionsProvider {
      _onDidChangeTreeData = new vscode.EventEmitter();
      onDidChangeTreeData  = this._onDidChangeTreeData.event;
      pendingCount         = 0;
      _statusMap           = null;

      refresh() {
          this._statusMap = loadStatusMap();
          this.pendingCount = 0;
          for (const [, snap] of this._statusMap) {
              if (snap.pendingInput) this.pendingCount++;
          }
          this._onDidChangeTreeData.fire(undefined);
      }

      getTreeItem(element) {
          return element;
      }

      getChildren(element) {
          const statusMap = this._statusMap ?? new Map();
          if (!element) {
              return (0, SessionReader_1.listProjects)().map((slug) => new ProjectNode(slug));
          }
          if (element instanceof ProjectNode) {
              return (0, SessionReader_1.listSessions)(element.slug).map(
                  (s) => new SessionNode(s, statusMap.get(s.id))
              );
          }
          return [];
      }
  }
  exports.SessionsProvider = SessionsProvider;
  ```

  > Note: `_statusMap` starts as `null`. Extension calls `provider.refresh()` immediately on activate (added in Task 5), which builds the map before any `getChildren()` call.

- [ ] **Step 4: Verify the module loads without errors**

  ```bash
  node -e "require('./templates/claude-sessions/out/SessionsProvider'); console.log('ok')"
  ```

  Expected: `ok` with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add templates/claude-sessions/out/SessionsProvider.js
  git commit -m "feat(sessions): add loadStatusMap and pendingCount to SessionsProvider"
  ```

---

## Task 4: Decorate `SessionNode` for pending state

**Files:**
- Modify: `templates/claude-sessions/out/SessionsProvider.js` (SessionNode class)

- [ ] **Step 1: Replace the `SessionNode` constructor**

  Find the existing `SessionNode` class and replace it entirely with:

  ```js
  class SessionNode extends vscode.TreeItem {
      session;
      constructor(session, snapshot) {
          const date    = session.startedAt
              ? new Date(session.startedAt).toLocaleString()
              : "Unknown date";
          const pending = snapshot?.pendingInput === true;
          super(session.firstUserMessage || date, vscode.TreeItemCollapsibleState.None);
          this.session      = session;
          this.description  = pending ? `${date} \u00b7 Waiting` : date;
          this.contextValue = pending ? "session-pending" : "session";
          this.iconPath     = new vscode.ThemeIcon(pending ? "bell-dot" : "comment-discussion");
          this.tooltip      = `${date}\n${session.id}`;
          this.command      = {
              command:   pending ? "claudeSessions.focusSession" : "claudeSessions.openSession",
              title:     pending ? "Focus Session" : "Open Session",
              arguments: [session],
          };
      }
  }
  exports.SessionNode = SessionNode;
  ```

  (`\u00b7` is the middle dot `·` — safe in all JS string contexts.)

- [ ] **Step 2: Verify the module still loads**

  ```bash
  node -e "require('./templates/claude-sessions/out/SessionsProvider'); console.log('ok')"
  ```

  Expected: `ok`.

- [ ] **Step 3: Commit**

  ```bash
  git add templates/claude-sessions/out/SessionsProvider.js
  git commit -m "feat(sessions): decorate pending SessionNode with bell-dot icon and Waiting label"
  ```

---

## Task 5: Switch to `createTreeView`, add badge, watcher, and poll timer

**Files:**
- Modify: `templates/claude-sessions/out/extension.js`

- [ ] **Step 1: Replace the entire `activate` function**

  Replace everything inside `function activate(context) { ... }` with:

  ```js
  function activate(context) {
      const provider = new SessionsProvider_1.SessionsProvider();

      // createTreeView (replaces registerTreeDataProvider) gives us the badge API
      const treeView = vscode.window.createTreeView("claudeSessionsTree", {
          treeDataProvider: provider,
      });
      context.subscriptions.push(treeView);

      // Update activity bar badge whenever the tree data changes
      provider.onDidChangeTreeData(() => {
          const count = provider.pendingCount;
          treeView.badge = count > 0
              ? { value: count, tooltip: `${count} session${count > 1 ? 's' : ''} waiting for input` }
              : undefined;
      });

      context.subscriptions.push(vscode.commands.registerCommand("claudeSessions.refresh", () => {
          provider.refresh();
      }));

      context.subscriptions.push(vscode.commands.registerCommand("claudeSessions.openSession", (session) => {
          SessionPanel_1.SessionPanel.open(session, context.extensionUri);
      }));

      // Watch ~/.claude/projects for new sessions (existing)
      const watchDir = path.join(os.homedir(), ".claude", "projects");
      if (fs.existsSync(watchDir)) {
          const watcher = fs.watch(watchDir, { recursive: true }, () => provider.refresh());
          context.subscriptions.push({ dispose: () => watcher.close() });
      }

      // Watch ~/.claude/sessions-status for live pendingInput changes
      const statusDir = path.join(os.homedir(), ".claude", "sessions-status");
      if (fs.existsSync(statusDir)) {
          const statusWatcher = fs.watch(statusDir, () => provider.refresh());
          context.subscriptions.push({ dispose: () => statusWatcher.close() });
      }

      // Poll every 5 s as a fallback (fs.watch misses rapid consecutive writes on Windows)
      const pollTimer = setInterval(() => provider.refresh(), 5000);
      context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });

      // Initial load — builds status map and fires onDidChangeTreeData → sets badge
      provider.refresh();
  }
  ```

  > `claudeSessions.focusSession` is registered in Task 6 below — it is added to this same `activate` function.

- [ ] **Step 2: Verify the module loads**

  ```bash
  node -e "
    // Stub vscode so we can require the module outside VS Code
    require.cache[require.resolve('vscode')] = {
      id: 'vscode', filename: 'vscode', loaded: true,
      exports: {
        window: { createTreeView: () => ({ badge: undefined, dispose: () => {} }), registerTreeDataProvider: () => {} },
        commands: { registerCommand: () => {} },
        EventEmitter: class { event = () => {}; fire() {} },
        TreeItem: class { constructor(l,s){} },
        TreeItemCollapsibleState: { Collapsed: 1, None: 0 },
        ThemeIcon: class { constructor(id){ this.id=id; } },
      }
    };
    require('./templates/claude-sessions/out/extension');
    console.log('ok');
  "
  ```

  Expected: `ok` (or a require error on a missing sibling — acceptable at this stage since SessionsProvider is real).

- [ ] **Step 3: Commit**

  ```bash
  git add templates/claude-sessions/out/extension.js
  git commit -m "feat(sessions): createTreeView + badge + sessions-status watcher + 5s poll"
  ```

---

## Task 6: Add `claudeSessions.focusSession` command

**Files:**
- Modify: `templates/claude-sessions/out/extension.js` (inside `activate`, after the `openSession` registration)

- [ ] **Step 1: Add `findTerminalForPid` helper and register the command**

  Inside `activate`, after the `claudeSessions.openSession` registration block, add:

  ```js
  context.subscriptions.push(vscode.commands.registerCommand("claudeSessions.focusSession", async (session) => {
      const pidMap   = (0, SessionReader_1.loadSessionPidMap)();
      const claudePid = pidMap.get(session.id);
      if (claudePid) {
          const terminal = await findTerminalForPid(claudePid);
          if (terminal) {
              terminal.show();
              return;
          }
      }
      // Fallback: open the session detail panel
      SessionPanel_1.SessionPanel.open(session, context.extensionUri);
  }));
  ```

- [ ] **Step 2: Add `findTerminalForPid` as a module-level function**

  Add this function **outside** `activate`, before the `activate` function definition (after the `require` statements at the top):

  ```js
  async function findTerminalForPid(claudePid) {
      let shellPid;
      try {
          const { execSync } = require("child_process");
          if (process.platform === "win32") {
              const out = execSync(
                  `wmic process where (ProcessId=${claudePid}) get ParentProcessId /format:value`,
                  { timeout: 3000, stdio: ["pipe", "pipe", "ignore"] }
              ).toString();
              const match = out.match(/ParentProcessId=(\d+)/);
              if (!match) return undefined;
              shellPid = parseInt(match[1], 10);
          } else {
              const out = execSync(`ps -o ppid= -p ${claudePid}`, {
                  timeout: 3000,
                  stdio: ["pipe", "pipe", "ignore"],
              }).toString().trim();
              shellPid = parseInt(out, 10);
          }
      } catch {
          return undefined;
      }
      if (!shellPid || isNaN(shellPid)) return undefined;
      for (const terminal of vscode.window.terminals) {
          const termPid = await terminal.processId;
          if (termPid === shellPid) return terminal;
      }
      return undefined;
  }
  ```

  Also add `const SessionReader_1 = require("./SessionReader");` to the imports at the top of `extension.js` if it is not already present.

- [ ] **Step 3: Verify `extension.js` loads without syntax errors**

  ```bash
  node --check templates/claude-sessions/out/extension.js && echo "syntax ok"
  ```

  Expected: `syntax ok`.

- [ ] **Step 4: Commit**

  ```bash
  git add templates/claude-sessions/out/extension.js
  git commit -m "feat(sessions): add focusSession command with terminal PID matching and fallback"
  ```

---

## Task 7: Deploy to installed locations and smoke-test

**Files:**
- Copy: `templates/claude-sessions/statusline-command.js` → `~/.claude/statusline-command.js`
- Copy: `templates/claude-sessions/out/*.js` → `~/.vscode/extensions/sepehrn.claude-sessions-0.1.0/out/`

- [ ] **Step 1: Deploy statusline command**

  ```bash
  cp templates/claude-sessions/statusline-command.js ~/.claude/statusline-command.js
  ```

- [ ] **Step 2: Deploy extension JS files**

  ```bash
  cp templates/claude-sessions/out/extension.js \
     templates/claude-sessions/out/SessionsProvider.js \
     templates/claude-sessions/out/SessionReader.js \
     templates/claude-sessions/out/SessionPanel.js \
     ~/.vscode/extensions/sepehrn.claude-sessions-0.1.0/out/
  ```

- [ ] **Step 3: Reload the extension in VS Code**

  Open the Command Palette (`Ctrl+Shift+P`) and run:
  ```
  Developer: Restart Extension Host
  ```

- [ ] **Step 4: Smoke-test badge and decoration**

  Open a second VS Code window and start a Claude Code session that asks a question (triggering `pendingInput: true`). In the first window:
  - The Claude Sessions activity bar icon should show a numeric badge (e.g. `1`)
  - The pending session node should have the `bell-dot` icon and a `· Waiting` description suffix
  - Clicking the pending session should bring the Claude Code terminal to focus
  - Once you answer in the Claude session, the badge and icon should clear within ~5 s (next poll)

- [ ] **Step 5: Final commit**

  ```bash
  git add templates/claude-sessions/out/extension.js \
          templates/claude-sessions/out/SessionsProvider.js \
          templates/claude-sessions/out/SessionReader.js \
          templates/claude-sessions/statusline-command.js
  git commit -m "chore: deploy TB-02 pending-input alerts to installed extension"
  ```
