#!/usr/bin/env node
/**
 * Proves the SEO gate works. For each deliberate break it copies the project to a temp dir
 * (the real source is never edited, so every break is reverted automatically), applies the
 * break, then shows:
 *   1. PREVIEW build (`npm run build`, SITE_INDEXABLE unset) still exits 0 and prints the issue
 *      as "CRITICAL (preview: not blocking)"  -> previews always publish
 *   2. STRICT gate (`node scripts/seo-gate.mjs --strict`) exits 1 on the same build -> PR check / launch would block
 * Plus: the clean template passes strict, and a LAUNCH build (SITE_INDEXABLE=true) of the
 * untouched template fails because the example config values are placeholders.
 * Usage: npm run test:gate
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const edit = (dir, file, from, to) => {
  const f = join(dir, file), s = readFileSync(f, 'utf8');
  if (!s.includes(from)) throw new Error(`break anchor not found in ${file}: ${from}`);
  writeFileSync(f, s.replace(from, to));
};
const BREAKS = [
  { name: 'remove the canonical tag', rule: 'canonical-missing',
    apply: (d) => edit(d, 'src/components/SEOHead.astro', '{!noCanonical && <link rel="canonical" href={canonical} />}', '') },
  { name: 'hard-code a mismatched phone in the footer', rule: 'tel-mismatch',
    apply: (d) => edit(d, 'src/components/Footer.astro', '<a href={`tel:${SITE.phone.e164}`}>{SITE.phone.display}</a>', '<a href="tel:+15555550199">(555) 555-0199</a>') },
  { name: 'remove the <title>', rule: 'title-missing',
    apply: (d) => edit(d, 'src/components/SEOHead.astro', '<title>{title}</title>', '') },
  { name: 'hotlink an image from another host', rule: 'image-hotlink',
    apply: (d) => edit(d, 'src/pages/about.astro', '<h2>Contact details</h2>', '<img src="https://old-site.example.net/wp-content/uploads/van.jpg" alt="Van" width="800" height="600" /><h2>Contact details</h2>') },
  { name: 'link to a page that does not exist', rule: 'broken-internal-link',
    apply: (d) => edit(d, 'src/pages/index.astro', '<h2>Areas we serve</h2>', '<h2>Areas we serve</h2><a href="/services/does-not-exist/">Broken</a>') },
  { name: 'leave a working file in public/', rule: 'stray-file',
    apply: (d) => writeFileSync(join(d, 'public/notes.md'), '# internal notes\n') },
  { name: 'wrong html lang', rule: 'lang-mismatch',
    apply: (d) => edit(d, 'src/layouts/Base.astro', '<html lang={SITE.lang}>', '<html lang="es">') },
];

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'owd-gate-'));
  cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/](node_modules|dist|\.owd|\.astro|\.git|\.vercel)([\\/]|$)/.test(s.slice(ROOT.length)) });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}
function run(dir, cmd, env = {}) {
  const r = spawnSync('sh', ['-c', cmd], { cwd: dir, env: { ...process.env, SITE_INDEXABLE: '', ...env }, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const rows = [];
let ok = true;
const expect = (label, cond) => { if (!cond) ok = false; return cond ? 'yes' : 'NO (unexpected)'; };

// Clean template
{
  const d = project();
  const b = run(d, 'npm run build --silent');
  const s = run(d, 'node scripts/seo-gate.mjs --strict');
  rows.push(['clean template', 'n/a', `exit ${b.code} ${expect('', b.code === 0)}`, `exit ${s.code} ${expect('', s.code === 0) === 'yes' ? '(passes)' : 'NO (unexpected)'}`]);
  const l = run(d, 'npm run build --silent', { SITE_INDEXABLE: 'true' });
  const why = [...new Set([...l.out.matchAll(/FAIL\s+\[([a-z0-9-]+)\]/g)].map((m) => m[1]))].join(', ');
  rows.push(['LAUNCH build of the untouched template (SITE_INDEXABLE=true)', why, 'n/a', `exit ${l.code} ${expect('', l.code === 1) === 'yes' ? '(launch blocked)' : 'NO (unexpected)'}`]);
  rmSync(d, { recursive: true, force: true });
}
// Launch build with real-looking (test-only) facts and a GTM ID: proves launch CAN pass.
{
  const d = project();
  const f = join(d, 'src/config/site.ts');
  let s = readFileSync(f, 'utf8');
  for (const [from, to] of [
    ["'https://www.example-plumbing.com'", "'https://www.acme-test-plumbing.com'"], ["'Example Plumbing Co.'", "'Acme Test Plumbing'"],
    ["'Example Plumbing Co. LLC'", "'Acme Test Plumbing LLC'"], ["'Fast, honest plumbing repair'", "'Honest plumbing repair'"],
    ["'Example Plumbing Co. is a sample local plumbing company used to demonstrate the OWD starter template.'", "'Acme Test Plumbing repairs and installs plumbing for homes.'"],
    ["{ display: '(555) 555-0100', e164: '+15555550100' }", "{ display: '(602) 333-4444', e164: '+16023334444' }"],
    ["'hello@example-plumbing.com'", "'office@acme-test-plumbing.com'"], ["city: 'Exampleville', region: 'ST', postal: '00000'", "city: 'Phoenix', region: 'AZ', postal: '85004'"],
    ["primaryArea: 'Exampleville, ST'", "primaryArea: 'Phoenix, AZ'"], ["{ name: 'Sample Town', slug: 'sample-town' }", "{ name: 'Tempe', slug: 'tempe' }"],
    ["['https://www.facebook.com/example']", "['https://www.facebook.com/acmetestplumbing']"],
  ]) { if (!s.includes(from)) throw new Error('config anchor missing: ' + from); s = s.replace(from, to); }
  writeFileSync(f, s);
  const l = run(d, 'npm run build --silent', { SITE_INDEXABLE: 'true', PUBLIC_GTM_ID: 'GTM-TEST000' });
  const robots = existsSync(join(d, 'dist/robots.txt')) ? readFileSync(join(d, 'dist/robots.txt'), 'utf8').trim().replace(/\n+/g, ' / ') : '';
  const home = existsSync(join(d, 'dist/index.html')) ? readFileSync(join(d, 'dist/index.html'), 'utf8') : '';
  rows.push(['LAUNCH build with filled test config + GTM ID', 'n/a', 'n/a', `exit ${l.code} ${expect('', l.code === 0) === 'yes' ? '(launch passes)' : 'NO (unexpected)'}; robots: "${robots}"; meta noindex: ${/name="robots"/.test(home) ? 'present' : 'absent'}; GTM: ${home.includes('GTM-TEST000') ? 'present' : 'absent'}`]);
  if (l.code !== 0) console.log(l.out.slice(-3000));
  rmSync(d, { recursive: true, force: true });
}
for (const br of BREAKS) {
  const d = project();
  br.apply(d);
  const b = run(d, 'npm run build --silent');
  const s = run(d, 'node scripts/seo-gate.mjs --strict');
  const labeled = new RegExp(`CRITICAL \\(preview: not blocking\\)\\s+\\[${br.rule}\\]`).test(b.out);
  const failed = new RegExp(`FAIL\\s+\\[${br.rule}\\]`).test(s.out);
  rows.push([br.name, br.rule, `exit ${b.code}, labeled critical: ${expect('', b.code === 0 && labeled)}`, `exit ${s.code}, FAIL [${br.rule}]: ${expect('', s.code === 1 && failed)}`]);
  const line = s.out.split('\n').find((x) => x.includes(`[${br.rule}]`));
  if (line) rows.push(['', '', '', `  ${line.trim().slice(0, 150)}`]);
  rmSync(d, { recursive: true, force: true });
}
console.log('\nOWD SEO GATE SELF-TEST (source never modified; each break runs in a temp copy)\n');
console.log('| Break | Rule | Preview build (npm run build) | Strict gate (seo:strict / launch) |');
console.log('|---|---|---|---|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
console.log(`\n${ok ? 'SELF-TEST PASSED' : 'SELF-TEST FAILED'}`);
process.exit(ok ? 0 : 1);
