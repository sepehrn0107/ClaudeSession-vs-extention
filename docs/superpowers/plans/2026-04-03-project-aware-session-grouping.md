# Project-Aware Session Grouping (TB-01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group sessions in the Claude Sessions VSCode sidebar by workspace project, discovered by scanning subdirectories of a configurable workspace root path.

**Architecture:** Sessions are loaded eagerly on first render — all JSONL files are scanned for `cwd`, matched against workspace root subdirectories, and cached in memory until refresh. `WorkspaceGroupNode` replaces `ProjectNode` as the top-level tree node. Pure data functions (`parseSessionLines`, `slugToPath`, `groupSessions`, `readActiveProject`) live in `SessionReader.ts` and are unit-tested with vitest; VS Code tree behaviour is manually tested.

**Tech Stack:** TypeScript 5.3, VS Code Extension API (TreeDataProvider), Node.js `fs`/`path`, vitest 2.x

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/SessionReader.ts` | Add `cwd` to `Session`, extract `parseSessionLines`, fix `slugToPath`, add `listAllSessions` / `groupSessions` / `readActiveProject` |
| Modify | `src/SessionsProvider.ts` | Replace `ProjectNode` → `WorkspaceGroupNode`, add `MessageNode`, add cache, new `getChildren` logic |
| Modify | `package.json` | Add vitest devDep + test script + VS Code configuration contribution |
| Create | `vitest.config.ts` | Point vitest at `src/test/**/*.test.ts` |
| Create | `src/test/SessionReader.test.ts` | Unit tests for all pure functions |

---

## Task 1: Set up vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test/SessionReader.test.ts` (skeleton only)

- [ ] **Step 1: Install vitest**

```bash
cd C:/Users/sepeh/Documents/workspace/claude-sessions
npm install -D vitest@^2.0.0
```

- [ ] **Step 2: Add test script and devDependency to `package.json`**

In the `"scripts"` block add `"test": "vitest run"`. Final scripts section:

```json
"scripts": {
  "vscode:prepublish": "npm run compile",
  "compile": "tsc -p ./",
  "watch": "tsc -watch -p ./",
  "test": "vitest run"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `src/test/SessionReader.test.ts` with a smoke test**

```ts
import { describe, it, expect } from 'vitest';

