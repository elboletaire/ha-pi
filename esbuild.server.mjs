import * as esbuild from 'esbuild'
import { argv } from 'process'

const watch = argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['src/server.ts'],
  bundle: true,
  packages: 'external', // keep node_modules as runtime requires
  outfile: 'dist/server.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
})

if (watch) {
  await ctx.watch()
  console.log('Watching server...')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('Server built.')
}
