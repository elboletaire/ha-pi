import { existsSync, readFileSync } from "fs";
import {
  DefaultResourceLoader,
  type ResourceLoader,
  type Skill,
  loadSkillsFromDir,
} from "@mariozechner/pi-coding-agent";
import { PATHS, log } from "./options.js";

const AGENTS_OPTIONS_FILE = `${PATHS.piAgentDir}/agents-options.md`;

/**
 * Loads all skills from a bundled-skills directory.
 * Each subdirectory with a SKILL.md is a skill.
 */
function loadBundledSkills() {
  if (!existsSync(PATHS.bundledSkills)) {
    log.warn(`Bundled skills dir not found: ${PATHS.bundledSkills}`);
    return { skills: [], diagnostics: [] };
  }
  return loadSkillsFromDir({ dir: PATHS.bundledSkills, source: "bundled" });
}

/**
 * Creates the ResourceLoader for the pi agent session:
 *
 * AGENTS.md loading order (concatenated):
 *   1. /app/base-agents.md          — hardcoded by us (image)
 *   2. /data/pi-agent/agents-options.md — from add-on options (regenerated each start)
 *   3. /data/pi-agent/AGENTS.md     — user's own file (auto-discovered via agentDir)
 *
 * Skills loading order:
 *   1. /app/bundled-skills/         — image-bundled, always present
 *   2. /data/pi-agent/skills/       — user-installed via `pi install`, win on name conflict
 */
export async function createResourceLoader(): Promise<ResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: PATHS.workspace,
    agentDir: PATHS.piAgentDir,

    agentsFilesOverride: (discovered) => {
      const files: Array<{ path: string; content: string }> = [];

      // 1. Hardcoded base
      if (existsSync(PATHS.baseAgentsMd)) {
        files.push({
          path: PATHS.baseAgentsMd,
          content: readFileSync(PATHS.baseAgentsMd, "utf8"),
        });
      } else {
        log.warn(`base-agents.md not found at ${PATHS.baseAgentsMd}`);
      }

      // 2. Options-generated append (if present)
      if (existsSync(AGENTS_OPTIONS_FILE)) {
        files.push({
          path: AGENTS_OPTIONS_FILE,
          content: readFileSync(AGENTS_OPTIONS_FILE, "utf8"),
        });
      }

      // 3. User's own AGENTS.md files (auto-discovered, always last)
      files.push(...discovered.agentsFiles);

      return { agentsFiles: files };
    },

    skillsOverride: (discovered) => {
      const bundled = loadBundledSkills();

      // Build a map of user skills by name so they can override bundled ones
      const userByName = new Map(discovered.skills.map((s) => [s.name, s]));

      // Start with bundled, then override with any user skill of the same name
      const merged = bundled.skills.map((s: Skill) =>
        userByName.has(s.name) ? userByName.get(s.name)! : s
      );

      // Add user skills that are NOT in the bundled set
      for (const s of discovered.skills) {
        if (!bundled.skills.some((b: Skill) => b.name === s.name)) {
          merged.push(s);
        }
      }

      log.debug(
        `Skills loaded: ${merged.map((s: Skill) => s.name).join(", ")} ` +
          `(${bundled.skills.length} bundled, ${discovered.skills.length} user)`
      );

      return {
        skills: merged,
        diagnostics: [...bundled.diagnostics, ...discovered.diagnostics],
      };
    },
  });

  await loader.reload();
  return loader;
}
