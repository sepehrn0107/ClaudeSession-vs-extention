import { describe, it, expect } from 'vitest';
import { parseSessionLines, slugToPath, groupSessions, readActiveProject, Session, computeSessionStats, readSessionItems, ToolCallItem } from '../SessionReader';
import * as path from 'path';
import * as os from 'os';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';

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

  it('extracts hintPath from ide_opened_file tag in message content', () => {
    const text = '<ide_opened_file>The user opened the file C:\\Users\\test\\workspace\\toolbox\\src\\foo.ts in the IDE.</ide_opened_file>';
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(parseSessionLines(lines).hintPath).toBe('C:\\Users\\test\\workspace\\toolbox\\src\\foo.ts');
  });

  it('returns undefined hintPath when no ide_opened_file tag present', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(parseSessionLines(lines).hintPath).toBeUndefined();
  });
});

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

const ROOT = process.platform === 'win32'
  ? 'C:\\Users\\test\\workspace'
  : '/home/user/workspace';

const makeSession = (cwd: string | undefined, hintPath?: string): Session => ({
  id: '123',
  projectSlug: 'test',
  projectPath: 'test',
  filePath: 'test.jsonl',
  startedAt: '',
  firstUserMessage: '',
  cwd,
  hintPath,
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

  it('uses hintPath as fallback when cwd equals workspace root', () => {
    const hint = path.join(ROOT, 'toolbox', 'src', 'foo.ts');
    const map = groupSessions([makeSession(ROOT, hint)], ROOT, ['toolbox']);
    expect(map.get('toolbox')!.length).toBe(1);
    expect(map.get('other')!.length).toBe(0);
  });

  it('falls to other when neither cwd nor hintPath matches', () => {
    const unmatched = process.platform === 'win32' ? 'C:\\other\\path' : '/other/path';
    const map = groupSessions([makeSession(ROOT, unmatched)], ROOT, ['toolbox']);
    expect(map.get('other')!.length).toBe(1);
    expect(map.get('toolbox')!.length).toBe(0);
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
    const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-sessions-test-'));
    const file = path.join(dir, 'empty.md');
    writeFileSync(file, 'just some text\n');
    expect(readActiveProject(file)).toBeNull();
    unlinkSync(file);
    rmdirSync(dir);
  });
});

// Helper
function tmpFile(lines: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cs-test-"));
  const file = path.join(dir, "session.jsonl");
  writeFileSync(file, lines.join("\n"));
  return file;
}

const ASSISTANT_TURN = (
  inputTokens: number,
  cacheRead: number,
  cacheCreate: number,
  toolName?: string,
  ts = "2026-01-01T00:05:00.000Z",
) =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: inputTokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
      },
      content: [
        { type: "text", text: "response text" },
        ...(toolName
          ? [
              {
                type: "tool_use",
                id: "tu1",
                name: toolName,
                input: { command: "npm test" },
              },
            ]
          : []),
      ],
    },
  });

const USER_TURN = (ts = "2026-01-01T00:00:00.000Z") =>
  JSON.stringify({
    type: "user",
    timestamp: ts,
    message: { content: [{ type: "text", text: "hello" }] },
  });

