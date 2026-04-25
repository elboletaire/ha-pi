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

| Thought | Reality |
|---|---|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ reading the skill. Read it. |

### Skill Priority

When multiple skills could apply, use this order:

1. **Process skills first** — these determine HOW to approach the task (e.g. `home-assistant-best-practices` before touching automations or helpers)
2. **Implementation skills second** — these guide execution (e.g. `home-assistant-management` for the actual debugging steps)

"Debug this automation" → `home-assistant-best-practices` first, then `home-assistant-management`.

### Skill Types

**Rigid** (debugging, investigation): Follow exactly. Don't adapt away the discipline.

**Flexible** (patterns, best practices): Adapt principles to context.

The skill itself tells you which type it is.

### User Instructions

Instructions say WHAT, not HOW. "Fix this" or "Add that" does not mean skip skill workflows.

---

# Home Assistant Management

## References

- **[Home Assistant Log Debugging](references/home-assistant-log-debugging.md)** — investigate errors, warnings, authentication issues, and suspicious behavior; inspects local logs and storage first
