import * as vscode from "vscode";
import * as fs from "fs";
import {
  listAllSessions,
  groupSessions,
  readActiveProject,
  Session,
} from "./SessionReader";

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
  constructor(public readonly session: Session) {
    const date = session.startedAt
      ? new Date(session.startedAt).toLocaleString()
      : "Unknown date";

    super(session.firstUserMessage || date, vscode.TreeItemCollapsibleState.None);
    this.description = date;
    this.contextValue = "session";
    this.iconPath = new vscode.ThemeIcon("comment-discussion");
    this.tooltip = `${date}\n${session.id}`;
    this.command = {
      command: "claudeSessions.openSession",
      title: "Open Session",
      arguments: [session],
    };
  }
}

export class SessionsProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _groups: WorkspaceGroupNode[] | null = null;
  private _sessionCache: Map<string, SessionNode[]> | null = null;

  refresh(): void {
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

    this._sessionCache = new Map<string, SessionNode[]>();
    for (const name of [...projectNames, "other"]) {
      const sessionList = grouped.get(name) ?? [];
      this._sessionCache.set(name, sessionList.map((s) => new SessionNode(s)));
    }

    this._groups = groups;
    return this._groups;
  }
}
