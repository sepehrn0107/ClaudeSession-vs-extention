import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { SessionListView } from "./SessionListView";
import { SessionPanel } from "./SessionPanel";
import { Session, loadSessionPidMap } from "./SessionReader";
import { TodosView } from "./TodosView";
import { SkillLauncherView } from "./SkillLauncherView";

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

async function findTerminalForPid(
  claudePid: number,
): Promise<vscode.Terminal | undefined> {
  let shellPid: number | undefined;
  try {
    if (process.platform === "win32") {
      const out = execSync(
        `wmic process where (ProcessId=${claudePid}) get ParentProcessId /format:value`,
        { timeout: 3000, stdio: ["pipe", "pipe", "ignore"] },
      ).toString();
      const match = out.match(/ParentProcessId=(\d+)/);
      if (!match) return undefined;
      shellPid = parseInt(match[1], 10);
    } else {
      const out = execSync(`ps -o ppid= -p ${claudePid}`, {
        timeout: 3000,
        stdio: ["pipe", "pipe", "ignore"],
      })
        .toString()
        .trim();
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

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SessionListView(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SessionListView.viewType,
      provider,
    ),
  );

  const todosProvider = new TodosView(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TodosView.viewType, todosProvider),
  );

  const skillsProvider = new SkillLauncherView();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SkillLauncherView.viewType,
      skillsProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeSessions.refresh", () => {
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeSessions.openSession",
      (session: Session) => {
        SessionPanel.open(session, context.extensionUri);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeSessions.focusSession",
      async (session: Session) => {
        const pidMap = loadSessionPidMap();
        const claudePid = pidMap.get(session.id);
        if (claudePid) {
          const terminal = await findTerminalForPid(claudePid);
          if (terminal) {
            terminal.show();
            return;
          }
        }
        SessionPanel.open(session, context.extensionUri);
      },
    ),
  );

  const debouncedRefresh = debounce(() => {
    provider.refresh();
    todosProvider.refresh();
    skillsProvider.refresh();
  }, 300);

  const watchDir = path.join(os.homedir(), ".claude", "projects");
  if (fs.existsSync(watchDir)) {
    const watcher = fs.watch(watchDir, debouncedRefresh);
    context.subscriptions.push({ dispose: () => watcher.close() });
  }

  // Watch ~/.claude/sessions-status for live status changes.
  // Fall back to watching the parent dir so we catch the first write if the
  // sessions-status directory doesn't exist yet when the extension activates.
  const statusDir = path.join(os.homedir(), ".claude", "sessions-status");
  const statusWatchTarget = fs.existsSync(statusDir)
    ? statusDir
    : path.join(os.homedir(), ".claude");
  const statusWatcher = fs.watch(statusWatchTarget, debouncedRefresh);
  context.subscriptions.push({ dispose: () => statusWatcher.close() });

  // Watch toolbox skills directory and refresh panel when files change.
  const skillsConfig = vscode.workspace.getConfiguration("claudeSessions");
  const skillsDir = skillsConfig.get<string>("toolboxSkillsPath", "").trim();
  if (skillsDir && fs.existsSync(skillsDir)) {
    const skillsWatcher = fs.watch(skillsDir, debouncedRefresh);
    context.subscriptions.push({ dispose: () => skillsWatcher.close() });
  }

  // Poll every 5 s as fallback (fs.watch misses rapid consecutive writes on Windows)
  const pollTimer = setInterval(() => {
    provider.refresh();
    todosProvider.refresh();
    skillsProvider.refresh();
  }, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
}

export function deactivate(): void {}
