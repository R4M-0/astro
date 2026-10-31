#!/usr/bin/env node
/**
 * Protected (self-hosted) API build — ships no readable Astro source.
 *
 *   LICENSE_PUBLIC_KEY=<pem | base64 pem> node scripts/build-protected.mjs [--out build/protected] [--no-bytecode]
 *
 * 1. tsc → build/tsc (decorator metadata needs the real TypeScript compiler; no source maps)
 * 2. esbuild bundles first-party code (src + @astro/shared) into one file per
 *    entry — main, cli, seed, workbook-worker — minified, with the license
 *    public key / build date / self-hosted flag baked in as constants.
 *    Every npm package stays external (open-source, shipped in node_modules).
 * 3. bytenode compiles each bundle to V8 bytecode (.jsc) with the CURRENT Node
 *    binary, and the .js becomes a small loader. The runtime must use the
 *    exact same Node version (the Dockerfile pins it).
 */
import { execFileSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const outDir = resolve(root, opt('out', 'build/protected'));
const tscDir = join(root, 'build/tsc');
const bytecode = !flag('no-bytecode');

function publicKeyPem() {
  const raw = process.env.LICENSE_PUBLIC_KEY?.trim();
  if (!raw) {
    console.error('LICENSE_PUBLIC_KEY is required (license-public.pem from `pnpm license keygen`)');
    process.exit(1);
  }
  const text = raw.includes('-----BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  const key = createPublicKey(text);
  if (key.asymmetricKeyType !== 'ed25519') {
    console.error(`LICENSE_PUBLIC_KEY must be an Ed25519 key (got ${key.asymmetricKeyType})`);
    process.exit(1);
  }
  return key.export({ format: 'pem', type: 'spki' }).toString();
}

const pem = publicKeyPem();
const buildDate = process.env.BUILD_DATE || new Date().toISOString();

// ── 1. TypeScript ────────────────────────────────────────────────────────
console.log('› tsc');
rmSync(tscDir, { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.protected.json'], { cwd: root, stdio: 'inherit' });

// ── 2. bundle first-party code ───────────────────────────────────────────
/** npm packages stay external — except our own workspace package, which is bundled. */
const externalizeNpm = {
  name: 'externalize-npm',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (a) => {
      if (a.path.startsWith('@astro/')) return undefined;
      return { path: a.path, external: true };
    });
  },
};

const entries = {
  main: 'src/main.js',
  cli: 'src/cli.js',
  'workbook-worker': 'src/common/workbook-worker.js',
  seed: 'prisma/seed.js',
};

console.log('› esbuild');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [name, entry] of Object.entries(entries)) {
  const result = await esbuild.build({
    entryPoints: [join(tscDir, entry)],
    outfile: join(outDir, `${name}.js`),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    minify: true,
    // Nest / class-validator / logs rely on class names — keep them
    keepNames: true,
    legalComments: 'none',
    sourcemap: false,
    metafile: true,
    logLevel: 'warning',
    absWorkingDir: root,
    define: {
      __ASTRO_PROTECTED_BUILD__: 'true',
      __ASTRO_LICENSE_PUBLIC_KEY__: JSON.stringify(pem),
      __ASTRO_BUILD_DATE__: JSON.stringify(buildDate),
    },
    plugins: [externalizeNpm],
  });
  const leaked = Object.keys(result.metafile.inputs).filter((f) => !f.startsWith('build/tsc/') && !f.includes('packages/shared/'));
  if (leaked.length) {
    console.error(`unexpected inputs bundled into ${name}: ${leaked.join(', ')}`);
    process.exit(1);
  }
  console.log(`  ${name}.js  ${Object.keys(result.metafile.inputs).length} modules`);
}

// ── 3. V8 bytecode ───────────────────────────────────────────────────────
if (bytecode) {
  console.log(`› bytenode (node ${process.version})`);
  const bytenode = require('bytenode');
  for (const name of Object.keys(entries)) {
    const js = join(outDir, `${name}.js`);
    await bytenode.compileFile({ filename: js, output: join(outDir, `${name}.jsc`), compileAsModule: true });
    // the .js is only a loader: no source text ships. V8 refuses bytecode from
    // another Node version with an obscure error — say it plainly instead.
    writeFileSync(
      js,
      [
        `if (process.version !== '${process.version}') {`,
        `  console.error('Astro: this build requires Node ${process.version} (running ' + process.version + ')');`,
        '  process.exit(1);',
        '}',
        "require('bytenode');",
        `require('./${name}.jsc');`,
        '',
      ].join('\n'),
    );
  }
}

writeFileSync(
  join(outDir, 'build-info.json'),
  `${JSON.stringify({ buildDate, node: process.version, bytecode, entries: Object.keys(entries) }, null, 2)}\n`,
);
rmSync(tscDir, { recursive: true, force: true });
if (!existsSync(join(outDir, 'main.js'))) process.exit(1);
console.log(`✓ protected build → ${outDir}`);
