#!/usr/bin/env node
/**
 * Bağımlılık ve Lisans Envanteri — ROADMAP §4
 * Tüm workspace'lerdeki production bağımlılıklarını ve lisanslarını toplar.
 * Kullanım: node scripts/license-inventory.mjs [--json|--md]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve('./');

function getWorkspaces() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  return pkg.workspaces || [];
}

function getPackageInfo(workspacePath) {
  const pkgPath = resolve(workspacePath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return {
    name: pkg.name,
    version: pkg.version,
    private: pkg.private,
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    peerDependencies: pkg.peerDependencies || {},
    license: pkg.license || 'UNKNOWN',
    repository: pkg.repository,
    homepage: pkg.homepage,
  };
}

function getAllLicenses() {
  // npm ls --all --json ile tam bağımlılık ağacını al
  const output = execSync('npm ls --all --json --workspaces=true', {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const tree = JSON.parse(output);

  const licenses = new Map();
  const seen = new Set();

  function traverse(node, path = '') {
    if (!node.dependencies) return;
    for (const [name, dep] of Object.entries(node.dependencies)) {
      const key = `${name}@${dep.version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const license = dep.license || dep.licenses?.[0]?.type || 'UNKNOWN';
      const repo = dep.repository?.url || dep.repository || '';
      const isDev = dep.dev === true || dep.dev === 'true';
      const isOptional = dep.optional === true || dep.optional === 'true';

      if (!licenses.has(license)) licenses.set(license, []);
      licenses.get(license).push({
        name,
        version: dep.version,
        license,
        repository: repo,
        isDev,
        isOptional,
        path: `${path}/${name}`,
      });

      if (dep.dependencies) traverse(dep, `${path}/${name}`);
    }
  }

  traverse(tree);
  return licenses;
}

async function main() {
  // Workspace paketleri
  const workspaces = getWorkspaces();
  console.log(`Bulunan workspace sayısı: ${workspaces.length}`);

  const workspaceInfos = [];
  for (const ws of workspaces) {
    const fullPath = resolve(ROOT, ws);
    // glob pattern için basit yaklaşım: her alt klasör
    const { readdirSync, statSync } = await import('node:fs');
    try {
      const entries = readdirSync(fullPath);
      for (const entry of entries) {
        const entryPath = resolve(fullPath, entry);
        if (statSync(entryPath).isDirectory()) {
          const info = getPackageInfo(entryPath);
          if (info) workspaceInfos.push({ workspace: ws, package: entry, ...info });
        }
      }
    } catch {
      // glob pattern değilse direkt paket olabilir
      const info = getPackageInfo(fullPath);
      if (info) workspaceInfos.push({ workspace: ws, package: ws, ...info });
    }
  }

  console.log(`Bulunan paket sayısı: ${workspaceInfos.length}`);

  // Lisans envanteri
  console.log('Lisans envanteri toplanıyor...');
  const licenses = getAllLicenses();

  let totalDeps = 0;
  for (const [, deps] of licenses) {
    totalDeps += deps.length;
  }

  console.log(`Toplam bağımlılık sayısı: ${totalDeps}`);
  console.log(`Benzersiz lisans sayısı: ${licenses.size}`);

  // Çıktı
  const args = process.argv.slice(2);
  if (args.includes('--json')) {
    const output = {
      generatedAt: new Date().toISOString(),
      workspaces: workspaceInfos,
      licenses: Object.fromEntries(licenses),
      summary: {
        workspaceCount: workspaceInfos.length,
        totalDependencies: totalDeps,
        uniqueLicenses: licenses.size,
      },
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    let md = `# Bağımlılık ve Lisans Envanteri\n\n> Oluşturulma: ${new Date().toISOString()}\n\n`;
    md += `## Özet\n\n`;
    md += `| Metrik | Değer |\n|--------|-------|\n| Workspace paketi | ${workspaceInfos.length} |\n| Toplam bağımlılık | ${totalDeps} |\n| Benzersiz lisans | ${licenses.size} |\n\n`;

    md += `## Workspace Paketleri\n\n`;
    md += `| Paket | Sürüm | Lisans | Özel |\n|-------|-------|--------|------|\n`;
    for (const ws of workspaceInfos.sort((a, b) => a.package.localeCompare(b.package))) {
      md += `| ${ws.package} | ${ws.version} | ${ws.license} | ${ws.private ? 'Evet' : 'Hayır'} |\n`;
    }

    md += `\n## Lisans Dağılımı\n\n`;
    md += `| Lisans | Bağımlılık Sayısı |\n|--------|------------------|\n`;
    for (const [license, deps] of [...licenses.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      md += `| ${license} | ${deps.length} |\n`;
    }

    md += `\n## Bağımlılık Detayları (ilk 50)\n\n`;
    md += `| Paket | Sürüm | Lisans | Dev | Opsiyonel |\n|-------|-------|--------|-----|-----------|\n`;
    let count = 0;
    for (const [license, deps] of licenses) {
      for (const dep of deps) {
        if (count >= 50) break;
        md += `| ${dep.name} | ${dep.version} | ${license} | ${dep.isDev ? 'Evet' : 'Hayır'} | ${dep.isOptional ? 'Evet' : 'Hayır'} |\n`;
        count++;
      }
      if (count >= 50) break;
    }
    if (totalDeps > 50) md += `\n... ve ${totalDeps - 50} bağımlılık daha\n`;

    writeFileSync('LICENSE_INVENTORY.md', md, 'utf8');
    console.log('✓ LICENSE_INVENTORY.md yazıldı');
  }
}

main().catch(console.error);
