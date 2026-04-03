import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionsProvider } from "./SessionsProvider";
import { SessionPanel } from "./SessionPanel";
import { Session } from "./SessionReader";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SessionsProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("claudeSessionsTree", provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeSessions.refresh", () => {
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeSessions.openSession",
      (session: Session) => {
        SessionPanel.open(session, context.extensionUri);
      }
    )
  );

  // watch ~/.claude/projects for new sessions
  const watchDir = path.join(os.homedir(), ".claude", "projects");
  if (fs.existsSync(watchDir)) {
    const watcher = fs.watch(watchDir, { recursive: true }, () => {
      provider.refresh();
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  }
}

export function deactivate(): void {}
