#!/usr/bin/env node

import { execSync } from 'child_process'
import { readdir, rm, stat } from 'fs/promises'

// Agent dirs created as a side-effect of `npx skills add`
const AGENT_DIRS = ['.agents', '.claude', '.continue', '.crush', '.pi']

// Snapshot which agent dirs already exist before we touch anything.
// Used at the end to clean up only what the script created.
const preExisting = new Set()
for (const dir of AGENT_DIRS) {
  try {
    await stat(dir)
    preExisting.add(dir) // existed — leave it entirely alone after install
  } catch {
    // dir did not exist at all — safe to remove after install
  }
}

// External skills to install from repositories
const EXTERNAL_SKILLS = [
  ['anthropics/skills', 'skill-creator'],
  ['vercel-labs/skills', 'find-skills'],
  ['homeassistant-ai/skills', 'home-assistant-best-practices'],
  ['obra/superpowers', 'executing-plans'],
  ['obra/superpowers', 'systematic-debugging'],
  ['obra/superpowers', 'writing-plans'],
  ['obra/superpowers', 'test-driven-development'],
]

// Install external skills into skills/
for (const [repo, skillName] of EXTERNAL_SKILLS) {
  console.log(`\n📦 Installing ${skillName} from ${repo}...`)

  try {
    // Install the skill using npx skills add to .agents/skills/
    execSync(`npx skills add ${repo} --skill ${skillName} -y`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    })

    // Copy from .agents/skills/{skillName} to skills/{skillName}
    const srcPath = `.agents/skills/${skillName}`
    const destPath = `pi/skills/${skillName}`

    // Remove destination if it exists
    await rm(destPath, { recursive: true, force: true })

    // Copy the entire skill directory
    execSync(`cp -r ${srcPath} pi/skills/`, {
      stdio: 'inherit',
    })

    console.log(`✓ ${skillName} installed to skills/`)
  } catch (error) {
    console.error(`❌ Failed to install ${skillName}:`, error.message)
    process.exit(1)
  }
}

console.log('\n✅ Skills installation complete. Available skills:')
try {
  const skillDirs = await readdir('pi/skills', { withFileTypes: true })
  for (const entry of skillDirs) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      console.log(`  - ${entry.name}`)
    }
  }
} catch (error) {
  console.log('  (no skills found)')
}

// Cleanup: remove only what this script created.
// Dirs that already existed before the script ran are left completely untouched,
// regardless of their contents. Only dirs that were absent at startup are removed.
console.log('\n🧹 Cleaning up agent directories created during installation...')
for (const dir of AGENT_DIRS) {
  if (!preExisting.has(dir)) {
    await rm(dir, { recursive: true, force: true })
    console.log(`  removed ${dir}/`)
  } else {
    console.log(`  skipped ${dir}/ (pre-existed)`)
  }
}
