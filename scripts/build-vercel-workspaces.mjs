import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = resolve(repoRoot, 'packages/shared');
const dbRoot = resolve(repoRoot, 'packages/db');
const apiRoot = resolve(repoRoot, 'apps/api');
const forVercel = process.argv.includes('--vercel');
const { build } = createRequire(resolve(repoRoot, 'apps/api/package.json'))('esbuild');

const workspacePlugin = {
  name: 'kuleplus-workspaces',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@kuleplus\/shared(?:\/.*)?$/ }, ({ path }) => {
      const subpath = path.slice('@kuleplus/shared'.length).replace(/^\//, '');
      const source = subpath
        ? resolve(sharedRoot, 'src', `${subpath}.ts`)
        : resolve(sharedRoot, 'src/index.ts');
      return { path: source };
    });
    buildContext.onResolve({ filter: /^@kuleplus\/db$/ }, () => ({
      path: resolve(dbRoot, 'src/index.ts'),
    }));
  },
};

if (forVercel) {
  // Vercel's TypeScript compiler leaves this monorepo's extensionless local
  // imports in the emitted ESM. Bundle the API so the deployed function has no
  // runtime dependency on those source-file import paths.
  await build({
    absWorkingDir: apiRoot,
    entryPoints: ['src/server.ts'],
    outfile: resolve(apiRoot, 'api/generated.js'),
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    plugins: [workspacePlugin],
  });
}
