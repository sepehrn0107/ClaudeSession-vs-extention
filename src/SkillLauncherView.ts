import * as vscode from "vscode";
import { listSkills, SkillEntry } from "./SkillReader";

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSkillsHtml(skills: SkillEntry[]): string {
  const rowsHtml = skills
    .map(
      (
        s,
      ) => `<div class="row" data-trigger="${escHtml(s.trigger)}" data-name="${escHtml(s.name)}" data-desc="${escHtml(s.description)}">
  <span class="trigger">${escHtml(s.trigger)}</span>
  <span class="desc">${escHtml(s.description)}</span>
</div>`,
    )
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
    .filter-bar { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .filter-bar input { width: 100%; background: var(--vscode-input-background);
      color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px; padding: 3px 6px; font-size: 0.85em; }
    .filter-bar input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .row { padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .trigger { display: block; font-size: 0.88em; font-weight: 600; font-family: var(--vscode-editor-font-family, monospace); }
    .desc { display: block; font-size: 0.78em; color: var(--vscode-descriptionForeground);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hidden { display: none !important; }
    .empty { padding: 16px; color: var(--vscode-descriptionForeground); font-size: 0.85em; text-align: center; }
  </style>
</head>
<body>
  <div class="filter-bar">
    <input id="filter" type="text" placeholder="Filter skills…" aria-label="Filter skills">
  </div>
  <div id="list">
${rowsHtml}
  </div>
  <div class="empty" id="empty-msg" style="display:none">No skills match.</div>
  <script>
    const vscode = acquireVsCodeApi();
    const filterInput = document.getElementById('filter');
    const list = document.getElementById('list');
    const emptyMsg = document.getElementById('empty-msg');

    function applyFilter() {
      const q = filterInput.value.toLowerCase();
      let visible = 0;
      list.querySelectorAll('.row').forEach(row => {
        const match = !q || row.dataset.name.includes(q) || row.dataset.desc.toLowerCase().includes(q);
        row.classList.toggle('hidden', !match);
        if (match) visible++;
      });
      emptyMsg.style.display = visible === 0 ? 'block' : 'none';
    }

    filterInput.addEventListener('input', applyFilter);

    list.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      vscode.postMessage({ command: 'copyTrigger', trigger: row.dataset.trigger });
    });
  </script>
</body>
</html>`;
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

export class SkillLauncherView implements vscode.WebviewViewProvider {
  static readonly viewType = "claudeSkillsList";

  private _view?: vscode.WebviewView;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage(
      (msg: { command: string; trigger: string }) => {
        if (msg.command === "copyTrigger") {
          vscode.env.clipboard.writeText(msg.trigger);
          vscode.window.showInformationMessage(`Copied: ${msg.trigger}`);
        }
      },
    );

    this.refresh();
  }

  refresh(): void {
    if (!this._view) return;

    const config = vscode.workspace.getConfiguration("claudeSessions");
    const skillsPath = config.get<string>("toolboxSkillsPath", "").trim();

    if (!skillsPath) {
      this._view.webview.html = buildErrorHtml(
        'Set "claudeSessions.toolboxSkillsPath" in settings to load skills.',
      );
      return;
    }

    const skills = listSkills(skillsPath);

    if (skills.length === 0) {
      this._view.webview.html = buildErrorHtml(
        skillsPath
          ? `No skill files found in: ${skillsPath}`
          : 'Set "claudeSessions.toolboxSkillsPath" in settings to load skills.',
      );
      return;
    }

    this._view.webview.html = buildSkillsHtml(skills);
  }
}
