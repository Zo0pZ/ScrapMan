#!/usr/bin/env node
/* ScrapMan — service worker precache drift check.
 *
 * sw.js keeps a hand-written ASSETS list. Nothing has ever verified that list, and it
 * had already drifted: a shipped file could be renamed or added and the offline shell
 * would quietly lose it (or 404 on install, because addAll() rejects the whole batch).
 *
 * Two checks, both fatal:
 *   1. Every local entry in ASSETS exists on disk.
 *   2. Every file that belongs to the app shell is listed in ASSETS — root-level
 *      scripts and stylesheets, the manifest, the logo SVGs, and (once Phase 2 lands)
 *      everything under src/.
 *
 * CDN entries (http/https) are skipped: they are other people's files.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readAssets() {
  const sw = readFileSync(join(root, "sw.js"), "utf8");
  const block = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!block) {
    throw new Error("Could not find `const ASSETS = [...]` in sw.js");
  }
  return [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/* "./app.js" and "app.js" are the same file to the browser. */
function normalize(entry) {
  return entry.replace(/^\.\//, "");
}

function isRemote(entry) {
  return /^https?:\/\//.test(entry);
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/* Files that make up the app shell and must survive offline. */
function shellFiles() {
  const rootFiles = readdirSync(root).filter((name) => {
    const full = join(root, name);
    if (!statSync(full).isFile()) return false;
    if (name === "sw.js") return false; // the service worker can't precache itself
    return /\.(js|css|html|json|svg)$/.test(name);
  });
  const srcFiles = walk(join(root, "src")).map((full) =>
    relative(root, full).split(sep).join("/")
  );
  return [...rootFiles, ...srcFiles];
}

const assets = readAssets();
const localAssets = assets.filter((entry) => !isRemote(entry)).map(normalize);
const problems = [];

for (const entry of localAssets) {
  if (!existsSync(join(root, entry))) {
    problems.push(`ASSETS lists "${entry}" but that file does not exist`);
  }
}

const listed = new Set(localAssets);
for (const file of shellFiles()) {
  if (!listed.has(file)) {
    problems.push(`"${file}" ships with the app but is missing from sw.js ASSETS`);
  }
}

if (problems.length) {
  console.error("Service worker precache check failed:\n");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(
    `\nFix: update ASSETS in sw.js (and bump CACHE so returning visitors pick the change up).`
  );
  process.exit(1);
}

console.log(
  `Service worker precache OK — ${localAssets.length} local assets listed, all present, shell fully covered.`
);
