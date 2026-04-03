import * as vscode from "vscode";
import * as path from "path";
import { listProjects, listSessions, Session, slugToPath } from "./SessionReader";

export type TreeNode = ProjectNode | SessionNode;

export class ProjectNode extends vscode.TreeItem {
  constructor(public readonly slug: string) {
    const label = slugToPath(slug);
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "project";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = label;
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

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return listProjects().map((slug) => new ProjectNode(slug));
    }
    if (element instanceof ProjectNode) {
      return listSessions(element.slug).map((s) => new SessionNode(s));
    }
    return [];
  }
}
