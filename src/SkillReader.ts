import * as fs from "fs";
import * as path from "path";

export interface SkillEntry {
  name: string;
  trigger: string;
  description: string;
}

export function parseSkillFile(content: string): { description: string } {
  const lines = content.split("\n");
  let i = 0;

  // Skip frontmatter block if present
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") i++;
    i++; // skip closing ---
  }

  // Find first non-blank, non-heading line
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line && !line.startsWith("#")) {
      return { description: line };
    }
    i++;
  }

  return { description: "" };
}

export function listSkills(skillsDir: string): SkillEntry[] {
  if (!fs.existsSync(skillsDir)) return [];

  return fs
    .readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const name = path.basename(f, ".md");
      const content = fs.readFileSync(path.join(skillsDir, f), "utf8");
      const { description } = parseSkillFile(content);
      return { name, trigger: `/${name}`, description };
    });
}
