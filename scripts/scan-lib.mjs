/**
 * Shared parsing logic for CAST Makeswift component registrations.
 *
 * Consumers provide a virtual filesystem (vfs) so the same parser works for:
 *   - the CLI script (fs-backed, reads local cast-website checkout)
 *   - the /api/components/refresh endpoint (GitHub-API-backed vfs)
 *
 * vfs shape:
 *   {
 *     listRegisterFiles(): string[]   // relative paths under REPO ROOT, matching /register\.(ts|tsx)$/, only under REGISTER_DIRS
 *     readFile(relPath): string       // throws if missing
 *     exists(relPath): boolean
 *   }
 */

export const REGISTER_DIRS = [
  'core/lib/makeswift/components',
  'core/components',
];

export const COMPONENTS_TS_PATH = 'core/lib/makeswift/components.ts';

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

function parseRegisterSrc(src) {
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

// Node's posix path.dirname / path.basename / path.join equivalents, kept
// local so this module has zero imports and runs identically in any
// JS environment (including where node:path isn't wired up).
function posixDirname(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : (i === 0 ? '/' : p.slice(0, i));
}
function posixBasename(p, ext) {
  const i = p.lastIndexOf('/');
  const base = i === -1 ? p : p.slice(i + 1);
  if (ext && base.endsWith(ext)) return base.slice(0, base.length - ext.length);
  return base;
}
function posixJoin(...parts) {
  const joined = parts.filter(Boolean).join('/').replace(/\/+/g, '/');
  // resolve simple '..' and '.' segments
  const stack = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { stack.pop(); continue; }
    stack.push(seg);
  }
  return (joined.startsWith('/') ? '/' : '') + stack.join('/');
}
function posixRelative(from, to) {
  const fParts = from.split('/').filter(Boolean);
  const tParts = to.split('/').filter(Boolean);
  let i = 0;
  while (i < fParts.length && i < tParts.length && fParts[i] === tParts[i]) i++;
  const ups = new Array(fParts.length - i).fill('..');
  return [...ups, ...tParts.slice(i)].join('/');
}

/**
 * Scan a virtual filesystem for CAST Makeswift component registrations.
 * Returns { generatedAt, castRepo, totalRegistrations, counts, components }.
 *
 * Throws if the components.ts file is missing (that means we're pointed at
 * the wrong repo — better to fail loudly than emit an empty manifest).
 */
export function scanComponents(vfs, opts = {}) {
  const castRepo = opts.castRepo || 'CAST-Lighting/cast-website';

  if (!vfs.exists(COMPONENTS_TS_PATH)) {
    throw new Error(`Missing ${COMPONENTS_TS_PATH} in the scan source. Wrong repo?`);
  }
  const componentsTs = vfs.readFile(COMPONENTS_TS_PATH);
  const importedRegisters = new Set();
  for (const line of componentsTs.split('\n')) {
    const m = line.match(/import\s+['"]([^'"]+)['"]/);
    if (m) importedRegisters.add(m[1]);
  }

  const registerFiles = vfs.listRegisterFiles();
  const manifest = [];

  for (const relFile of registerFiles) {
    const src = vfs.readFile(relFile);
    const rows = parseRegisterSrc(src);
    const dir = posixDirname(relFile);
    const base = posixBasename(relFile).replace(/\.(ts|tsx)$/, '');
    const relToLib = './' + posixRelative('core/lib/makeswift', posixJoin(dir, base));

    let isImported = importedRegisters.has(relToLib);
    if (!isImported) {
      const n1 = '/' + base + "'";
      const n2 = '/' + base + '"';
      if (componentsTs.includes(n1) || componentsTs.includes(n2)) isImported = true;
    }

    for (const row of rows) {
      let componentFile = '';
      let componentName = row.componentRef;

      if (row.componentRef.startsWith('./')) {
        const candidate = posixJoin(dir, row.componentRef.slice(2));
        for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
          if (vfs.exists(candidate + ext)) { componentFile = candidate + ext; break; }
        }
        componentName = posixBasename(row.componentRef);
      } else if (row.componentRef) {
        // Chase a top-of-file import for the identifier
        const impM = src.match(new RegExp(`import[\\s\\S]*?\\b${row.componentRef}\\b[\\s\\S]*?from\\s+['"]([^'"]+)['"]`));
        if (impM) {
          const ip = impM[1];
          let candidate = '';
          if (ip.startsWith('./')) candidate = posixJoin(dir, ip.slice(2));
          else if (ip.startsWith('~/')) candidate = posixJoin('core', ip.slice(2));
          else if (ip.startsWith('@/')) candidate = posixJoin('core', ip.slice(2));
          if (candidate) {
            for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts', '/client.tsx', '/client.ts']) {
              if (vfs.exists(candidate + ext)) { componentFile = candidate + ext; break; }
            }
          }
        }
      }

      manifest.push({
        makeswiftLabel: row.label,
        componentName,
        type: row.type,
        registerFile: relFile,
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

  return {
    generatedAt: new Date().toISOString(),
    castRepo,
    totalRegistrations: manifest.length,
    counts,
    components: manifest,
  };
}
