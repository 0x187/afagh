#!/usr/bin/env node
/**
 * API parity harness — compares the legacy Next.js API against the Go /api/v2
 * API route-by-route while both services are up (strangler window).
 *
 * Usage:
 *   OLD_BASE=http://127.0.0.1:8080 \
 *   NEW_BASE=http://127.0.0.1:8091/api/v2 \
 *   COOKIE='token=…; __Host-afagh_session=…' \
 *   node tools/parity-check.mjs [routes.txt]
 *
 * routes.txt: one entry per line. Fields are separated by "|":
 *   NEWPATH [| OLDPATH] [| excl.key1,excl.key2]
 * NEWPATH is appended to NEW_BASE, OLDPATH (defaults to NEWPATH) to OLD_BASE.
 * Exclusions are dot paths into the JSON body that are known-volatile
 * (timestamps, generated ids), e.g.:
 *   /student/dashboard|/api/student/dashboard|data.generatedAt,data.term.startDate
 *
 * A route passes when status codes match and the canonical JSON bodies are
 * deep-equal after dropping excluded keys. Non-JSON bodies are compared as text.
 */
import { readFileSync } from 'node:fs';

const OLD_BASE = process.env.OLD_BASE ?? 'http://127.0.0.1:8080';
const NEW_BASE = process.env.NEW_BASE ?? 'http://127.0.0.1:8091/api/v2';
const COOKIE = process.env.COOKIE ?? '';
const routesFile = process.argv[2];
if (!routesFile) {
  console.error('usage: node tools/parity-check.mjs <routes.txt>');
  process.exit(2);
}

const routes = readFileSync(routesFile, 'utf-8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [newPath, oldPath, excl] = l.split('|');
    return {
      path: newPath,
      oldPath: oldPath || newPath,
      exclude: (excl ?? '').split(',').filter(Boolean),
    };
  });

function dropKeys(node, exclude) {
  if (!exclude.length) return node;
  const walk = (n, path) => {
    if (Array.isArray(n)) return n.map((v) => walk(v, path));
    if (n && typeof n === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(n)) {
        const p = path ? `${path}.${k}` : k;
        if (exclude.includes(p)) continue;
        out[k] = walk(v, p);
      }
      return out;
    }
    return n;
  };
  return walk(node, '');
}

async function fetchOne(base, path) {
  const res = await fetch(base + path, { headers: { cookie: COOKIE, accept: 'application/json' } });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

let pass = 0;
const failures = [];
for (const { path, oldPath, exclude } of routes) {
  const [oldRes, newRes] = await Promise.all([fetchOne(OLD_BASE, oldPath), fetchOne(NEW_BASE, path)]);
  const sameStatus = oldRes.status === newRes.status;
  const sameBody =
    JSON.stringify(dropKeys(oldRes.body, exclude)) === JSON.stringify(dropKeys(newRes.body, exclude));
  if (sameStatus && sameBody) {
    pass++;
  } else {
    failures.push({ path, oldStatus: oldRes.status, newStatus: newRes.status });
    console.error(`MISMATCH ${path} (old: ${oldPath})  old=${oldRes.status} new=${newRes.status}`);
  }
}
console.log(`parity: ${pass}/${routes.length} routes match`);
if (failures.length) process.exit(1);
