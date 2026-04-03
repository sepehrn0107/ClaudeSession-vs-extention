import * as vscode from "vscode";
import * as fs from "fs";
import {
  listAllSessions,
  groupSessions,
  loadStatusMap,
  Session,
} from "./SessionReader";

export interface FlatTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  sessionId: string;
  project: string;
}

export interface ProjectTodoGroup {
  project: string;
  todos: FlatTodo[];
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTodosHtml(groups: ProjectTodoGroup[]): string {
  if (groups.length === 0) {
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
<body><p>No active todos.</p></body>
</html>`;
  }

  const STATUS_ICON: Record<FlatTodo["status"], string> = {
    in_progress: "●",
    pending: "○",
    completed: "✓",
  };

  const groupsHtml = groups
    .map((g) => {
      const todosHtml = g.todos
        .map(
          (t) =>
            `<div class="todo-row status-${t.status}" data-session-id="${escHtml(t.sessionId)}" data-status="${t.status}">
  <span class="icon">${STATUS_ICON[t.status]}</span>
  <span class="content">${escHtml(t.content)}</span>
</div>`,
        )
        .join("\n");
      return `<div class="project-group" data-project="${escHtml(g.project)}">
  <div class="project-header"><span class="chevron">▾</span>${escHtml(g.project)}</div>
  <div class="todos">${todosHtml}</div>
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
    .project-header { display: flex; align-items: center; gap: 4px;
      padding: 4px 8px; font-size: 0.75em; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-top: 4px; user-select: none; }
    .project-header:hover { color: var(--vscode-foreground); }
    .chevron { font-size: 0.9em; transition: transform 0.15s; display: inline-block; }
    .project-group.collapsed .chevron { transform: rotate(-90deg); }
    .project-group.collapsed .todos { display: none; }
    .todo-row { display: grid; grid-template-columns: 14px 1fr; align-items: center;
      gap: 6px; padding: 5px 8px 5px 10px; cursor: pointer;
      border-bottom: 1px solid var(--vscode-panel-border); }
    .todo-row:hover { background: var(--vscode-list-hoverBackground); }
    .todo-row.status-in_progress { border-left: 2px solid var(--vscode-notificationsInfoIcon-foreground, #75beff); }
    .todo-row.status-completed { opacity: 0.45; }
    .icon { font-size: 0.72em; color: var(--vscode-descriptionForeground); }
    .content { font-size: 0.88em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
${groupsHtml}
  <script>
    const vscode = acquireVsCodeApi();
    const state = vscode.getState() || {};
    const collapsed = new Set(state.collapsed || []);

    document.querySelectorAll('.project-group').forEach(g => {
      if (collapsed.has(g.dataset.project)) g.classList.add('collapsed');
    });

    function saveState() {
      const now = [];
      document.querySelectorAll('.project-group.collapsed').forEach(g => now.push(g.dataset.project));
      vscode.setState({ collapsed: now });
    }

    document.body.addEventListener('click', (e) => {
      const header = e.target.closest('.project-header');
      if (header) {
        header.closest('.project-group').classList.toggle('collapsed');
        saveState();
        return;
      }
      const row = e.target.closest('.todo-row');
      if (row) vscode.postMessage({ command: 'focusSession', sessionId: row.dataset.sessionId });
    });
  </script>
</body>
</html>`;
}

export class TodosView implements vscode.WebviewViewProvider {
  static readonly viewType = "claudeTodosList";

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage(
      (msg: { command: string; sessionId: string }) => {
        if (msg.command === "focusSession") {
          vscode.commands.executeCommand(
            "claudeSessions.focusSession",
            { id: msg.sessionId } as Session,
          );
        }
      },
    );

    this.refresh();
  }

  refresh(): void {
    if (!this._view) return;
    const config = vscode.workspace.getConfiguration("claudeSessions");
    const workspaceRoot = config.get<string>("workspaceRoot", "").trim();

    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      this._view.webview.html = this._buildErrorHtml(
        workspaceRoot
          ? `Workspace root not found: ${workspaceRoot}`
          : 'Set "claudeSessions.workspaceRoot" in settings to get started',
      );
      return;
    }

    const statusMap = loadStatusMap();
    const allSessions = listAllSessions();
    const projectNames = fs
      .readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    // Build sessionId → project lookup
    const grouped = groupSessions(allSessions, workspaceRoot, projectNames);
    const sidToProject = new Map<string, string>();
    for (const [proj, sessions] of grouped) {
      for (const s of sessions) sidToProject.set(s.id, proj);
    }

    // Flatten todos from all status snapshots
    const projectTodos = new Map<string, FlatTodo[]>();
    for (const [sid, snap] of statusMap) {
      if (!snap.todos?.length) continue;
      const project = sidToProject.get(sid) ?? "other";
      for (const todo of snap.todos) {
        if (!projectTodos.has(project)) projectTodos.set(project, []);
        projectTodos.get(project)!.push({
          content: todo.content,
          status: todo.status,
          sessionId: sid,
          project,
        });
      }
    }

    // Sort within each group: in_progress → pending → completed
    const statusOrder: Record<FlatTodo["status"], number> = {
      in_progress: 0,
      pending: 1,
      completed: 2,
    };
    const groups: ProjectTodoGroup[] = [];
    for (const name of [...projectNames, "other"]) {
      const todos = projectTodos.get(name);
      if (!todos?.length) continue;
      todos.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
      groups.push({ project: name, todos });
    }

    this._view.webview.html = buildTodosHtml(groups);
  }

  private _buildErrorHtml(message: string): string {
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
}
