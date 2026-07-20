#!/usr/bin/env node
/**
 * Scan a local CAST codebase checkout for Makeswift-registered components.
 *
 * Usage:
 *   CAST_ROOT=/path/to/cast-website node scripts/scan-cast-components.mjs
 *   node scripts/scan-cast-components.mjs /path/to/cast-website
 *
 * Output:
 *   Writes ./component-manifest.json (in the repo root).
 *
 * The manifest is committed and served as the default data source by
 * GET /api/components. Users can also force a live re-scan against the
 * GitHub master branch via POST /api/components/refresh (which uses the
 * same parsing logic in scripts/scan-lib.mjs — no fs required).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanComponents, REGISTER_DIRS } from './scan-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const ROOT =
  process.argv[2] ||
  process.env.CAST_ROOT ||
  process.env.CAST_WEBSITE_PATH ||
  path.resolve(REPO_ROOT, '..', 'cast-website');

if (!fs.existsSync(ROOT)) {
  console.error(`CAST codebase not found at: ${ROOT}`);
  console.error('Pass the path as an argument or set CAST_ROOT.');
  process.exit(1);
}

console.log(`Scanning CAST codebase at: ${ROOT}`);

// Build an fs-backed vfs for scan-lib. Paths are POSIX-style relative to ROOT.
function walk(dir, files = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return files;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, files);
    else if (/register\.(ts|tsx)$/.test(entry.name)) files.push(rel.replace(/\\/g, '/'));
  }
  return files;
}

const vfs = {
  listRegisterFiles() {
    const out = [];
    for (const d of REGISTER_DIRS) walk(d, out);
    return out;
  },
  readFile(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  },
  exists(relPath) {
    return fs.existsSync(path.join(ROOT, relPath));
  },
};

const manifest = scanComponents(vfs);
console.log(`Total registrations found: ${manifest.totalRegistrations}`);
console.log('Status counts:', manifest.counts);

const out = path.join(REPO_ROOT, 'component-manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${out}`);
