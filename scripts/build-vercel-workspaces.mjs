import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = resolve(repoRoot, 'packages/shared');
const dbRoot = resolve(repoRoot, 'packages/db');
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

async function bundlePackage(root, entries) {
  const outdir = resolve(root, 'dist');
  await mkdir(outdir, { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: entries,
    outdir,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    plugins: [workspacePlugin],
  });
}

await bundlePackage(sharedRoot, {
  index: 'src/index.ts',
  'integrations/payment-server': 'src/integrations/payment-server.ts',
  'integrations/ports': 'src/integrations/ports.ts',
  'integrations/mock': 'src/integrations/mock.ts',
});
await bundlePackage(dbRoot, { index: 'src/index.ts' });

if (forVercel) {
  for (const packageRoot of [sharedRoot, dbRoot]) {
    const packageFile = resolve(packageRoot, 'package.json');
    const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
    manifest.main = manifest.main.replace('./src/', './dist/').replace(/\.ts$/, '.js');
    manifest.exports = Object.fromEntries(
      Object.entries(manifest.exports).map(([name, target]) => [
        name,
        {
          types: target,
          import: target.replace('./src/', './dist/').replace(/\.ts$/, '.js'),
        },
      ]),
    );
    await writeFile(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
