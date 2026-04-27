import * as esbuild from 'esbuild'
import { argv } from 'process'
import { readFileSync } from 'fs'

const watch = argv.includes('--watch')

// Read version from package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const ADDON_VERSION = pkg.version

const ctx = await esbuild.context({
  entryPoints: ['src/server.ts'],
  bundle: true,
  packages: 'external', // keep node_modules as runtime requires
  outfile: 'dist/server.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  define: {
    'process.env.ADDON_VERSION_BUILD': JSON.stringify(ADDON_VERSION),
  },
})

if (watch) {
  await ctx.watch()
  console.log('Watching server...')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('Server built.')
}
