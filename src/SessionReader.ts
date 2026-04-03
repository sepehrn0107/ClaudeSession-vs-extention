import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface Session {
  id: string;
  projectSlug: string;
  projectPath: string;
  filePath: string;
  startedAt: string;
  firstUserMessage: string;
  cwd?: string;
}

export interface ParsedSession {
  startedAt: string;
  firstUserMessage: string;
  cwd?: string;
}

const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");

export function listProjects(): string[] {
  if (!fs.existsSync(CLAUDE_DIR)) return [];
  return fs
    .readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function slugToPath(slug: string): string {
  if (/^[a-z]-/i.test(slug)) {
    // Windows: 'c--Users-sepeh-Documents-workspace' → 'C:\Users\sepeh\Documents\workspace'
    // Replace '--' before '-' to avoid double backslash from the initial '--'
    return slug[0].toUpperCase() + ":" + slug.slice(1).replace(/--/g, "\\").replace(/-/g, "\\");
  }
  // Linux/Mac: '-home-user-workspace' → '/home/user/workspace'
  return slug.replace(/-/g, "/");
}

export function parseSessionLines(lines: string[]): ParsedSession {
  let startedAt = "";
  let firstUserMessage = "(empty)";
  let cwd: string | undefined;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!startedAt && obj.timestamp) {
        startedAt = obj.timestamp;
      }
      if (!cwd && obj.cwd) {
        cwd = obj.cwd;
      }
      if (
        obj.type === "user" &&
        obj.message?.content?.[0]?.text &&
        firstUserMessage === "(empty)"
      ) {
        firstUserMessage = obj.message.content[0].text.slice(0, 80).trim();
      }
    } catch {
      // skip malformed lines
    }
  }

  return { startedAt, firstUserMessage, cwd };
}

export function listSessions(projectSlug: string): Session[] {
  const dir = path.join(CLAUDE_DIR, projectSlug);
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && !f.startsWith("."));

  const sessions: Session[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const id = file.replace(".jsonl", "");
    const { startedAt, firstUserMessage, cwd } = parseSessionLines(readLines(filePath, 20));

    sessions.push({
      id,
      projectSlug,
      projectPath: slugToPath(projectSlug),
      filePath,
      startedAt,
      firstUserMessage,
      cwd,
    });
  }

  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function readSession(filePath: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user" && obj.message?.content) {
        const text = extractText(obj.message.content);
        if (text) {
          messages.push({ role: "user", text, timestamp: obj.timestamp ?? "" });
        }
      } else if (obj.type === "assistant" && obj.message?.content) {
        const text = extractText(obj.message.content);
        if (text) {
          messages.push({ role: "assistant", text, timestamp: obj.timestamp ?? "" });
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  return messages;
}

function readLines(filePath: string, maxLines: number): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  return content.split("\n").slice(0, maxLines);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text: string } => c?.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}
