/**
 * GitHub-API-backed scanner for CAST Makeswift components.
 *
 * Used by POST /api/components/refresh so users can force a live re-scan
 * against CAST-Lighting/cast-website master without a local checkout and
 * without waiting on a manual `node scripts/scan-cast-components.mjs` run.
 *
 * Requires env var GITHUB_PAT with `contents:read` on CAST-Lighting/cast-website.
 * The git-tree API returns every file in one call, so we then only fetch the
 * source of the register files we actually need to parse (plus components.ts).
 */

import fetch from 'node-fetch';
import { scanComponents, REGISTER_DIRS, COMPONENTS_TS_PATH } from './scan-lib.mjs';

const CAST_REPO = 'CAST-Lighting/cast-website';
// Overridable in case CAST ever forks off a different working branch, but
// by default we resolve the repo's actual default branch at call time so we
// never mis-scan a stale name (main vs master, etc).
const CAST_BRANCH_OVERRIDE = process.env.CAST_BRANCH || '';
const GH = 'https://api.github.com';

function ghHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cast-bug-reporter-refresh',
  };
}

async function ghJson(url, pat) {
  const r = await fetch(url, { headers: ghHeaders(pat) });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`GitHub ${r.status} on ${url}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Fetch a raw blob by SHA. The contents endpoint 404s in some setups even
 * when the tree lists the file (observed on CAST-Lighting/cast-website),
 * so we pin the blob SHA from the tree and fetch it via the blobs endpoint.
 * Blobs are base64-encoded and cap at ~100MB — all register files are tiny.
 */
async function ghReadBlob(pat, sha) {
  const url = `${GH}/repos/${CAST_REPO}/git/blobs/${sha}`;
  const data = await ghJson(url, pat);
  if (typeof data.content !== 'string') {
    throw new Error(`Blob ${sha} missing content`);
  }
  return Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
}

export async function scanFromGithub() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error('GITHUB_PAT env var not set');

  // 1. Resolve the working branch. Prefer the CAST_BRANCH env override,
  //    otherwise ask the repo what its default branch is (main vs master).
  let branch = CAST_BRANCH_OVERRIDE;
  if (!branch) {
    const repoInfo = await ghJson(`${GH}/repos/${CAST_REPO}`, pat);
    branch = repoInfo?.default_branch;
    if (!branch) throw new Error(`Could not resolve default branch for ${CAST_REPO}`);
  }

  // 2. Resolve the branch to a commit SHA so we can pull the full tree in one call.
  const branchInfo = await ghJson(`${GH}/repos/${CAST_REPO}/branches/${branch}`, pat);
  const commitSha = branchInfo?.commit?.sha;
  if (!commitSha) throw new Error(`Could not resolve ${branch} to a commit SHA`);

  // 3. Grab the full recursive tree.
  const tree = await ghJson(
    `${GH}/repos/${CAST_REPO}/git/trees/${commitSha}?recursive=1`,
    pat
  );
  if (tree.truncated) {
    // CAST repo isn't near the 100k-entry / 7MB limit, but if this ever trips
    // we'd need to page. Fail loud rather than silently miss files.
    throw new Error('GitHub tree response was truncated — scan cannot be trusted');
  }

  // Build a path -> blob-sha map for every blob in the tree. We fetch by SHA
  // rather than by path+ref because the contents API is finicky here.
  const shaByPath = new Map();
  for (const node of tree.tree || []) {
    if (node.type === 'blob') shaByPath.set(node.path, node.sha);
  }
  const allPaths = new Set(shaByPath.keys());

  // 4. Enumerate register files under the scan dirs.
  const registerFiles = [];
  for (const p of allPaths) {
    if (!REGISTER_DIRS.some((d) => p.startsWith(d + '/'))) continue;
    if (!/register\.(ts|tsx)$/.test(p)) continue;
    registerFiles.push(p);
  }

  // 5. Fetch source for components.ts and every register file in parallel.
  //    Blob fetches by SHA are cache-friendly on GitHub's side and immune
  //    to branch-name resolution issues.
  const toFetch = new Set([COMPONENTS_TS_PATH, ...registerFiles]);
  const fileCache = new Map();
  const fetchFailures = [];
  await Promise.all(
    [...toFetch].map(async (p) => {
      const sha = shaByPath.get(p);
      if (!sha) {
        fetchFailures.push(`${p} (not in tree)`);
        return;
      }
      try {
        fileCache.set(p, await ghReadBlob(pat, sha));
      } catch (e) {
        fetchFailures.push(`${p}: ${e.message}`);
        console.error(`[refresh] failed to fetch ${p}: ${e.message}`);
      }
    })
  );
  if (fetchFailures.length) {
    // Fail loud on any missing register file — a partial scan would silently
    // drop components from the manifest, which is worse than no refresh.
    throw new Error(
      `Failed to fetch ${fetchFailures.length} source file(s): ${fetchFailures.slice(0, 3).join('; ')}${fetchFailures.length > 3 ? '; ...' : ''}`
    );
  }

  // 5. Build the vfs. readFile pulls from the cache; if the parser needs
  //    componentFile resolution (which checks a bunch of candidate paths),
  //    that only calls exists() — no additional network traffic.
  const vfs = {
    listRegisterFiles() { return registerFiles; },
    readFile(relPath) {
      if (fileCache.has(relPath)) return fileCache.get(relPath);
      throw new Error(`vfs.readFile: not cached: ${relPath}`);
    },
    exists(relPath) { return allPaths.has(relPath); },
  };

  return scanComponents(vfs, { castRepo: CAST_REPO });
}
