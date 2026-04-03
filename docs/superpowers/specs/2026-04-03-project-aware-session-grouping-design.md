# TB-01: Project-Aware Session Grouping — Design Spec

**Date:** 2026-04-03  
**Ticket:** TB-01  
**Status:** Approved

---

## Goal

Group sessions in the Claude Code VSCode extension sidebar by workspace project rather than by Claude's internal slug directories. The session list should be scannable at a glance and serve as the foundation for TB-05, TB-06, TB-07, and TB-10.

---

## Configuration

Two new VS Code settings added to `package.json` under `contributes.configuration`:

| Setting | Type | Required | Description |
|---|---|---|---|
| `claudeSessions.workspaceRoot` | `string` | Yes | Absolute path to the directory whose subdirectories are treated as projects |
| `claudeSessions.activeProjectFile` | `string` | No | Path to a file containing `active: <name>` — that project expands by default |

The `activeProjectFile` format matches the toolbox `memory/active-project.md` convention (`active: <name>` on the first matching line), but any file in that format works. If absent or unreadable, all groups are collapsed.

---

## Tree Structure

```
WorkspaceGroupNode (toolbox · 12)   ← expanded if active project
  SessionNode
  SessionNode
WorkspaceGroupNode (gymbro · 4)     ← collapsed
  SessionNode
  ...
WorkspaceGroupNode (other · 2)      ← collapsed, only shown if non-empty
  SessionNode
  ...
```

Groups are sorted alphabetically. "other" is always last. Groups with zero sessions are hidden.

---

## Architecture

### Files changed

- `src/SessionReader.ts` — add `cwd` extraction, new `listAllSessions()`, fix `slugToPath` cross-platform
- `src/SessionsProvider.ts` — replace `ProjectNode` with `WorkspaceGroupNode`, add grouping + cache
- `package.json` — add configuration contribution

### `SessionReader.ts`

**`Session` interface** gains `cwd?: string`.

**`listSessions()`** already reads the first 20 lines of each JSONL. Add `cwd` extraction in the same loop: user-type entries carry `cwd` as a top-level field (`obj.cwd`). Extract on first occurrence.

**`listAllSessions()`** — new function:
```ts
export function listAllSessions(): Session[] {
  return listProjects().flatMap(slug => listSessions(slug));
}
```

**`slugToPath()`** — fix for cross-platform:
- Windows slugs begin with a drive letter pattern (`c--`) — reconstruct as `C:\...` using `\` separator
- Linux/Mac slugs do not have a drive prefix — prepend `/` and replace `--` with `/`
- Detection: check `slug` format, not `process.platform`, so reconstructed paths match the session data regardless of where the extension runs

### `SessionsProvider.ts`

**`WorkspaceGroupNode`** replaces `ProjectNode`:
```ts
class WorkspaceGroupNode extends vscode.TreeItem {
  constructor(
    public readonly projectName: string,
    sessionCount: number,
    isActive: boolean
  ) {
    super(projectName, isActive
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    this.description = String(sessionCount);
    this.contextValue = "workspaceGroup";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}
```

**`SessionsProvider`** cache:
- `private _groups: WorkspaceGroupNode[] | null = null`
- `private _sessionCache: Map<string, SessionNode[]> | null = null`
- `refresh()` sets both to `null` and fires the tree change event

**`getChildren(undefined)`**:
1. Read `claudeSessions.workspaceRoot` from VS Code config
2. If not set → return a single placeholder `TreeItem` with message "Set claudeSessions.workspaceRoot to get started"
3. If set but directory not found → return error `TreeItem` with the invalid path
4. If cache is populated → return `_groups`
5. Otherwise:
   a. Call `listAllSessions()` to get all sessions with `cwd`
   b. Scan `workspaceRoot` subdirectories to get project names
   c. Read active project name from `activeProjectFile` if configured
   d. Group sessions using `groupSessions()` (see below)
   e. Build `WorkspaceGroupNode[]`, skip empty groups, append "other" if non-empty
   f. Store nodes in `_groups` and session arrays in `_sessionCache`
   g. Return `_groups`

**`getChildren(WorkspaceGroupNode)`** → return `_sessionCache.get(node.projectName) ?? []`

**`groupSessions(sessions, workspaceRoot, projectNames)`** — pure function, easy to test:
```
for each session:
  normalize session.cwd and each projectRoot = workspaceRoot + sep + projectName
  match: cwd === projectRoot OR cwd starts with projectRoot + sep
  if match → assign to that project bucket
  else → assign to "other"
```

Path normalization:
- Use `path.normalize()` on both sides before comparison
- Case-insensitive on Windows (`process.platform === 'win32'`), case-sensitive otherwise
- Check `cwd === projectRoot || cwd.startsWith(projectRoot + path.sep)` — the equality check handles sessions started exactly in the project root; the prefix check handles sessions in subdirectories; together they prevent `workspace/foo` matching `workspace/foobar`

---

## Data Flow

```
activate()
  └─ new SessionsProvider()

getChildren(undefined)
  ├─ read settings
  ├─ listAllSessions()            ← reads all JSONL first 20 lines
  ├─ scan workspaceRoot subdirs
  ├─ readActiveProject()
  ├─ groupSessions()
  ├─ build WorkspaceGroupNode[]  ← populate _groups + _sessionCache
  └─ return _groups

getChildren(WorkspaceGroupNode)
  └─ return _sessionCache.get(name)  ← no I/O

refresh()
  ├─ _groups = null
  ├─ _sessionCache = null
  └─ fire onDidChangeTreeData
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `workspaceRoot` not set | Placeholder TreeItem with setup instructions |
| `workspaceRoot` directory not found | Error TreeItem showing the invalid path |
| `activeProjectFile` absent or unreadable | Silently ignored; all groups collapsed |
| Session JSONL has no `cwd` field | Session assigned to "other" |
| Session `cwd` matches no project root | Session assigned to "other" |
| Malformed JSONL line | Skipped (existing behaviour) |
| "other" group is empty | Group not shown |

---

## Cross-Platform Notes

- **Path separators:** normalize with `path.normalize()` before comparison; `path.join()` for construction
- **Case sensitivity:** case-insensitive comparison on `win32` only
- **`slugToPath`:** detect slug format from content (drive letter prefix present vs absent), not from `process.platform`
- **`workspaceRoot` setting:** users enter paths in their native format; normalization handles the rest

---

## Testing

### Unit tests

| Subject | What to verify |
|---|---|
| `listSessions()` | `cwd` extracted from JSONL user-type entry |
| `listAllSessions()` | flattens sessions from multiple slugs |
| `groupSessions()` | correct bucket for matching cwd, "other" for non-match, case-insensitive on win32, no false prefix match (`foo` vs `foobar`) |
| `slugToPath()` | Windows slug → Windows path; Linux/Mac slug → Unix path |
| `WorkspaceGroupNode` | expanded when `isActive=true`, collapsed otherwise; `description` shows count |

### Manual tests

- Extension with `workspaceRoot` unset → placeholder shown
- Extension with valid `workspaceRoot` → groups appear, counts correct
- `activeProjectFile` pointing to valid file → matching group expanded
- `activeProjectFile` path missing → all groups collapsed
- Refresh button → cache cleared, tree reloads