describe('test setup', () => {
  it('vitest is working', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run tests and verify pass**

```bash
npm test
```

Expected output: `1 passed`

- [ ] **Step 6: Commit**

```bash
git init  # if not already a repo
git add vitest.config.ts src/test/SessionReader.test.ts package.json package-lock.json
git commit -m "chore: add vitest test infrastructure"
```

---

## Task 2: Extract `parseSessionLines` and add `cwd` to `Session`

**Files:**
- Modify: `src/SessionReader.ts`
- Modify: `src/test/SessionReader.test.ts`

- [ ] **Step 1: Write failing tests for `parseSessionLines`**

Replace the contents of `src/test/SessionReader.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { parseSessionLines } from '../SessionReader';

describe('parseSessionLines', () => {
  it('extracts startedAt from first timestamp', () => {
    const lines = [JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z' })];
    expect(parseSessionLines(lines).startedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('extracts cwd from user entry', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        cwd: 'C:\\Users\\test\\workspace\\toolbox',
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(parseSessionLines(lines).cwd).toBe('C:\\Users\\test\\workspace\\toolbox');
  });

  it('extracts firstUserMessage truncated to 80 chars', () => {
    const long = 'a'.repeat(100);
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: long }] },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(parseSessionLines(lines).firstUserMessage).toBe('a'.repeat(80));
  });

  it('returns undefined cwd when absent', () => {
    const lines = [JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z' })];
    expect(parseSessionLines(lines).cwd).toBeUndefined();
  });

  it('skips malformed lines without throwing', () => {
    const lines = ['not json', JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z' })];
    expect(parseSessionLines(lines).startedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: `5 failed` (parseSessionLines not exported yet)

- [ ] **Step 3: Update `src/SessionReader.ts`**

Replace the entire file with:

```ts
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
  return slug.replace(/^[a-z]--/, (m) => m[0].toUpperCase() + ":\\").replace(/--/g, "\\");
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add src/SessionReader.ts src/test/SessionReader.test.ts
git commit -m "feat: extract parseSessionLines and add cwd to Session"
```

---

## Task 3: Fix `slugToPath` for cross-platform

**Files:**
- Modify: `src/SessionReader.ts` (update `slugToPath` only)
- Modify: `src/test/SessionReader.test.ts` (add tests)

- [ ] **Step 1: Add failing tests for `slugToPath`**

Append to `src/test/SessionReader.test.ts`:

```ts
import { slugToPath } from '../SessionReader';

describe('slugToPath', () => {
  it('decodes Windows slug to Windows path', () => {
    expect(slugToPath('c--Users-sepeh-Documents-workspace'))
      .toBe('C:\\Users\\sepeh\\Documents\\workspace');
  });

  it('decodes nested Windows slug', () => {
    expect(slugToPath('c--Users-sepeh-Documents-workspace--toolbox'))
      .toBe('C:\\Users\\sepeh\\Documents\\workspace\\toolbox');
  });

  it('decodes Linux/Mac slug to Unix path', () => {
    expect(slugToPath('-home-user-workspace'))
      .toBe('/home/user/workspace');
  });
});
```

- [ ] **Step 2: Run tests to verify the Windows cases fail**

```bash
npm test
```

Expected: `2 failed` (Windows slug tests produce wrong results with current implementation), `1 passed` or failing depending on platform.

- [ ] **Step 3: Replace `slugToPath` in `src/SessionReader.ts`**

Find and replace the `slugToPath` function body:

```ts
export function slugToPath(slug: string): string {
  if (/^[a-z]-/i.test(slug)) {
    // Windows slug: first char is drive letter; both ':' and '\' are encoded as '-'
    // 'c--Users-sepeh-Documents-workspace' → 'C:\Users\sepeh\Documents\workspace'
    return slug[0].toUpperCase() + ":" + slug.slice(1).replace(/-/g, "\\");
  }
  // Linux/Mac slug: leading '/' encoded as '-', each '/' encoded as '-'
  // '-home-user-workspace' → '/home/user/workspace'
  return slug.replace(/-/g, "/");
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npm test
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add src/SessionReader.ts src/test/SessionReader.test.ts
git commit -m "fix: slugToPath cross-platform support for Linux/Mac"
```

---

## Task 4: Add `listAllSessions`, `groupSessions`, and `readActiveProject`

**Files:**
- Modify: `src/SessionReader.ts`
- Modify: `src/test/SessionReader.test.ts`

- [ ] **Step 1: Add failing tests for `groupSessions` and `readActiveProject`**

Append to `src/test/SessionReader.test.ts`:

```ts
import { groupSessions, readActiveProject, Session } from '../SessionReader';
import * as path from 'path';
import * as os from 'os';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';

const ROOT = process.platform === 'win32'
  ? 'C:\\Users\\test\\workspace'
  : '/home/user/workspace';

const makeSession = (cwd: string | undefined): Session => ({
  id: '123',
  projectSlug: 'test',
  projectPath: 'test',
  filePath: 'test.jsonl',
  startedAt: '',
  firstUserMessage: '',
  cwd,
});

describe('groupSessions', () => {
  it('assigns session whose cwd equals project root', () => {
    const map = groupSessions([makeSession(path.join(ROOT, 'toolbox'))], ROOT, ['toolbox']);
    expect(map.get('toolbox')!.length).toBe(1);
    expect(map.get('other')!.length).toBe(0);
  });

  it('assigns session in subdirectory to matching project', () => {
    const map = groupSessions([makeSession(path.join(ROOT, 'toolbox', 'src'))], ROOT, ['toolbox']);
    expect(map.get('toolbox')!.length).toBe(1);
  });

  it('does not match foobar session to foo project', () => {
    const map = groupSessions([makeSession(path.join(ROOT, 'foobar'))], ROOT, ['foo', 'foobar']);
    expect(map.get('foo')!.length).toBe(0);
    expect(map.get('foobar')!.length).toBe(1);
  });

  it('assigns session with unmatched cwd to "other"', () => {
    const unmatched = process.platform === 'win32' ? 'C:\\other\\path' : '/other/path';
    const map = groupSessions([makeSession(unmatched)], ROOT, ['toolbox']);
    expect(map.get('other')!.length).toBe(1);
    expect(map.get('toolbox')!.length).toBe(0);
  });

  it('assigns session with undefined cwd to "other"', () => {
    const map = groupSessions([makeSession(undefined)], ROOT, ['toolbox']);
    expect(map.get('other')!.length).toBe(1);
  });

  it('always initialises all project buckets in the map', () => {
    const map = groupSessions([], ROOT, ['toolbox', 'gymbro']);
    expect(map.has('toolbox')).toBe(true);
    expect(map.has('gymbro')).toBe(true);
    expect(map.has('other')).toBe(true);
  });
});

describe('readActiveProject', () => {
  it('reads active project name from file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-sessions-test-'));
    const file = path.join(dir, 'active.md');
    writeFileSync(file, 'active: toolbox\nupdated: 2026-01-01\n');
    expect(readActiveProject(file)).toBe('toolbox');
    unlinkSync(file);
    rmdirSync(dir);
  });

  it('trims whitespace from active project name', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-sessions-test-'));
    const file = path.join(dir, 'active.md');
    writeFileSync(file, 'active:   gymbro  \n');
    expect(readActiveProject(file)).toBe('gymbro');
    unlinkSync(file);
    rmdirSync(dir);
  });

  it('returns null for missing file', () => {
    expect(readActiveProject('/nonexistent/path/active.md')).toBeNull();
  });

  it('returns null when file has no active: line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-sessions-test-'));
    const file = path.join(dir, 'empty.md');
    writeFileSync(file, 'just some text\n');
    expect(readActiveProject(file)).toBeNull();
    unlinkSync(file);
    rmdirSync(dir);
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
npm test
```

Expected: `10 failed` (functions not yet added)

- [ ] **Step 3: Append `listAllSessions`, `groupSessions`, and `readActiveProject` to `src/SessionReader.ts`**

Add these functions after `readSession`:

```ts
export function listAllSessions(): Session[] {
  return listProjects().flatMap((slug) => listSessions(slug));
}

export function groupSessions(
  sessions: Session[],
  workspaceRoot: string,
  projectNames: string[]
): Map<string, Session[]> {
  const map = new Map<string, Session[]>();
  for (const name of [...projectNames, "other"]) {
    map.set(name, []);
  }

  const isWindows = process.platform === "win32";
  const normalize = (p: string) => {
    const n = path.normalize(p);
    return isWindows ? n.toLowerCase() : n;
  };

  for (const session of sessions) {
    if (!session.cwd) {
      map.get("other")!.push(session);
      continue;
    }

    const cwd = normalize(session.cwd);
    let matched = false;

    for (const name of projectNames) {
      const root = normalize(path.join(workspaceRoot, name));
      if (cwd === root || cwd.startsWith(root + path.sep)) {
        map.get(name)!.push(session);
        matched = true;
        break;
      }
    }

    if (!matched) {
      map.get("other")!.push(session);
    }
  }

  return map;
}

export function readActiveProject(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/^active:\s*(.+)$/m);
    return match?.[1].trim() ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npm test
```

Expected: `18 passed`

- [ ] **Step 5: Commit**

```bash
git add src/SessionReader.ts src/test/SessionReader.test.ts
git commit -m "feat: add listAllSessions, groupSessions, readActiveProject"
```

---

## Task 5: Replace `ProjectNode` with `WorkspaceGroupNode` and update `SessionsProvider`

**Files:**
- Modify: `src/SessionsProvider.ts`

- [ ] **Step 1: Replace the entire contents of `src/SessionsProvider.ts`**

```ts
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run compile
```

Expected: exits `0` with no errors

- [ ] **Step 3: Commit**

```bash
git add src/SessionsProvider.ts
git commit -m "feat: replace ProjectNode with WorkspaceGroupNode, add cache"
```

---

## Task 6: Add VS Code configuration to `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `configuration` block to `contributes` in `package.json`**

Inside `"contributes": { ... }`, add alongside the existing keys:

```json
"configuration": {
  "title": "Claude Sessions",
  "properties": {
    "claudeSessions.workspaceRoot": {
      "type": "string",
      "default": "",
      "description": "Absolute path to the directory whose subdirectories are treated as projects (e.g. /home/user/workspace or C:\\Users\\you\\workspace)."
    },
    "claudeSessions.activeProjectFile": {
      "type": "string",
      "default": "",
      "description": "Optional. Path to a file containing 'active: <name>' — that project group will be expanded by default."
    }
  }
}
```

- [ ] **Step 2: Verify compile still passes**

```bash
npm run compile
```

Expected: exits `0`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add claudeSessions.workspaceRoot and activeProjectFile settings"
```

---

## Task 7: Install and smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```

Expected: `18 passed`, `0 failed`

- [ ] **Step 2: Install the extension**

```bash
bash install.sh
```

Expected output ends with: `✓ Done. Extension installed to ~/.vscode/extensions/sepehrn.claude-sessions-0.1.0`

- [ ] **Step 3: Reload VS Code**

In VS Code: `Ctrl+Shift+P` → `Developer: Reload Window`

- [ ] **Step 4: Configure the workspace root**

Open VS Code settings (`Ctrl+,`), search `claudeSessions.workspaceRoot`, set to `C:\Users\sepeh\Documents\workspace`

- [ ] **Step 5: Verify tree structure**

Open the Claude Sessions sidebar (chat icon in Activity Bar). Verify:

- Groups appear: `toolbox`, `gymbro`, `medianasiri`, `vault` (only those with sessions)
- Each group shows a session count in the description (e.g. `12`)
- All groups are collapsed by default

- [ ] **Step 6: Configure active project file**

In settings, set `claudeSessions.activeProjectFile` to `C:\Users\sepeh\Documents\workspace\memory\active-project.md`

Click the Refresh button in the sidebar header. Verify:

- The `toolbox` group is now expanded (matches `active: toolbox` in the file)
- Other groups remain collapsed

- [ ] **Step 7: Verify refresh clears cache**

Click the Refresh button. Verify the tree reloads and the structure is still correct.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore: verified TB-01 implementation complete"
```
