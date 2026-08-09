#!/usr/bin/env node
//
// Build the tarball Homebrew installs.
//
// What goes in is deliberately small: the built app, the migrations, the
// host, and a package.json that exists only so `teller version` has
// something to read. **No node_modules** — the host imports nothing but
// node builtins, so there is nothing to install, nothing to compile, and
// no native module to go stale when Node updates. That's the property
// that makes the formula five lines long, and it's worth protecting.

import { execFile } from 'node:child_process';
import { mkdir, cp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const INCLUDE = ['bin', 'host', 'migrations', 'dist'];

async function main() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const name = `teller-${version}`;
  const out = join(ROOT, 'build');
  const stage = join(out, name);

  if (!(await stat(join(ROOT, 'dist', 'teller', 'index.js')).catch(() => null))) {
    throw new Error('no build — run `pnpm build` first');
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  for (const dir of INCLUDE) {
    await cp(join(ROOT, dir), join(stage, dir), { recursive: true });
  }

  // A stripped package.json: the installed copy is not a project anyone
  // builds from, and shipping devDependencies would invite Homebrew to
  // think otherwise.
  await writeFile(
    join(stage, 'package.json'),
    `${JSON.stringify(
      {
        name: 'teller',
        version,
        license: pkg.license,
        type: 'module',
        bin: { teller: 'bin/teller' },
        private: true,
      },
      null,
      2,
    )}\n`,
  );
  for (const file of ['LICENSE', 'README.md']) {
    await cp(join(ROOT, file), join(stage, file)).catch(() => {});
  }

  const tarball = join(out, `${name}.tar.gz`);
  // Plain, portable tar. macOS ships bsdtar, which has neither --sort nor
  // --mtime, and gzip stamps a time of its own regardless — so chasing a
  // byte-identical archive would mean bundling a tar implementation to
  // win an argument nobody is having. The sha256 below is taken from the
  // artifact that actually gets uploaded, which is what the formula needs.
  await run('tar', ['-czf', tarball, '-C', out, name]);

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(tarball)) hash.update(chunk);
  const sha = hash.digest('hex');
  const size = (await stat(tarball)).size;

  await rm(stage, { recursive: true, force: true });

  console.log(`\n  ${tarball}`);
  console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  sha256 ${sha}\n`);
  console.log('  formula fields:');
  console.log(
    `    url "https://github.com/briancorbin/teller/releases/download/v${version}/${name}.tar.gz"`,
  );
  console.log(`    sha256 "${sha}"\n`);

  await writeFile(join(out, 'sha256.txt'), `${sha}\n`);
}

main().catch((e) => {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
});
