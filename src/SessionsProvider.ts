import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  listAllSessions,
  groupSessions,
  readActiveProject,
  loadSessionPidMap,
  Session,
} from "./SessionReader";

interface StatusSnapshot {
  pendingInput?: boolean;
  [key: string]: unknown;
}

function loadStatusMap(): Map<string, StatusSnapshot> {
  const statusDir = path.join(os.homedir(), ".claude", "sessions-status");
  const pidMap = loadSessionPidMap(); // Map<sessionId, pid>
  const pidToSid = new Map<number, string>();
  for (const [sid, pid] of pidMap) pidToSid.set(pid, sid);

  const result = new Map<string, StatusSnapshot>();
  if (!fs.existsSync(statusDir)) return result;
  for (const file of fs.readdirSync(statusDir).filter((f) => f.endsWith(".json"))) {
    const pid = parseInt(file.replace(".json", ""), 10);
    if (isNaN(pid)) continue;
    const sid = pidToSid.get(pid);
    if (!sid) continue;
    try {
      const snap = JSON.parse(fs.readFileSync(path.join(statusDir, file), "utf8"));
      result.set(sid, snap);
    } catch {
      // skip malformed
    }
  }
  return result;
}

export type TreeNode = WorkspaceGroupNode | SessionNode | MessageNode;

class MessageNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
  }
}

export class WorkspaceGroupNode extends vscode.TreeItem {
  constructor(
    public readonly projectName: string,
    sessionCount: number,
    isActive: boolean
  ) {
    super(
      projectName,
      isActive
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.description = String(sessionCount);
    this.contextValue = "workspaceGroup";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

export class SessionNode extends vscode.TreeItem {
  constructor(public readonly session: Session, snapshot?: StatusSnapshot) {
    const date = session.startedAt
      ? new Date(session.startedAt).toLocaleString()
      : "Unknown date";
    const pending = snapshot?.pendingInput === true;

    super(session.firstUserMessage || date, vscode.TreeItemCollapsibleState.None);
    this.description = pending ? `${date} \u00b7 Waiting` : date;
    this.contextValue = pending ? "session-pending" : "session";
    this.iconPath = new vscode.ThemeIcon(pending ? "bell-dot" : "comment-discussion");
    this.tooltip = `${date}\n${session.id}`;
    this.command = {
      command: pending ? "claudeSessions.focusSession" : "claudeSessions.openSession",
      title: pending ? "Focus Session" : "Open Session",
      arguments: [session],
    };
  }
}

export class SessionsProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _groups: WorkspaceGroupNode[] | null = null;
  private _sessionCache: Map<string, SessionNode[]> | null = null;
  private _statusMap: Map<string, StatusSnapshot> | null = null;
  pendingCount = 0;

  refresh(): void {
    this._statusMap = loadStatusMap();
    this.pendingCount = 0;
    for (const [, snap] of this._statusMap) {
      if (snap.pendingInput) this.pendingCount++;
    }
    this._groups = null;
    this._sessionCache = null;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof WorkspaceGroupNode) {
      return this._sessionCache?.get(element.projectName) ?? [];
    }
    if (element) return [];

    const config = vscode.workspace.getConfiguration("claudeSessions");
    const workspaceRoot = config.get<string>("workspaceRoot", "").trim();

    if (!workspaceRoot) {
      return [new MessageNode('Set "claudeSessions.workspaceRoot" in settings to get started')];
    }

    if (!fs.existsSync(workspaceRoot)) {
      return [new MessageNode(`Workspace root not found: ${workspaceRoot}`)];
    }

    if (this._groups !== null) {
      return this._groups;
    }

    const sessions = listAllSessions();
    const projectNames = fs
      .readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const activeProjectFile = config.get<string>("activeProjectFile", "").trim();
    const activeProject = activeProjectFile
      ? readActiveProject(activeProjectFile)
      : null;

    const grouped = groupSessions(sessions, workspaceRoot, projectNames);

    const groups: WorkspaceGroupNode[] = [];
    for (const name of projectNames) {
      const sessionList = grouped.get(name) ?? [];
      if (sessionList.length === 0) continue;
      groups.push(new WorkspaceGroupNode(name, sessionList.length, name === activeProject));
    }

    const other = grouped.get("other") ?? [];
    if (other.length > 0) {
      groups.push(new WorkspaceGroupNode("other", other.length, false));
    }

    const statusMap = this._statusMap ?? new Map<string, StatusSnapshot>();
    this._sessionCache = new Map<string, SessionNode[]>();
    for (const name of [...projectNames, "other"]) {
      const sessionList = grouped.get(name) ?? [];
      this._sessionCache.set(name, sessionList.map((s) => new SessionNode(s, statusMap.get(s.id))));
    }

    this._groups = groups;
    return this._groups;
  }
}
