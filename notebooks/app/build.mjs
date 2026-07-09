import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  outfile: '../../notebook-assets/bundle.js',
  format: 'iife',
  platform: 'browser',
  conditions: ['style', 'browser', 'import', 'default'],
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

console.log('build done → ../../notebook-assets/bundle.js + bundle.css');
