import { build } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';

await rm('dist-node', { recursive: true, force: true });
await mkdir('dist-node/electron', { recursive: true });
await mkdir('dist-node/server', { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  external: ['electron']
};

await build({
  ...shared,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-node/electron/main.cjs'
});

await build({
  ...shared,
  entryPoints: ['server/server.ts'],
  outfile: 'dist-node/server/server.cjs'
});

await build({
  ...shared,
  entryPoints: ['server/standalone.ts'],
  outfile: 'dist-node/server/standalone.cjs'
});
