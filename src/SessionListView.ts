import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  listAllSessions,
  groupSessions,
  loadSessionPidMap,
  computeSessionStats,
  Session,
} from "./SessionReader";

interface StatusSnapshot {
  pendingInput?: boolean;
  [key: string]: unknown;
}

function loadStatusMap(): Map<string, StatusSnapshot> {
  const statusDir = path.join(os.homedir(), ".claude", "sessions-status");
  const pidMap = loadSessionPidMap();
  const pidToSid = new Map<number, string>();
  for (const [sid, pid] of pidMap) pidToSid.set(pid, sid);
  const result = new Map<string, StatusSnapshot>();
  if (!fs.existsSync(statusDir)) return result;
  for (const file of fs
    .readdirSync(statusDir)
    .filter((f) => f.endsWith(".json"))) {
    const pid = parseInt(file.replace(".json", ""), 10);
    if (isNaN(pid)) continue;
    const sid = pidToSid.get(pid);
    if (!sid) continue;
    try {
      const snap = JSON.parse(
        fs.readFileSync(path.join(statusDir, file), "utf8"),
      );
      result.set(sid, snap);
    } catch {
      /* skip */
    }
  }
  return result;
}

export interface SessionRowData {
  id: string;
  project: string;
  title: string;
  startedAt: string;
  projectPath: string;
  memoryPct: number;
  exchangeCount: number;
  pending: boolean;
}

export function projectColor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) + hash + name.charCodeAt(i);
    hash = hash & hash;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 60%)`;
}

export function relativeTime(isoString: string): string {
  if (!isoString) return "";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      color: var(--vscode-descriptionForeground); padding: 16px; }
  </style>
</head>
<body><p>${escHtml(message)}</p></body>
</html>`;
}

