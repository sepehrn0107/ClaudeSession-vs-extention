import { describe, it, expect } from 'vitest';
import { parseSessionLines, slugToPath } from '../SessionReader';

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
