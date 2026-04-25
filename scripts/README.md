# Build Scripts

This directory contains build-time scripts for the ha-pi-agent project.

## install-skills.mjs

Installs external skills from repositories into the `skills/` directory. This keeps third-party code out of git while maintaining all functionality.

### How It Works

The script:

1. Cleans the `skills/` directory (preserving `.gitkeep`)
2. Uses `npx skills add` to install each external skill
3. Copies installed skills to `skills/` for use by the application

### Skills Installed

| Skill                         | Source Repository       | Command                                                                           |
| ----------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| find-skills                   | vercel-labs/skills      | `npx skills add vercel-labs/skills --skill find-skills -y`                        |
| home-assistant-best-practices | homeassistant-ai/skills | `npx skills add homeassistant-ai/skills --skill home-assistant-best-practices -y` |
| executing-plans               | obra/superpowers        | `npx skills add obra/superpowers --skill executing-plans -y`                      |
| systematic-debugging          | obra/superpowers        | `npx skills add obra/superpowers --skill systematic-debugging -y`                 |
| writing-plans                 | obra/superpowers        | `npx skills add obra/superpowers --skill writing-plans -y`                        |
| test-driven-development       | obra/superpowers        | `npx skills add obra/superpowers --skill test-driven-development -y`              |

### Custom Skills

You can add custom skills directly to the `skills/` directory. These will be included in the Docker image alongside external skills:

```bash
mkdir skills/my-custom-skill
echo "---\nname: my-custom-skill\ndescription: My custom skill\n---" > skills/my-custom-skill/SKILL.md
```

### Usage

**Local development:**

```bash
pnpm run install-skills
```

**During Docker build:**
The script runs automatically as part of `pnpm run build`.

### Configuration

To change which external skills are installed, edit the `EXTERNAL_SKILLS` array in `install-skills.mjs`:

```javascript
const EXTERNAL_SKILLS = [
  ['repository/repo', 'skill-name'],
  // Add or remove skills here
]
```

### Requirements

- Node.js 22+ (for running the script)
- Git (installed in Docker builder stage)
- Network access to GitHub (to clone skill repositories)

### Directory Structure

```
skills/
├── find-skills/                    # External skill (auto-installed)
├── home-assistant-best-practices/  # External skill (auto-installed)
├── executing-plans/                # External skill (auto-installed)
├── systematic-debugging/           # External skill (auto-installed)
├── writing-plans/                  # External skill (auto-installed)
├── test-driven-development/        # External skill (auto-installed)
└── home-assistant-management/      # Custom skill (committed to git)
```

### Why Store Skills in `skills/`?

1. **Single source of truth**: Both external and custom skills live together
2. **Easy to add custom skills**: Just create a new directory in `skills/`
3. **Follows convention**: Matches the standard agent skills directory structure
4. **Clean git history**: External skills are installed fresh each build

### Testing

To test the script locally:

```bash
# Remove existing skills
rm -rf skills/*

# Install fresh
pnpm run install-skills

# Verify
ls skills/
```

To add a custom skill:

```bash
mkdir skills/my-skill
cat > skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: My custom skill description
---

# My Skill

Instructions here...
EOF

# Build and verify
pnpm run build
docker build -t ha-pi-test .
docker run --rm ha-pi-test ls /app/skills/
```
