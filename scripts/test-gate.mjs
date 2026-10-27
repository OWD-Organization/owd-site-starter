#!/usr/bin/env node
/**
 * Proves the SEO gate's two modes. Each case runs in a temp copy (source is never edited).
 *
 *   non-production (VERCEL_ENV unset or preview): every issue is a warning, exit 0
 *   production (VERCEL_ENV=production): exit 1 only for the critical rules in seo-blockers.mjs
 *
 * Usage: npm run test:gate
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const rows = [];
let ok = true;
const expect = (cond) => { if (!cond) ok = false; return cond ? 'yes' : 'NO'; };
const failRule = (out, rule) => new RegExp(`FAIL\\s+\\[${rule}\\]`).test(out);
const warnRule = (out, rule) => new RegExp(`WARN\\s+\\[${rule}\\]`).test(out);

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'owd-gate-'));
  cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/](node_modules|dist|\.owd|\.astro|\.git|\.vercel)([\\/]|$)/.test(s.slice(ROOT.length)) });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}
function run(dir, cmd, env = {}) {
  const r = spawnSync('sh', ['-c', cmd], {
    cwd: dir,
    env: { ...process.env, SITE_INDEXABLE: '', VERCEL_ENV: '', PUBLIC_GTM_ID: '', PUBLIC_GA4_ID: '', ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}
function record(name, rule, detail) {
  rows.push([name, rule, detail]);
}
function fillRealConfig(dir) {
  const f = join(dir, 'src/config/site.ts');
  let s = readFileSync(f, 'utf8');
  for (const [from, to] of [
    ["'https://www.example-plumbing.com'", "'https://www.acme-test-plumbing.com'"],
    ["'Example Plumbing Co.'", "'Acme Test Plumbing'"],
    ["'Example Plumbing Co. LLC'", "'Acme Test Plumbing LLC'"],
    ["'Fast, honest plumbing repair'", "'Honest plumbing repair'"],
    ["'Example Plumbing Co. is a sample local plumbing company used to demonstrate the OWD starter template.'", "'Acme Test Plumbing repairs and installs plumbing for homes.'"],
    ["{ display: '(555) 555-0100', e164: '+15555550100' }", "{ display: '(602) 333-4444', e164: '+16023334444' }"],
    ["'hello@example-plumbing.com'", "'office@acme-test-plumbing.com'"],
    ["city: 'Exampleville', region: 'ST', postal: '00000'", "city: 'Phoenix', region: 'AZ', postal: '85004'"],
    ["primaryArea: 'Exampleville, ST'", "primaryArea: 'Phoenix, AZ'"],
    ["{ name: 'Sample Town', slug: 'sample-town' }", "{ name: 'Tempe', slug: 'tempe' }"],
    ["['https://www.facebook.com/example']", "['https://www.facebook.com/acmetestplumbing']"],
  ]) {
    if (!s.includes(from)) throw new Error('config anchor missing: ' + from);
    s = s.replace(from, to);
  }
  writeFileSync(f, s);
}
function snap(dir) {
  const dest = join(dir, '.snap-dist');
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(dir, 'dist'), dest, { recursive: true });
  return { dist: dest, vercel: readFileSync(join(dir, 'vercel.json'), 'utf8') };
}
function restore(dir, saved) {
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  cpSync(saved.dist, join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'vercel.json'), saved.vercel);
}
function gate(dir, env) {
  return run(dir, 'node scripts/seo-gate.mjs', env);
}
function editDist(dir, file, from, to) {
  const f = join(dir, 'dist', file);
  const s = readFileSync(f, 'utf8');
  if (!s.includes(from)) throw new Error(`dist anchor missing in ${file}: ${from.slice(0, 80)}`);
  writeFileSync(f, s.replace(from, to));
}

// 1. Stock template, not production: warnings, exit 0. Same dist in production: fail on placeholders.
{
  const d = project();
  const b = run(d, 'npm run build --silent');
  record('template, local / preview (no VERCEL_ENV)', 'placeholder-output', `exit ${b.code} ${expect(b.code === 0 && warnRule(b.out, 'placeholder-output') && !failRule(b.out, 'placeholder-output'))} (warn, not blocked)`);
  const localLaunch = gate(d, { SITE_INDEXABLE: 'true' });
  record('template, SITE_INDEXABLE=true, VERCEL_ENV unset, no GTM', 'placeholder-output', `exit ${localLaunch.code} ${expect(localLaunch.code === 0 && !/^\s*FAIL\s+\[/m.test(localLaunch.out))} (still not blocked)`);
  const prod = gate(d, { VERCEL_ENV: 'production' });
  record('template, VERCEL_ENV=production', 'placeholder-output', `exit ${prod.code} ${expect(prod.code === 1 && failRule(prod.out, 'placeholder-output') && prod.out.includes('Fix:'))} (blocked, Fix: present)`);
  if (prod.code !== 1) console.log(prod.out.slice(-2500));
  rmSync(d, { recursive: true, force: true });
}

// 2. Real-looking facts, production, no GTM: must pass. Titles and GTM stay warnings.
{
  const d = project();
  fillRealConfig(d);
  const b = run(d, 'npm run build --silent', { VERCEL_ENV: 'production', SITE_INDEXABLE: 'true' });
  const passed = b.code === 0 && !/^\s*FAIL\s+\[/m.test(b.out) && warnRule(b.out, 'gtm-id-missing');
  record('production + real config + SITE_INDEXABLE=true, no GTM', 'gtm-id-missing', `exit ${b.code} ${expect(passed)} (GTM is a warning)`);
  if (!passed) console.log(b.out.slice(-4000));
  const saved = snap(d);
  const prod = { VERCEL_ENV: 'production', SITE_INDEXABLE: 'true' };

  const cases = [
    ['inject noindex while indexable', 'noindex-on-launch', () => editDist(d, 'about/index.html', '</head>', '<meta name="robots" content="noindex, nofollow" /></head>')],
    ['canonical on vercel.app', 'canonical-host', () => editDist(d, 'about/index.html', 'https://www.acme-test-plumbing.com/about/', 'https://acme-test.vercel.app/about/')],
    ['sitemap URL on the wrong domain', 'sitemap-host', () => {
      const xmls = readdirSync(join(d, 'dist')).filter((n) => n.endsWith('.xml'));
      if (!xmls.length) throw new Error('no sitemap xml in dist');
      for (const n of xmls) {
        const f = join(d, 'dist', n);
        writeFileSync(f, readFileSync(f, 'utf8').replaceAll('https://www.acme-test-plumbing.com/', 'https://acme-test.vercel.app/'));
      }
    }],
    ['robots.txt still disallows everything', 'robots-disallow-launch', () => writeFileSync(join(d, 'dist/robots.txt'), 'User-agent: *\nDisallow: /\n')],
    ['X-Robots-Tag on the real domain', 'x-robots-on-real-domain', () => {
      const vj = JSON.parse(readFileSync(join(d, 'vercel.json'), 'utf8'));
      vj.headers.push({ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] });
      writeFileSync(join(d, 'vercel.json'), JSON.stringify(vj, null, 2));
    }],
    ['broken internal link', 'broken-internal-link', () => editDist(d, 'index.html', '</body>', '<a href="/services/does-not-exist/">Broken</a></body>')],
    ['key page missing', 'key-page-missing', () => rmSync(join(d, 'dist/contact/index.html'))],
    ['homepage did not render', 'render-failure', () => rmSync(join(d, 'dist/index.html'))],
    ['TODO left in the page', 'placeholder-output', () => editDist(d, 'about/index.html', '</body>', 'TODO</body>')],
    ['form action is #', 'dead-destination', () => editDist(d, 'contact/index.html', '</body>', '<form action="#"></form></body>')],
    ['live secret in the HTML', 'secret-exposed', () => editDist(d, 'about/index.html', '</body>', 'sk_live_51Abcdefghijklmnop</body>')],
    ['favicon.ico removed', 'favicon-missing', () => rmSync(join(d, 'dist/favicon.ico'))],
    ['branded 404 removed', 'branded-404-missing', () => rmSync(join(d, 'dist/404.html'))],
    ['title removed (warning only)', 'title-missing', () => {
      const f = join(d, 'dist/about/index.html');
      const s = readFileSync(f, 'utf8');
      const title = s.match(/<title>[^<]*<\/title>/);
      if (!title) throw new Error('no title on about page');
      writeFileSync(f, s.replace(title[0], ''));
    }],
  ];

  for (const [name, rule, apply] of cases) {
    restore(d, saved);
    apply();
    const r = gate(d, prod);
    if (rule === 'title-missing') {
      const good = r.code === 0 && warnRule(r.out, 'title-missing') && !/^\s*FAIL\s+\[/m.test(r.out);
      record(name, rule, `exit ${r.code} ${expect(good)} (warning, production still passes)`);
      if (!good) console.log(r.out.slice(-2000));
    } else {
      const good = r.code === 1 && failRule(r.out, rule) && r.out.includes('Fix:');
      record(name, rule, `exit ${r.code} ${expect(good)} (production FAIL)`);
      if (!good) console.log(`\n--- ${name} ---\n` + r.out.slice(-2000));
    }
  }

  restore(d, saved);
  editDist(d, 'index.html', '</body>', '<a href="/services/does-not-exist/">Broken</a></body>');
  const preview = gate(d, { VERCEL_ENV: 'preview', SITE_INDEXABLE: 'true' });
  record('same broken link, VERCEL_ENV=preview', 'broken-internal-link', `exit ${preview.code} ${expect(preview.code === 0 && warnRule(preview.out, 'broken-internal-link') && !failRule(preview.out, 'broken-internal-link'))} (warning only)`);
  rmSync(d, { recursive: true, force: true });
}

// 3. Production build that is NOT indexable: hidden pages pass. Stripping noindex or Disallow fails.
{
  const d = project();
  fillRealConfig(d);
  const b = run(d, 'npm run build --silent', { VERCEL_ENV: 'production' });
  record('production, SITE_INDEXABLE unset, real config', 'n/a', `exit ${b.code} ${expect(b.code === 0 && !/^\s*FAIL\s+\[/m.test(b.out))} (noindex is correct)`);
  if (b.code !== 0) console.log(b.out.slice(-3000));
  const saved = snap(d);
  {
    const f = join(d, 'dist/index.html');
    const s = readFileSync(f, 'utf8');
    if (!/name="robots"[^>]*noindex/i.test(s)) throw new Error('expected a noindex robots meta on the homepage');
    writeFileSync(f, s.replace(/<meta name="robots"[^>]*>/i, ''));
  }
  const open = gate(d, { VERCEL_ENV: 'production' });
  record('production, flag off, but page has no noindex', 'preview-indexable', `exit ${open.code} ${expect(open.code === 1 && failRule(open.out, 'preview-indexable'))}`);
  if (open.code !== 1) console.log(open.out.slice(-2000));
  restore(d, saved);
  writeFileSync(join(d, 'dist/robots.txt'), 'User-agent: *\nAllow: /\n');
  const robots = gate(d, { VERCEL_ENV: 'production' });
  record('production, flag off, robots.txt allows crawling', 'robots-preview-open', `exit ${robots.code} ${expect(robots.code === 1 && failRule(robots.out, 'robots-preview-open'))}`);
  if (robots.code !== 1) console.log(robots.out.slice(-2000));
  rmSync(d, { recursive: true, force: true });
}

console.log('\nOWD SEO GATE SELF-TEST (source never modified; each case runs in a temp copy)\n');
console.log('| Case | Rule | Result |');
console.log('|---|---|---|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
console.log(`\n${ok ? 'SELF-TEST PASSED' : 'SELF-TEST FAILED'}`);
process.exit(ok ? 0 : 1);
