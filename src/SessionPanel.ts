import * as vscode from "vscode";
import { ChatMessage, ContextUsage, getContextUsage, readSession, Session } from "./SessionReader";

export class SessionPanel {
  static open(session: Session, extensionUri: vscode.Uri): void {
    const panel = vscode.window.createWebviewPanel(
      "claudeSession",
      session.firstUserMessage.slice(0, 40) || "Session",
      vscode.ViewColumn.One,
      { enableScripts: false }
    );

    let messages: ChatMessage[] = [];
    let ctx: ContextUsage | null = null;
    try {
      messages = readSession(session.filePath);
      ctx = getContextUsage(session.filePath);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to read session: ${e}`);
    }

    panel.webview.html = buildHtml(session, messages, ctx);
  }
}

function buildHtml(session: Session, messages: ChatMessage[], ctx: ContextUsage | null): string {
  const date = session.startedAt
    ? new Date(session.startedAt).toLocaleString()
    : "Unknown";

  const messagesHtml = messages
    .map((m) => {
      const role = m.role === "user" ? "You" : "Claude";
      const cls = m.role === "user" ? "user" : "assistant";
      const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "";
      const text = escapeHtml(m.text);
      return `
      <div class="message ${cls}">
        <div class="meta"><span class="role">${role}</span><span class="time">${time}</span></div>
        <div class="body">${text}</div>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Session</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
    }
    .header {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .header h2 {
      font-size: 1.1em;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }
    .header .meta {
      font-size: 0.82em;
      color: var(--vscode-descriptionForeground);
    }
    .message {
      margin-bottom: 20px;
      max-width: 860px;
    }
    .message .meta {
      display: flex;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 4px;
    }
    .message .role {
      font-weight: 600;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .message.user .role { color: var(--vscode-charts-blue); }
    .message.assistant .role { color: var(--vscode-charts-green); }
    .message .time {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
    }
    .message .body {
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      padding: 10px 14px;
      border-radius: 6px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .message.user .body {
      background: var(--vscode-inputOption-activeBackground);
    }
    .ctx-bar-wrap {
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ctx-bar-track {
      flex: 1;
      max-width: 200px;
      height: 4px;
      border-radius: 2px;
      background: var(--vscode-progressBar-background, #333);
      overflow: hidden;
    }
    .ctx-bar-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.2s;
    }
    .ctx-bar-fill.low    { background: var(--vscode-charts-green, #4ec9b0); }
    .ctx-bar-fill.medium { background: var(--vscode-charts-yellow, #cca700); }
    .ctx-bar-fill.high   { background: var(--vscode-charts-red, #f48771); }
    .ctx-label {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      margin-top: 40px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>${escapeHtml(session.firstUserMessage || session.id)}</h2>
    <div class="meta">${escapeHtml(date)} &nbsp;·&nbsp; ${escapeHtml(session.projectPath)} &nbsp;·&nbsp; ${messages.length} messages</div>
    ${ctx ? buildContextBar(ctx) : ""}
  </div>
  ${messagesHtml || '<div class="empty">No messages found in this session.</div>'}
</body>
</html>`;
}

function buildContextBar(ctx: ContextUsage): string {
  const usedK = (ctx.used / 1000).toFixed(0);
  const limitK = (ctx.limit / 1000).toFixed(0);
  const cls = ctx.pct < 50 ? "low" : ctx.pct < 80 ? "medium" : "high";
  const model = ctx.model ? ` &nbsp;·&nbsp; ${escapeHtml(ctx.model)}` : "";
  return `<div class="ctx-bar-wrap">
    <div class="ctx-bar-track"><div class="ctx-bar-fill ${cls}" style="width:${ctx.pct}%"></div></div>
    <span class="ctx-label">${ctx.pct}% &nbsp;·&nbsp; ${usedK}K / ${limitK}K tokens${model}</span>
  </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