describe("computeSessionStats", () => {
  it("uses last assistant turn for memoryUsed", () => {
    const file = tmpFile([
      USER_TURN("2026-01-01T00:00:00.000Z"),
      ASSISTANT_TURN(100, 50, 20, undefined, "2026-01-01T00:01:00.000Z"),
      USER_TURN("2026-01-01T00:02:00.000Z"),
      ASSISTANT_TURN(200, 80, 30, undefined, "2026-01-01T00:03:00.000Z"),
    ]);
    const stats = computeSessionStats(file);
    expect(stats.memoryUsed).toBe(200 + 80 + 30); // 310
    expect(stats.memoryLimit).toBe(200_000);
  });

  it("computes checkpointPct as total cache_read / total_input across all turns", () => {
    const file = tmpFile([
      USER_TURN(),
      ASSISTANT_TURN(100, 50, 0, undefined, "2026-01-01T00:01:00.000Z"),
      USER_TURN("2026-01-01T00:02:00.000Z"),
      ASSISTANT_TURN(200, 100, 0, undefined, "2026-01-01T00:03:00.000Z"),
    ]);
    const stats = computeSessionStats(file);
    expect(stats.checkpointPct).toBe(33);
  });

  it("counts user messages as exchangeCount", () => {
    const file = tmpFile([
      USER_TURN(),
      ASSISTANT_TURN(10, 0, 0),
      USER_TURN("2026-01-01T00:01:00.000Z"),
      ASSISTANT_TURN(10, 0, 0),
      USER_TURN("2026-01-01T00:02:00.000Z"),
      ASSISTANT_TURN(10, 0, 0),
    ]);
    expect(computeSessionStats(file).exchangeCount).toBe(3);
  });

  it("computes durationMinutes from first to last timestamp", () => {
    const file = tmpFile([
      USER_TURN("2026-01-01T00:00:00.000Z"),
      ASSISTANT_TURN(10, 0, 0, undefined, "2026-01-01T00:05:00.000Z"),
    ]);
    expect(computeSessionStats(file).durationMinutes).toBe(5);
  });

  it("counts tool_use blocks by name", () => {
    const file = tmpFile([
      USER_TURN(),
      ASSISTANT_TURN(10, 0, 0, "Bash", "2026-01-01T00:01:00.000Z"),
      USER_TURN("2026-01-01T00:02:00.000Z"),
      ASSISTANT_TURN(10, 0, 0, "Bash", "2026-01-01T00:03:00.000Z"),
    ]);
    const stats = computeSessionStats(file);
    expect(stats.toolCounts["Bash"]).toBe(2);
  });

  it("returns zero-values for empty file", () => {
    const file = tmpFile([]);
    const stats = computeSessionStats(file);
    expect(stats.memoryUsed).toBe(0);
    expect(stats.exchangeCount).toBe(0);
    expect(stats.durationMinutes).toBe(0);
    expect(stats.checkpointPct).toBe(0);
    expect(stats.toolCounts).toEqual({});
  });

  it("caches result — second call with same mtime returns same object reference", () => {
    const file = tmpFile([USER_TURN(), ASSISTANT_TURN(10, 0, 0)]);
    const a = computeSessionStats(file);
    const b = computeSessionStats(file);
    expect(a).toBe(b);
  });
});

describe("readSessionItems", () => {
  it("returns ChatMessage for user text", () => {
    const file = tmpFile([USER_TURN()]);
    const items = readSessionItems(file);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: "user", text: "hello" });
  });

  it("returns ChatMessage for assistant text and ToolCallItem for tool_use in same turn", () => {
    const file = tmpFile([USER_TURN(), ASSISTANT_TURN(10, 0, 0, "Bash")]);
    const items = readSessionItems(file);
    // [user, assistant_text, tool_call]
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({
      role: "assistant",
      text: "response text",
    });
    const tc = items[2] as {
      kind: string;
      toolName: string;
      inputPreview: string;
    };
    expect(tc.kind).toBe("tool_call");
    expect(tc.toolName).toBe("Bash");
    expect(tc.inputPreview).toBe("npm test");
  });

  it("omits tool_use blocks that have no text in same assistant turn when text is empty", () => {
    const turnNoText = JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:01:00.000Z",
      message: {
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        content: [
          {
            type: "tool_use",
            id: "tu1",
            name: "Read",
            input: { file_path: "src/foo.ts" },
          },
        ],
      },
    });
    const file = tmpFile([USER_TURN(), turnNoText]);
    const items = readSessionItems(file);
    const toolItems = items.filter(
      (i): i is ToolCallItem =>
        "kind" in i && (i as ToolCallItem).kind === "tool_call",
    );
    expect(toolItems).toHaveLength(1);
  });

  it("sets inputPreview to file_path for Read tool", () => {
    const turnRead = JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:01:00.000Z",
      message: {
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        content: [
          {
            type: "tool_use",
            id: "tu1",
            name: "Read",
            input: { file_path: "src/auth.ts" },
          },
        ],
      },
    });
    const file = tmpFile([USER_TURN(), turnRead]);
    const items = readSessionItems(file);
    const tc = items.find(
      (i): i is ToolCallItem => "kind" in i,
    ) as ToolCallItem;
    expect(tc.inputPreview).toBe("src/auth.ts");
  });
});
