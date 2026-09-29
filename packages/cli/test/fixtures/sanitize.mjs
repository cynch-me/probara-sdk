#!/usr/bin/env node
// Scripted sanitization of generated fixture output. Only plain string replacements, never manual edits.
//
// Usage: node sanitize.mjs <dialect> <workdir> [<workdir>...]
//
// Rewrites, in place, every generated text file under <dialect>/ (XML, .txt, .md; source/ is skipped):
//   <workdir>/rest        -> /work/<dialect>/rest   (each workdir, longest first; realpath variants too)
//   os.tmpdir()           -> /tmp
//   os.homedir()          -> /home/runner
//   Homebrew prefix       -> /usr/local            ($HOMEBREW_PREFIX, else the Apple Silicon default)
//   os.hostname()         -> ci-host                (full name, then the short name before the first dot)
//   os.userInfo().username -> runner
// Machine values come from the running environment and the arguments; none are hardcoded here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [dialect, ...workdirs] = process.argv.slice(2);
if (!dialect || workdirs.length === 0) {
  console.error('usage: node sanitize.mjs <dialect> <workdir> [<workdir>...]');
  process.exit(2);
}

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));
const dialectDir = path.join(fixturesDir, dialect);
if (!fs.existsSync(dialectDir)) {
  console.error(`unknown dialect directory: ${dialectDir}`);
  process.exit(2);
}

const stripSlash = (p) => p.replace(/\/+$/, '');

// Each path in its given form, its resolved form, and with/without the macOS `/private` prefix.
function variants(p) {
  const out = new Set([stripSlash(path.resolve(p))]);
  try {
    out.add(stripSlash(fs.realpathSync(p)));
  } catch {
    // The path may no longer exist; the given form is still replaced.
  }
  for (const v of [...out]) {
    if (v.startsWith('/private/')) out.add(v.slice('/private'.length));
    else out.add(`/private${v}`);
  }
  return [...out];
}

const replacements = [];
const workTarget = `/work/${dialect}`;
for (const dir of workdirs) for (const v of variants(dir)) replacements.push([v, workTarget]);
for (const v of variants(os.tmpdir())) replacements.push([v, '/tmp']);
// Longest prefix first so a nested workdir wins over an enclosing one.
replacements.sort((a, b) => b[0].length - a[0].length);

replacements.push([stripSlash(os.homedir()), '/home/runner']);
replacements.push([stripSlash(process.env.HOMEBREW_PREFIX || path.join('/opt', 'homebrew')), '/usr/local']);
const host = os.hostname();
replacements.push([host, 'ci-host']);
const shortHost = host.split('.')[0];
if (shortHost !== host && shortHost.length > 3) replacements.push([shortHost, 'ci-host']);
const user = os.userInfo().username;
if (user.length > 2) replacements.push([user, 'runner']);

const TEXT_EXTENSIONS = new Set(['.xml', '.txt', '.md']);

function* generatedFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(dialectDir, 'source')) continue;
      yield* generatedFiles(full);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

let changed = 0;
for (const file of generatedFiles(dialectDir)) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [from, to] of replacements) after = after.split(from).join(to);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed += 1;
    console.log(`sanitized ${path.relative(fixturesDir, file)}`);
  }
}
console.log(`${dialect}: ${changed} file(s) sanitized`);
