import * as esbuild from 'esbuild'
import { argv } from 'process'

const watch = argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: {
    app: 'frontend/app.ts',
    'theme-init': 'frontend/theme-init.ts',
  },
  bundle: true,
  outdir: 'public',
  entryNames: '[name]',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
  },
})

if (watch) {
  await ctx.watch()
  console.log('Watching frontend...')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('Frontend built.')
}
