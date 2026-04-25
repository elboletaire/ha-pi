#!/usr/bin/env node

import { execSync } from 'child_process'
import { readdir, rm } from 'fs/promises'

// External skills to install from repositories
const EXTERNAL_SKILLS = [
  ['vercel-labs/skills', 'find-skills'],
  ['obra/superpowers', 'using-superpowers'],
  ['homeassistant-ai/skills', 'home-assistant-best-practices'],
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
    const destPath = `skills/${skillName}`

    // Remove destination if it exists
    await rm(destPath, { recursive: true, force: true })

    // Copy the entire skill directory
    execSync(`cp -r ${srcPath} skills/`, {
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
  const skillDirs = await readdir('skills', { withFileTypes: true })
  for (const entry of skillDirs) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      console.log(`  - ${entry.name}`)
    }
  }
} catch (error) {
  console.log('  (no skills found)')
}
