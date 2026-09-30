#!/usr/bin/env node
/**
 * OWD SEO GATE: scans the built site in dist/ after `astro build`.
 *
 * Modes (Orion's rule: previews ALWAYS publish, only launch is blocked):
 *   preview (SITE_INDEXABLE is not 'true'): critical issues are printed as clearly labeled
 *            warnings and the gate exits 0, so the preview deploy still succeeds.
 *   launch  (SITE_INDEXABLE=true, Vercel Production at launch): any critical issue exits 1
 *            and FAILS the build.
 *   --strict: fail on any critical issue regardless of the flag (used by `npm run seo:strict`
 *            and the non-blocking GitHub Action on PRs).
 *
 * The report prints to the build log and is written to .owd/seo-gate-report.{txt,json}
 * (outside dist/, never deployed).
 *
 * Options: --dist dist  --manifest .owd/seo-manifest.json  --strict  --json
 *   Generic sites without the starter's manifest can pass facts directly:
 *   --host www.client.com --phone +15555550100 --lang en --slash always|never|ignore
 *   --mode preview|launch  --forbid-schema-key streetAddress (repeatable)
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { parseHtml, checkPage, internalPath, findPlaceholderConfig, policyPath, slashOk, digits10 } from './lib/seo-core.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const multi = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const flag = (k) => args.includes(`--${k}`);

const DIST = opt('dist', 'dist');
const MANIFEST = opt('manifest', '.owd/seo-manifest.json');
const STRICT = flag('strict');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
const site = manifest?.site ?? {};
const envIndexable = process.env.SITE_INDEXABLE === 'true';
const mode = opt('mode', envIndexable || manifest?.indexable ? 'launch' : 'preview');
const siteUrl = opt('host') ? `https://${opt('host')}` : site.url;
if (!siteUrl) { console.error('seo-gate: no production URL (missing .owd/seo-manifest.json and --host)'); process.exit(2); }
const HOST = new URL(siteUrl).host;
const PHONE = opt('phone', site.phone?.e164 || site.phone?.display || '');
const TRACKING = site.trackingPhone ? site.trackingPhone.e164 || site.trackingPhone.display : null;
const LANG = opt('lang', site.lang || 'en');
const SLASH = opt('slash', site.trailingSlash || 'always');
const noindexAllowed = new Set((site.noindexPaths || []).map((p) => policyPath(p, SLASH)));
const internalHosts = new Set([HOST]);
const blocking = mode === 'launch' || STRICT;

const findings = []; // {page, sev, rule, msg}
const add = (page, sev, rule, msg) => findings.push({ page, sev, rule, msg });

if (!existsSync(DIST)) { console.error(`seo-gate: ${DIST}/ not found. Run astro build first.`); process.exit(2); }
const walk = (d, acc = []) => { for (const n of readdirSync(d)) { const f = join(d, n); statSync(f).isDirectory() ? walk(f, acc) : acc.push(f); } return acc; };
const files = walk(DIST);
const rel = (f) => '/' + relative(DIST, f).split(sep).join('/');

if (manifest && envIndexable !== !!manifest.indexable && !opt('mode'))
  add('(build)', 'critical', 'mode-mismatch', `dist/ was built with SITE_INDEXABLE=${manifest.indexable} but the gate runs with SITE_INDEXABLE=${envIndexable}`);
if (!PHONE) add('(config)', 'critical', 'config-phone-missing', 'no canonical phone in config');

// 1. Stray working files
const STRAY_EXT = /\.(md|mdx|markdown|pdf|docx?|xlsx?|pptx?|csv|psd|ai|sketch|fig|xd|zip|tar|gz|tgz|rar|7z|bak|old|orig|tmp|swp|log|sql|sqlite|env|ts|tsx|jsx|astro|py|sh|yml|yaml|lock|map)$/i;
const STRAY_NAME = /(^|\/)(\.env(\..*)?|\.DS_Store|Thumbs\.db|stdout|stderr|npm-debug\.log|package(-lock)?\.json|README[^/]*|AGENTS\.md|.*~|.*\.(backup|copy)(\.[^/]*)?|.*[-_ ]backup[^/]*|.*[-_ ]old\.[^/]*)$/i;
const STRAY_DIR = /(^|\/)(inspiration|wireframes?|drafts?|notes|internal|runbooks?|_working|working|backups?|\.git|\.cursor|node_modules|src|docs|scripts|screenshots|mockups?)\//i;
for (const f of files) {
  const r = rel(f);
  if (STRAY_DIR.test(r) || STRAY_NAME.test(r) || (STRAY_EXT.test(r) && !r.endsWith('.webmanifest')))
    add(r, 'critical', 'stray-file', `working/internal file deployed: ${r}`);
}

// 2. robots.txt and sitemap
const robotsFile = join(DIST, 'robots.txt');
if (!existsSync(robotsFile)) add('/robots.txt', 'critical', 'robots-missing', 'robots.txt missing from the build output');
else {
  const rb = readFileSync(robotsFile, 'utf8');
  const disallowAll = /^\s*Disallow:\s*\/\s*$/im.test(rb);
  if (mode === 'preview' && !disallowAll) add('/robots.txt', 'critical', 'robots-preview-open', 'preview robots.txt must have "Disallow: /"');
  if (mode === 'launch') {
    if (disallowAll) add('/robots.txt', 'critical', 'robots-disallow-launch', 'robots.txt still has "Disallow: /" at launch');
    if (!new RegExp(`^\\s*Sitemap:\\s*https://${HOST.replace(/\./g, '\\.')}/`, 'im').test(rb)) add('/robots.txt', 'critical', 'robots-sitemap-line', `robots.txt needs "Sitemap: https://${HOST}/sitemap-index.xml"`);
  }
}
const smIndex = ['sitemap-index.xml', 'sitemap.xml'].map((n) => join(DIST, n)).find(existsSync);
const sitemapPaths = new Set();
if (!smIndex) add('/sitemap-index.xml', 'critical', 'sitemap-missing', 'no sitemap-index.xml or sitemap.xml in the build output');
else {
  const queue = [smIndex], seen = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!existsSync(f)) { add(rel(f), 'critical', 'sitemap-missing', `sitemap file referenced but missing: ${rel(f)}`); continue; }
    for (const m of readFileSync(f, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const u = new URL(m[1]);
      if (u.pathname.endsWith('.xml')) { queue.push(join(DIST, u.pathname)); continue; }
      if (u.host !== HOST) add('/sitemap', 'critical', 'sitemap-host', `sitemap URL not on the production host: ${m[1]}`);
      if (!slashOk(u.pathname, SLASH)) add('/sitemap', 'critical', 'sitemap-slash', `sitemap URL breaks the trailing-slash policy: ${m[1]}`);
      sitemapPaths.add(policyPath(decodeURI(u.pathname), SLASH));
    }
  }
}

// 3. Pages
const pageFor = (p) => {
  const clean = decodeURI(p.split(/[?#]/)[0]);
  const cands = clean.endsWith('/') ? [join(DIST, clean, 'index.html')] : [join(DIST, clean), join(DIST, clean + '.html'), join(DIST, clean, 'index.html')];
  return cands.find((c) => existsSync(c) && statSync(c).isFile()) || null;
};
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const pages = new Map(); // pathname -> {file, parsed, facts}
for (const f of htmlFiles) {
  const r = rel(f);
  const isNotFound = r === '/404.html' || r === '/404/index.html';
  let pathname = r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r.replace(/\.html$/, '');
  pathname = policyPath(pathname, SLASH);
  const parsed = parseHtml(readFileSync(f, 'utf8'));
  const { issues, facts } = checkPage(parsed, {
    mode, host: HOST, lang: LANG, phone: PHONE, trackingPhone: TRACKING, slash: SLASH, pathname, isNotFound,
    noindexAllowed: noindexAllowed.has(pathname), internalHosts, allowedImageHosts: new Set(site.allowedImageHosts || []),
    forbidSchemaKeys: multi('forbid-schema-key'), siteName: site.name, requireGtm: mode === 'launch' && !flag('no-gtm'),
  });
  issues.forEach((i) => add(isNotFound ? '/404' : pathname, i.sev, i.rule, i.msg));
  pages.set(pathname, { file: f, parsed, facts, isNotFound });
}

// 4. Sitemap contents vs pages
for (const sp of sitemapPaths) {
  const pg = pages.get(sp);
  if (!pg && !pageFor(sp)) add('/sitemap', 'critical', 'sitemap-404', `sitemap lists a URL with no page (404): ${sp}`);
  else if (pg?.isNotFound || /^\/404\/?$/.test(sp)) add('/sitemap', 'critical', 'sitemap-noindex', `sitemap lists the 404 page: ${sp}`);
  else if (noindexAllowed.has(sp)) add('/sitemap', 'critical', 'sitemap-noindex', `sitemap lists a noindexed page: ${sp}`);
  else if (mode === 'launch' && pg?.facts.noindex) add('/sitemap', 'critical', 'sitemap-noindex', `sitemap lists a page that has noindex: ${sp}`);
}
if (smIndex) for (const [pth, pg] of pages) if (!pg.isNotFound && !noindexAllowed.has(pth) && !sitemapPaths.has(pth)) add(pth, 'warn', 'sitemap-omits-page', 'indexable page is not in the sitemap');

// 5. Internal links and assets
const idCache = new Map();
for (const [pth, pg] of pages) {
  const broken = new Set(), slashHop = new Set(), badHash = new Set();
  const check = (href, kind) => {
    const ip = internalPath(href, pth, internalHosts);
    if (!ip) return;
    const target = pageFor(ip.path);
    if (!target) { broken.add(`${kind} ${ip.raw}`); return; }
    if (kind === 'link' && !slashOk(ip.path, SLASH)) slashHop.add(ip.raw);
    if (kind === 'link' && ip.hash && target.endsWith('.html')) {
      if (!idCache.has(target)) idCache.set(target, parseHtml(readFileSync(target, 'utf8')).ids);
      if (!idCache.get(target).has(decodeURIComponent(ip.hash))) badHash.add(ip.raw);
    }
  };
  pg.parsed.links.forEach((l) => check(l.href, 'link'));
  pg.parsed.stylesheets.forEach((h) => check(h, 'stylesheet'));
  pg.parsed.scripts.forEach((s) => s.src && check(s.src, 'script'));
  pg.parsed.srcsets.forEach((s) => check(s.url, 'image'));
  const key = pg.isNotFound ? '/404' : pth;
  for (const b of broken) add(key, 'critical', 'broken-internal-link', `internal link/asset to a missing page: ${b}`);
  for (const s of slashHop) add(key, 'warn', 'link-slash-policy', `internal link not in final URL form (redirect hop): ${s}`);
  for (const h of badHash) add(key, 'warn', 'link-missing-anchor', `link to a missing #anchor: ${h}`);
}

// 6. Duplicate titles / descriptions
for (const [field, label] of [['title', 'title'], ['desc', 'meta description']]) {
  const by = new Map();
  for (const [pth, pg] of pages) if (!pg.isNotFound && pg.facts[field]) by.set(pg.facts[field], [...(by.get(pg.facts[field]) || []), pth]);
  for (const [v, ps] of by) if (ps.length > 1) add(ps.join(', '), 'warn', `duplicate-${field}`, `duplicate ${label} on ${ps.length} pages: "${v.slice(0, 70)}"`);
}

// 7. Config and host-level indexing rules
if (manifest && mode === 'launch') {
  for (const h of findPlaceholderConfig(site)) add('(config)', 'critical', 'config-placeholder', `placeholder value in src/config/site.ts at launch: ${h}`);
  if (!/^GTM-[A-Z0-9]+$/.test(site.gtmId || '')) add('(config)', 'critical', 'gtm-id-missing', 'no GTM container ID (set PUBLIC_GTM_ID in Vercel Production)');
} else if (manifest) {
  const ph = findPlaceholderConfig(site);
  if (ph.length) add('(config)', 'warn', 'config-placeholder', `${ph.length} placeholder value(s) in src/config/site.ts (they block launch): ${ph.slice(0, 4).join('; ')}${ph.length > 4 ? '; ...' : ''}`);
}
if (existsSync('vercel.json')) {
  const vj = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const rules = (vj.headers || []).filter((h) => (h.headers || []).some((x) => /x-robots-tag/i.test(x.key) && /noindex/i.test(x.value)));
  const scoped = rules.filter((r) => (r.has || []).some((h) => h.type === 'host' && /vercel\\?\.app/.test(h.value)));
  const global = rules.filter((r) => !(r.has || []).length);
  if (!scoped.length && !global.length) add('vercel.json', mode === 'preview' ? 'critical' : 'warn', 'x-robots-header-missing', 'vercel.json has no X-Robots-Tag noindex rule for *.vercel.app hosts');
  if (global.length && mode === 'launch') add('vercel.json', 'critical', 'x-robots-global-launch', 'vercel.json has an unscoped X-Robots-Tag noindex rule: it would noindex the live domain');
  const ts = vj.trailingSlash;
  if (SLASH !== 'ignore' && ts !== undefined && ts !== (SLASH === 'always')) add('vercel.json', 'critical', 'slash-policy-mismatch', `vercel.json trailingSlash=${ts} does not match the site policy "${SLASH}"`);
}

// ---- Report ----
const crit = findings.filter((f) => f.sev === 'critical');
const warns = findings.filter((f) => f.sev === 'warn');
const label = (f) => (f.sev === 'critical' ? (blocking ? 'FAIL    ' : 'CRITICAL (preview: not blocking)') : 'WARN    ');
const lines = [];
lines.push('='.repeat(78));
lines.push(`OWD SEO GATE  mode=${mode}${STRICT ? ' (strict)' : ''}  host=${HOST}  phone=${PHONE}  lang=${LANG}  slash=${SLASH}`);
lines.push(`pages=${pages.size}  sitemap_urls=${sitemapPaths.size}  critical=${crit.length}  warnings=${warns.length}`);
lines.push('='.repeat(78));
const byPage = new Map();
for (const f of findings) byPage.set(f.page, [...(byPage.get(f.page) || []), f]);
const order = [...byPage.keys()].sort();
for (const [pth] of [...pages].sort()) if (!byPage.has(pg404(pth))) lines.push(`OK        ${pth}`);
function pg404(p) { return pages.get(p)?.isNotFound ? '/404' : p; }
for (const pg of order) {
  lines.push(`\n${pg}`);
  for (const f of byPage.get(pg).sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'critical' ? -1 : 1))) lines.push(`  ${label(f)}  [${f.rule}] ${f.msg}`);
}
const counts = new Map();
for (const f of findings) counts.set(`${f.sev}\t${f.rule}`, (counts.get(`${f.sev}\t${f.rule}`) || 0) + 1);
lines.push('\nSUMMARY BY RULE');
for (const [k, n] of [...counts].sort()) { const [s, r] = k.split('\t'); lines.push(`  ${s === 'critical' ? 'critical' : 'warn    '}  ${String(n).padStart(3)}  ${r}`); }
let verdict;
if (crit.length && blocking) verdict = `RESULT: FAIL. ${crit.length} critical issue(s). ${mode === 'launch' ? 'Launch build blocked.' : 'Strict mode.'}`;
else if (crit.length) verdict = `RESULT: PREVIEW PUBLISHED WITH ${crit.length} CRITICAL ISSUE(S) (not blocking in preview mode). These must be fixed before launch: npm run seo:launch-check`;
else verdict = `RESULT: PASS (${warns.length} warning(s)).`;
lines.push('\n' + verdict);
const text = lines.join('\n');
console.log(text);
try {
  mkdirSync('.owd', { recursive: true });
  writeFileSync('.owd/seo-gate-report.txt', text + '\n');
  writeFileSync('.owd/seo-gate-report.json', JSON.stringify({ mode, strict: STRICT, host: HOST, critical: crit.length, warnings: warns.length, findings }, null, 2));
} catch {}
process.exit(crit.length && blocking ? 1 : 0);
