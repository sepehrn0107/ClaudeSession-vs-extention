import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import * as os from "os";
import * as path from "path";
import { parseSkillFile, listSkills } from "../SkillReader";

describe("parseSkillFile", () => {
  it("extracts description from first non-heading line after frontmatter", () => {
    const content = [
      "---",
      "name: implement",
      "description: verbose routing description",
      "---",
      "",
      "# /implement",
      "",
      "Primary entry point for adding any feature.",
    ].join("\n");
    expect(parseSkillFile(content).description).toBe(
      "Primary entry point for adding any feature.",
    );
  });

  it("falls back to first non-heading line when no frontmatter", () => {
    const content = [
      "# /simple",
      "",
      "A simple skill with no frontmatter.",
    ].join("\n");
    expect(parseSkillFile(content).description).toBe(
      "A simple skill with no frontmatter.",
    );
  });

  it("returns empty string when no body line exists", () => {
    const content = "---\nname: empty\n---\n\n# /empty\n";
    expect(parseSkillFile(content).description).toBe("");
  });

  it("skips blank lines and headings before finding description", () => {
    const content = [
      "---",
      "name: test",
      "---",
      "",
      "## Sub heading",
      "",
      "Real description here.",
    ].join("\n");
    expect(parseSkillFile(content).description).toBe("Real description here.");
  });
});

describe("listSkills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for missing directory", () => {
    expect(listSkills("/nonexistent/path/skills")).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    expect(listSkills(tmpDir)).toEqual([]);
  });

  it("parses a single skill file correctly", () => {
    writeFileSync(
      path.join(tmpDir, "implement.md"),
      [
        "---",
        "name: implement",
        "---",
        "",
        "# /implement",
        "",
        "Primary entry point.",
      ].join("\n"),
    );

    const skills = listSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toEqual({
      name: "implement",
      trigger: "/implement",
      description: "Primary entry point.",
    });
  });

  it("sorts skills alphabetically by name", () => {
    writeFileSync(
      path.join(tmpDir, "git-push.md"),
      "# /git-push\n\nGit push workflow.",
    );
    writeFileSync(
      path.join(tmpDir, "implement.md"),
      "# /implement\n\nImplement a feature.",
    );
    writeFileSync(
      path.join(tmpDir, "env-check.md"),
      "# /env-check\n\nCheck the environment.",
    );

    const names = listSkills(tmpDir).map((s) => s.name);
    expect(names).toEqual(["env-check", "git-push", "implement"]);
  });

  it("ignores non-.md files", () => {
    writeFileSync(
      path.join(tmpDir, "implement.md"),
      "# /implement\n\nA skill.",
    );
    writeFileSync(path.join(tmpDir, "README.txt"), "ignore me");
    writeFileSync(path.join(tmpDir, "config.json"), "{}");

    expect(listSkills(tmpDir)).toHaveLength(1);
  });
});
