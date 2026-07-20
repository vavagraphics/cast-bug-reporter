#!/usr/bin/env node
/**
 * Scan CAST codebase for Makeswift-registered components.
 *
 * Usage:
 *   CAST_ROOT=/path/to/cast-website node scripts/scan-cast-components.mjs
 *   node scripts/scan-cast-components.mjs /path/to/cast-website
 *
 * Output:
 *   Writes ./component-manifest.json (in the repo root).
 *
 * The manifest is committed and served by the /api/components endpoint.
 * Re-run whenever the CAST codebase adds, removes, or renames a Makeswift
 * registration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const REGISTER_DIRS = [
  'core/lib/makeswift/components',
  'core/components',
];
const COMPONENTS_TS = path.join(ROOT, 'core/lib/makeswift/components.ts');

if (!fs.existsSync(COMPONENTS_TS)) {
  console.error(`Missing ${COMPONENTS_TS}. Wrong CAST_ROOT?`);
  process.exit(1);
}

const componentsTs = fs.readFileSync(COMPONENTS_TS, 'utf8');
const importedRegisters = new Set();
for (const line of componentsTs.split('\n')) {
  const m = line.match(/import\s+['"]([^'"]+)['"]/);
  if (m) importedRegisters.add(m[1]);
}

function walk(dir, files = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return files;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, files);
    else if (/register\.(ts|tsx)$/.test(entry.name)) files.push(rel);
  }
  return files;
}

function findCalls(src) {
  const calls = [];
  const needle = 'runtime.registerComponent';
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    const j = src.indexOf('(', i);
    if (j === -1) break;
    let depth = 0;
    for (let k = j; k < src.length; k++) {
      const c = src[k];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          calls.push(src.slice(j + 1, k));
          i = k + 1;
          break;
        }
      }
    }
    if (depth !== 0) break;
  }
  return calls;
}

function splitArgs(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let inStr = null;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (inStr) {
      if (c === '\\') { k++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, k));
      start = k + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map(s => s.trim());
}

function parseRegister(relPath) {
  const abs = path.join(ROOT, relPath);
  const src = fs.readFileSync(abs, 'utf8');
  const rows = [];

  const constTypes = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g)) {
    if (!(m[1] in constTypes)) constTypes[m[1]] = m[2];
  }
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g)) {
    constTypes[m[1]] = m[2];
  }

  const calls = findCalls(src);
  for (const call of calls) {
    const args = splitArgs(call);
    if (args.length < 2) continue;
    const arg1 = args[0];
    const arg2 = args[1];

    let componentRef = '';
    const lazyM = arg1.match(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (lazyM) componentRef = lazyM[1];
    else {
      const idM = arg1.match(/^([A-Za-z_][\w$]*)/);
      if (idM) componentRef = idM[1];
    }

    let type = '';
    const typeStr = arg2.match(/type\s*:\s*['"]([^'"]+)['"]/);
    if (typeStr) type = typeStr[1];
    else {
      const typeConst = arg2.match(/type\s*:\s*(\w+(?:\.\w+)?)/);
      if (typeConst) {
        const t = typeConst[1];
        if (constTypes[t]) type = constTypes[t];
        else if (t.startsWith('MakeswiftComponentType.')) type = `Makeswift:${t.split('.')[1]}`;
        else type = t;
      }
    }

    let label = '';
    const labelStr = arg2.match(/label\s*:\s*['"]([^'"]+)['"]/);
    if (labelStr) label = labelStr[1];
    else {
      const labelConst = arg2.match(/label\s*:\s*(\w+)/);
      if (labelConst && constTypes[labelConst[1]]) label = constTypes[labelConst[1]];
    }

    const hidden = /hidden\s*:\s*true/.test(arg2);
    rows.push({ type, label, componentRef, hidden });
  }
  return rows;
}

const registerFiles = [];
for (const d of REGISTER_DIRS) walk(d, registerFiles);

const manifest = [];
for (const relFile of registerFiles) {
  const rows = parseRegister(relFile);
  for (const row of rows) {
    const dir = path.dirname(relFile);
    const base = path.basename(relFile).replace(/\.(ts|tsx)$/, '');
    const relToLib = './' + path.relative('core/lib/makeswift', path.join(dir, base)).replace(/\\/g, '/');
    let isImported = importedRegisters.has(relToLib);
    if (!isImported) {
      const n1 = '/' + base + "'";
      const n2 = '/' + base + '"';
      if (componentsTs.includes(n1) || componentsTs.includes(n2)) isImported = true;
    }

    let componentFile = '';
    let componentName = row.componentRef;
    if (row.componentRef.startsWith('./')) {
      const candidate = path.join(dir, row.componentRef.slice(2));
      for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
        const abs = path.join(ROOT, candidate + ext);
        if (fs.existsSync(abs)) { componentFile = (candidate + ext).replace(/\\/g, '/'); break; }
      }
      componentName = path.basename(row.componentRef);
    } else if (row.componentRef) {
      const src = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
      const impM = src.match(new RegExp(`import[\\s\\S]*?\\b${row.componentRef}\\b[\\s\\S]*?from\\s+['"]([^'"]+)['"]`));
      if (impM) {
        let ip = impM[1];
        let candidate = '';
        if (ip.startsWith('./')) candidate = path.join(dir, ip.slice(2));
        else if (ip.startsWith('~/')) candidate = path.join('core', ip.slice(2));
        else if (ip.startsWith('@/')) candidate = path.join('core', ip.slice(2));
        if (candidate) {
          for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts', '/client.tsx', '/client.ts']) {
            const abs = path.join(ROOT, candidate + ext);
            if (fs.existsSync(abs)) { componentFile = (candidate + ext).replace(/\\/g, '/'); break; }
          }
        }
      }
    }

    manifest.push({
      makeswiftLabel: row.label,
      componentName,
      type: row.type,
      registerFile: relFile.replace(/\\/g, '/'),
      componentFile,
      hidden: row.hidden,
      isImported,
      status: row.hidden ? 'Hidden' : (isImported ? 'Live' : 'Deprecated'),
    });
  }
}

manifest.sort((a, b) =>
  (a.makeswiftLabel || a.componentName || '').localeCompare(b.makeswiftLabel || b.componentName || '')
);

const counts = manifest.reduce((acc, r) => (acc[r.status] = (acc[r.status] || 0) + 1, acc), {});
console.log(`Total registrations found: ${manifest.length}`);
console.log('Status counts:', counts);

const out = path.join(REPO_ROOT, 'component-manifest.json');
fs.writeFileSync(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  castRepo: 'CAST-Lighting/cast-website',
  totalRegistrations: manifest.length,
  counts,
  components: manifest,
}, null, 2));
console.log(`Wrote ${out}`);
