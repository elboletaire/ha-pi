---
name: home-assistant-management
description: >
  Loaded at the start of every conversation. Establishes skill discipline and provides
  comprehensive guidance for managing and troubleshooting Home Assistant instances.
  Covers log inspection, API usage, automations, entity management, and troubleshooting patterns.
license: MIT
allowed-tools: Bash, Read
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip the skill discipline
section and go directly to the Home Assistant Management content below.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you
ABSOLUTELY MUST read that skill's SKILL.md before responding.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## Using Skills

**Read the relevant skill's SKILL.md before any response or action.** Even a 1% chance a
skill might apply means you must read it first. If it turns out not to apply, you can move on.

Skills are read using the `read` tool on the skill's `SKILL.md` file. The available skills
are listed in the AGENTS.md context you received at session start.

### Red Flags

These thoughts mean STOP — you are rationalizing:

| Thought                             | Reality                                                |
| ----------------------------------- | ------------------------------------------------------ |
| "This is just a simple question"    | Questions are tasks. Check for skills.                 |
| "I need more context first"         | Skill check comes BEFORE clarifying questions.         |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first.           |
| "I can check git/files quickly"     | Files lack conversation context. Check for skills.     |
| "Let me gather information first"   | Skills tell you HOW to gather information.             |
| "This doesn't need a formal skill"  | If a skill exists, use it.                             |
| "I remember this skill"             | Skills evolve. Read current version.                   |
| "This doesn't count as a task"      | Action = task. Check for skills.                       |
| "The skill is overkill"             | Simple things become complex. Use it.                  |
| "I'll just do this one thing first" | Check BEFORE doing anything.                           |
| "This feels productive"             | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means"            | Knowing the concept ≠ reading the skill. Read it.      |

### Skill Priority

When multiple skills could apply, use this order:

1. **Process skills first** — these determine HOW to approach the task (e.g. `home-assistant-best-practices` before touching automations or helpers)
2. **Implementation skills second** — these guide execution (e.g. `home-assistant-management` for the actual debugging steps)

"Debug this automation" → `home-assistant-best-practices` first, then `home-assistant-management`.

### Awareness Triggers

When the user asks about stored artifacts, check the canonical locations BEFORE responding:

| Question pattern                                        | Check first                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| "do you have any plans?" / "what plans?" / "show plans" | `/data/workspace/plans/`                                            |
| "what specs?" / "what designs?" / "show designs"        | `/data/workspace/specs/`                                            |
| "what skills do you have?" / "can you do X?"            | Reference the `<available_skills>` list from your AGENTS.md context |
| "what sessions?" / "list sessions"                      | Use pi's session listing capability                                 |
| "show automations" / "list automations"                 | `/config/automations.yaml`                                          |

Example response when plans exist:

> "I found 3 plans in `/data/workspace/plans/`:
>
> - `2026-04-26-feature-x.md`
> - `2026-04-25-bugfix-y.md`
> - `2026-04-24-refactor-z.md`
>
> Would you like me to read any of them?"

Example response when no plans exist:

> "No plans found in `/data/workspace/plans/`. Would you like me to help create one?"

### Destructive Action Confirmations

<SAFETY-RULE>
Before executing ANY destructive action, I MUST ask for explicit confirmation:

**Destructive actions include:**

- Deleting files or directories
- Overwriting existing files
- Bulk modifications (more than 3 files at once)
- Removing HA entities, automations, or integrations
- Any irreversible change

**Confirmation format:**

> "I'm about to [action]. This will [consequence].
>
> Files affected:
>
> - `/path/to/file1`
> - `/path/to/file2`
>
> Proceed? (yes / no / don't ask again this session)"

**Session opt-out:**
If the user says "don't ask again", "skip confirmations", "yes to all", or similar, I remember this for the rest of the conversation and proceed without further confirmations. I acknowledge the opt-out once:

> "Understood — I'll skip confirmation prompts for the rest of this session."

**Opt-out does NOT apply to:**

- Actions in `/config/` (Home Assistant configuration) — always confirm
- Bulk deletions of more than 10 files — always confirm
- Any action the user hasn't explicitly requested
  </SAFETY-RULE>

### Skill Types

**Rigid** (debugging, investigation): Follow exactly. Don't adapt away the discipline.

**Flexible** (patterns, best practices): Adapt principles to context.

The skill itself tells you which type it is.

### User Instructions

Instructions say WHAT, not HOW. "Fix this" or "Add that" does not mean skip skill workflows.

## JSON Processing Preference

When processing Home Assistant API responses in shell, prefer `jq` over `python3` for simple JSON filtering, field extraction, counting, sorting, and summarization, provided `jq` is installed and available.

Use `python3` only when:

- the transformation is too complex or awkward to express cleanly in `jq`
- you need to generate or validate more complex JSON payloads
- you need loops, conditional logic, or non-trivial parsing beyond straightforward JSON queries

Default order for read-only JSON inspection:

1. `curl`
2. `jq`
3. `python3` only if needed

---

# Home Assistant Management

## References

- **[Supervisor API](references/supervisor-api.md)** — execute Supervisor API commands for system info, Core control, backups, add-ons, and updates
- **[Home Assistant Log Debugging](references/home-assistant-log-debugging.md)** — investigate errors, warnings, authentication issues, and suspicious behavior; inspects local logs and storage first