export function buildListHtml(
  rows: SessionRowData[],
  allProjectNames: string[],
): string {
  const projects = ["All", ...new Set(rows.map((r) => r.project))];
  const projectOptions = projects
    .map((p) => `<option value="${escHtml(p)}">${escHtml(p)}</option>`)
    .join("");

  const rowsHtml = rows
    .map((r) => {
      const badge = r.project.slice(0, 4).toUpperCase();
      const color = projectColor(r.project);
      const time = relativeTime(r.startedAt);
      const title = r.title.slice(0, 60) || "(empty)";
      const pending = r.pending
        ? '<span class="pending" title="Claude is waiting for your input.">⏳</span>'
        : "";
      const memTip = `Claude is holding ${Math.round(r.memoryPct * 2)}K of 200K words. Near 100%, history starts compressing.`;
      const exchTip = "Number of back-and-forths in this session.";
      return `<div class="row" data-id="${escHtml(r.id)}" data-project="${escHtml(r.project)}" data-pending="${r.pending}">
  <span class="badge" style="background:${color}" title="${escHtml(r.projectPath)}">${escHtml(badge)}</span>
  <span class="title">${escHtml(title)}</span>
  <span class="time">${escHtml(time)}</span>
  <span class="memory" title="${escHtml(memTip)}">Memory ${r.memoryPct}%</span>
  <span class="exchanges" title="${escHtml(exchTip)}">${r.exchangeCount} exchanges</span>
  ${pending}
</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    .filter-bar { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border);
      display: flex; align-items: center; gap: 6px; }
    .filter-bar label { font-size: 0.8em; color: var(--vscode-descriptionForeground); white-space: nowrap; }
    .filter-bar select { flex: 1; background: var(--vscode-input-background);
      color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px; padding: 2px 4px; font-size: 0.85em; }
    .row { display: grid; grid-template-columns: 32px 1fr auto auto auto auto;
      align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer;
      border-bottom: 1px solid var(--vscode-panel-border); }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .badge { display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 18px; border-radius: 3px; font-size: 0.68em;
      font-weight: 700; color: #fff; letter-spacing: 0.02em; flex-shrink: 0; }
    .title { font-size: 0.88em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .time, .memory, .exchanges { font-size: 0.78em; color: var(--vscode-descriptionForeground);
      white-space: nowrap; flex-shrink: 0; }
    .pending { flex-shrink: 0; font-size: 0.9em; }
    .row[data-pending="false"] .pending { display: none; }
    .hidden { display: none !important; }
    .empty { padding: 16px; color: var(--vscode-descriptionForeground); font-size: 0.85em; text-align: center; }
  </style>
</head>
<body>
  <div class="filter-bar">
    <label for="proj-filter">Project</label>
    <select id="proj-filter">${projectOptions}</select>
  </div>
  <div id="list">
${rowsHtml}
  </div>
  <div class="empty" id="empty-msg" style="display:none">No sessions for this project.</div>
  <script>
    const vscode = acquireVsCodeApi();
    const filter = document.getElementById('proj-filter');
    const list = document.getElementById('list');
    const emptyMsg = document.getElementById('empty-msg');

    function applyFilter() {
      const val = filter.value;
      let visible = 0;
      list.querySelectorAll('.row').forEach(row => {
        const match = val === 'All' || row.dataset.project === val;
        row.classList.toggle('hidden', !match);
        if (match) visible++;
      });
      emptyMsg.style.display = visible === 0 ? 'block' : 'none';
    }

    filter.addEventListener('change', applyFilter);

    list.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      const cmd = row.dataset.pending === 'true' ? 'focusSession' : 'openSession';
      vscode.postMessage({ command: cmd, sessionId: row.dataset.id });
    });
  </script>
</body>
</html>`;
}

export class SessionListView implements vscode.WebviewViewProvider {
  static readonly viewType = "claudeSessionsList";

  private _view?: vscode.WebviewView;
  private _sessions: Session[] = [];
  pendingCount = 0;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage(
      (msg: { command: string; sessionId: string }) => {
        const session = this._sessions.find((s) => s.id === msg.sessionId);
        if (!session) return;
        if (msg.command === "openSession") {
          vscode.commands.executeCommand("claudeSessions.openSession", session);
        } else if (msg.command === "focusSession") {
          vscode.commands.executeCommand(
            "claudeSessions.focusSession",
            session,
          );
        }
      },
    );

    this.refresh();
  }

  refresh(): void {
    const config = vscode.workspace.getConfiguration("claudeSessions");
    const workspaceRoot = config.get<string>("workspaceRoot", "").trim();

    const statusMap = loadStatusMap();
    this.pendingCount = 0;
    for (const [, snap] of statusMap) {
      if (snap.pendingInput) this.pendingCount++;
    }

    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      this._sessions = [];
      if (this._view) {
        this._view.webview.html = buildErrorHtml(
          workspaceRoot
            ? `Workspace root not found: ${workspaceRoot}`
            : 'Set "claudeSessions.workspaceRoot" in settings to get started',
        );
        this._view.badge = undefined;
      }
      return;
    }

    const allSessions = listAllSessions();
    const projectNames = fs
      .readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const grouped = groupSessions(allSessions, workspaceRoot, projectNames);

    const rows: SessionRowData[] = [];
    for (const name of [...projectNames, "other"]) {
      for (const s of grouped.get(name) ?? []) {
        const snap = statusMap.get(s.id);
        let memoryPct = 0;
        let exchangeCount = 0;
        try {
          const stats = computeSessionStats(s.filePath);
          memoryPct = Math.min(
            100,
            Math.round((stats.memoryUsed / stats.memoryLimit) * 100),
          );
          exchangeCount = stats.exchangeCount;
        } catch {
          /* skip unreadable files */
        }
        rows.push({
          id: s.id,
          project: name,
          title: s.firstUserMessage,
          startedAt: s.startedAt,
          projectPath: s.projectPath,
          memoryPct,
          exchangeCount,
          pending: snap?.pendingInput === true,
        });
      }
    }

    rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    this._sessions = allSessions;

    if (this._view) {
      this._view.webview.html = buildListHtml(rows, projectNames);
      this._view.badge =
        this.pendingCount > 0
          ? {
              value: this.pendingCount,
              tooltip: `${this.pendingCount} session${this.pendingCount > 1 ? "s" : ""} waiting for input`,
            }
          : undefined;
    }
  }
}
