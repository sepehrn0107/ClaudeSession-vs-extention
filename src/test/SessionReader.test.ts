import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSessionLines, slugToPath, groupSessions, readActiveProject, Session, loadStatusMap } from '../SessionReader';
import * as path from 'path';
import * as os from 'os';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, mkdirSync, rmSync } from 'fs';

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

describe('loadStatusMap', () => {
  let tmpDir: string;
  let statusDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    statusDir = path.join(tmpDir, 'sessions-status');
    sessionsDir = path.join(tmpDir, 'sessions');
    mkdirSync(statusDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty map when statusDir does not exist', () => {
    const missing = path.join(tmpDir, 'nonexistent');
    const result = loadStatusMap(missing, sessionsDir);
    expect(result.size).toBe(0);
  });

  it('maps sessionId to snapshot with todos', () => {
    const pid = 12345;
    const sessionId = 'abc-123';
    // Write sessions/<pid>.json so pidMap resolves sessionId
    writeFileSync(path.join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, sessionId }));
    // Write sessions-status/<pid>.json with todos
    const snap = {
      todos: [{ content: 'Write test', status: 'pending', activeForm: 'Writing test' }],
      pendingInput: false,
    };
    writeFileSync(path.join(statusDir, `${pid}.json`), JSON.stringify(snap));

    const result = loadStatusMap(statusDir, sessionsDir);
    expect(result.size).toBe(1);
    expect(result.get(sessionId)?.todos).toHaveLength(1);
    expect(result.get(sessionId)?.todos?.[0].content).toBe('Write test');
  });

  it('skips malformed JSON files without throwing', () => {
    const pid = 99999;
    const sessionId = 'xyz-999';
    writeFileSync(path.join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, sessionId }));
    writeFileSync(path.join(statusDir, `${pid}.json`), 'not-json{{{');

    expect(() => loadStatusMap(statusDir, sessionsDir)).not.toThrow();
    const result = loadStatusMap(statusDir, sessionsDir);
    expect(result.size).toBe(0);
  });

  it('skips status files with no matching session', () => {
    // No entry in sessionsDir for this pid
    writeFileSync(path.join(statusDir, '77777.json'), JSON.stringify({ pendingInput: true }));
    const result = loadStatusMap(statusDir, sessionsDir);
    expect(result.size).toBe(0);
  });
});
