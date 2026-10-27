#!/usr/bin/env node
/**
 * OWD SEO GATE: scans the built site in dist/ after `astro build`.
 *
 * Non-production (VERCEL_ENV is not "production": local, preview, staging, PR Action):
 *   every issue is a warning and the process exits 0.
 * Production (VERCEL_ENV=production, set by Vercel on Production deploys only):
 *   exit 1 only for the rules in scripts/lib/seo-blockers.mjs. Everything else
 *   (GTM, GA4, pixel, titles, descriptions, OG, alt, schema, and the rest) is a warning.
 *
 * SITE_INDEXABLE still controls noindex, robots.txt, and whether GTM may render.
 * It does not by itself decide the exit code. `--strict` is accepted and ignored.
 *
 * The report prints to the build log and is written to .owd/seo-gate-report.{txt,json}
 * (outside dist/, never deployed).
 *
 * Options: --dist dist  --manifest .owd/seo-manifest.json
 *   --host www.client.com --phone +15555550100 --lang en --slash always|never|ignore
 *   --mode preview|launch  --forbid-schema-key streetAddress (repeatable)
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseHtml, checkPage, internalPath, findPlaceholderConfig, policyPath, slashOk } from './lib/seo-core.mjs';
import { badDomain, deadDestinations, isProductionBuild, placeholderReasons, PRODUCTION_CRITICAL_RULES, secretHits, SECRET_SCAN_EXT, severityFor, withFix } from './lib/seo-blockers.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const multi = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const flag = (k) => args.includes(`--${k}`);

const DIST = opt('dist', 'dist');
const MANIFEST = opt('manifest', '.owd/seo-manifest.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
const site = manifest?.site ?? {};
const envIndexable = process.env.SITE_INDEXABLE === 'true';
const mode = opt('mode', envIndexable || manifest?.indexable ? 'launch' : 'preview');
const PRODUCTION = isProductionBuild();
const siteUrl = opt('host') ? `https://${opt('host')}` : site.url;
if (!siteUrl) {
  console.error('seo-gate: no production URL (missing .owd/seo-manifest.json and --host). Fix: set SITE.url in src/config/site.ts and rebuild so .owd/seo-manifest.json exists.');
  process.exit(PRODUCTION ? 1 : 0);
}
const HOST = new URL(siteUrl).host;
const PHONE = opt('phone', site.phone?.e164 || site.phone?.display || '');
const TRACKING = site.trackingPhone ? site.trackingPhone.e164 || site.trackingPhone.display : null;
const LANG = opt('lang', site.lang || 'en');
const SLASH = opt('slash', site.trailingSlash || 'always');
const noindexAllowed = new Set((site.noindexPaths || []).map((p) => policyPath(p, SLASH)));
const internalHosts = new Set([HOST]);

const findings = []; // {page, sev, rule, msg}
let pages = new Map(); // pathname -> {file, parsed, facts}
let sitemapPaths = new Set();
const add = (page, _sev, rule, msg) => findings.push({ page, sev: severityFor(rule, PRODUCTION), rule, msg: withFix(rule, msg) });

if (!existsSync(DIST)) {
  add('(build)', 'critical', 'render-failure', `${DIST}/ was not created, so the site did not render.`);
  reportAndExit();
}
const walk = (d, acc = []) => { for (const n of readdirSync(d)) { const f = join(d, n); statSync(f).isDirectory() ? walk(f, acc) : acc.push(f); } return acc; };
const files = walk(DIST);
const rel = (f) => '/' + relative(DIST, f).split(sep).join('/');

if (manifest && envIndexable !== !!manifest.indexable && !opt('mode'))
  add('(build)', 'warn', 'mode-mismatch', `dist/ was built with SITE_INDEXABLE=${manifest.indexable} but the gate runs with SITE_INDEXABLE=${envIndexable}. Rebuild with the same value you use to run the gate.`);
if (!PHONE) add('(config)', 'warn', 'config-phone-missing', 'no canonical phone in src/config/site.ts. Set SITE.phone to the client number. A 555 number in the built HTML fails production; an empty phone is a warning.');

// 1. Stray working files
const STRAY_EXT = /\.(md|mdx|markdown|pdf|docx?|xlsx?|pptx?|csv|psd|ai|sketch|fig|xd|zip|tar|gz|tgz|rar|7z|bak|old|orig|tmp|swp|log|sql|sqlite|env|ts|tsx|jsx|astro|py|sh|yml|yaml|lock|map)$/i;
const STRAY_NAME = /(^|\/)(\.env(\..*)?|\.DS_Store|Thumbs\.db|stdout|stderr|npm-debug\.log|package(-lock)?\.json|README[^/]*|AGENTS\.md|.*~|.*\.(backup|copy)(\.[^/]*)?|.*[-_ ]backup[^/]*|.*[-_ ]old\.[^/]*)$/i;
const STRAY_DIR = /(^|\/)(inspiration|wireframes?|drafts?|notes|internal|runbooks?|_working|working|backups?|\.git|\.cursor|node_modules|src|docs|scripts|screenshots|mockups?)\//i;
for (const f of files) {
  const r = rel(f);
  if (STRAY_DIR.test(r) || STRAY_NAME.test(r) || (STRAY_EXT.test(r) && !r.endsWith('.webmanifest')))
    add(r, 'warn', 'stray-file', `Working file ${r} was copied into the build. Remove it from public/. This is a warning unless the file is a secret.`);
  if (/(^|\/)\.env(\..*)?$/.test(r)) add(r, 'critical', 'secret-exposed', `Env file ${r} was published in the build.`);
}

// 2. robots.txt and sitemap
const robotsFile = join(DIST, 'robots.txt');
if (!existsSync(robotsFile)) {
  if (mode === 'preview') add('/robots.txt', 'critical', 'robots-preview-open', 'robots.txt is missing, so this build does not tell crawlers "Disallow: /". The pages can be indexed while SITE_INDEXABLE is off.');
  else add('/robots.txt', 'warn', 'robots-missing', 'robots.txt is missing from the build. src/pages/robots.txt.ts should emit Allow: / and a Sitemap line when SITE_INDEXABLE=true.');
} else {
  const rb = readFileSync(robotsFile, 'utf8');
  const disallowAll = /^\s*Disallow:\s*\/\s*$/im.test(rb);
  if (mode === 'preview' && !disallowAll) add('/robots.txt', 'critical', 'robots-preview-open', 'robots.txt does not contain "Disallow: /", so the site is open to crawlers while SITE_INDEXABLE is off.');
  if (mode === 'launch' && disallowAll) add('/robots.txt', 'critical', 'robots-disallow-launch', 'SITE_INDEXABLE=true but robots.txt still has "Disallow: /", so the live site stays noindexed.');
  const smLines = [...rb.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  for (const loc of smLines) {
    let host = '';
    try { host = new URL(loc).host; } catch { host = ''; }
    const why = badDomain(host, HOST);
    if (why) add('/robots.txt', 'critical', 'sitemap-host', `robots.txt Sitemap URL is on the wrong domain (${host || loc}): ${loc}. The site domain is ${HOST}.`);
  }
  if (mode === 'launch' && !smLines.length) add('/robots.txt', 'warn', 'robots-sitemap-line', `robots.txt has no Sitemap line. When SITE_INDEXABLE=true it should include "Sitemap: https://${HOST}/sitemap-index.xml". This is a warning.`);
}
const smIndex = ['sitemap-index.xml', 'sitemap.xml'].map((n) => join(DIST, n)).find(existsSync);
if (!smIndex) add('/sitemap-index.xml', 'warn', 'sitemap-missing', 'no sitemap-index.xml or sitemap.xml in the build output. Confirm @astrojs/sitemap is enabled. A missing sitemap is a warning; a sitemap URL on the wrong domain fails production.');
else {
  const queue = [smIndex], seen = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!existsSync(f)) { add(rel(f), 'warn', 'sitemap-missing', `sitemap file referenced but missing: ${rel(f)}`); continue; }
    for (const m of readFileSync(f, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      let u;
      try { u = new URL(m[1]); } catch { add('/sitemap', 'critical', 'sitemap-host', `sitemap URL is not a valid absolute URL: ${m[1]}`); continue; }
      if (u.pathname.endsWith('.xml')) { queue.push(join(DIST, decodeURI(u.pathname).replace(/^\//, ''))); continue; }
      const why = badDomain(u.host, HOST);
      if (why === 'vercel.app') add('/sitemap', 'critical', 'sitemap-host', `sitemap URL is on vercel.app, not the site domain ${HOST}: ${m[1]}`);
      else if (why) add('/sitemap', 'critical', 'sitemap-host', `sitemap URL host ${u.host} is not the site domain ${HOST}: ${m[1]}`);
      if (!slashOk(u.pathname, SLASH)) add('/sitemap', 'warn', 'sitemap-slash', `sitemap URL breaks the trailing-slash policy: ${m[1]}. Match SITE.trailingSlash. This is a warning.`);
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
for (const f of htmlFiles) {
  const r = rel(f);
  const isNotFound = r === '/404.html' || r === '/404/index.html';
  let pathname = r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r.replace(/\.html$/, '');
  pathname = policyPath(pathname, SLASH);
  const html = readFileSync(f, 'utf8');
  const pageKey = isNotFound ? '/404' : pathname;
  if (html.length < 40 || !/<body[\s>]/i.test(html) || /__astro_error|This page did not render|Internal Server Error/i.test(html))
    add(pageKey, 'critical', 'render-failure', `The built file ${r} is empty or is an error page, so the route did not render.`);
  const parsed = parseHtml(html);
  const { issues, facts } = checkPage(parsed, {
    mode, host: HOST, lang: LANG, phone: PHONE, trackingPhone: TRACKING, slash: SLASH, pathname, isNotFound,
    noindexAllowed: noindexAllowed.has(pathname), internalHosts, allowedImageHosts: new Set(site.allowedImageHosts || []),
    forbidSchemaKeys: multi('forbid-schema-key'), siteName: site.name, requireGtm: mode === 'launch' && !flag('no-gtm'),
  });
  issues.forEach((i) => add(pageKey, i.sev, i.rule, i.msg));
  const ph = placeholderReasons(html);
  if (ph.length) add(pageKey, 'critical', 'placeholder-output', `Placeholder content shipped in this page (${ph.join(', ')}).`);
  for (const hit of deadDestinations(parsed, html)) add(pageKey, 'critical', 'dead-destination', `Form or button has no working destination: ${hit}.`);
  const secrets = secretHits(html);
  if (secrets.length) add(pageKey, 'critical', 'secret-exposed', `Possible secret in the built page (${secrets.join(', ')}).`);
  pages.set(pathname, { file: f, parsed, facts, isNotFound, html });
}

// 4. Sitemap contents vs pages
for (const sp of sitemapPaths) {
  const pg = pages.get(sp);
  if (!pg && !pageFor(sp)) add('/sitemap', 'critical', 'sitemap-404', `sitemap lists ${sp}, but that page is not in the build, so it will 404.`);
  else if (pg?.isNotFound || /^\/404\/?$/.test(sp)) add('/sitemap', 'warn', 'sitemap-noindex', `sitemap lists the 404 page: ${sp}. Remove it from the sitemap. This is a warning.`);
  else if (noindexAllowed.has(sp)) add('/sitemap', 'warn', 'sitemap-noindex', `sitemap lists a page that is in SITE.noindexPaths: ${sp}. Remove it from the sitemap. This is a warning.`);
  else if (mode === 'launch' && pg?.facts.noindex) add('/sitemap', 'warn', 'sitemap-noindex', `sitemap lists a page that still has noindex: ${sp}. The noindex itself is the production failure; drop the URL from the sitemap too.`);
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
  for (const b of broken) add(key, 'critical', 'broken-internal-link', `internal link or asset points at a page that was not built (${b}). Visitors will get a 404.`);
  for (const s of slashHop) add(key, 'warn', 'link-slash-policy', `internal link not in final URL form (redirect hop): ${s}`);
  for (const h of badHash) add(key, 'warn', 'link-missing-anchor', `link to a missing #anchor: ${h}`);
}

// 6. Duplicate titles / descriptions
for (const [field, label] of [['title', 'title'], ['desc', 'meta description']]) {
  const by = new Map();
  for (const [pth, pg] of pages) if (!pg.isNotFound && pg.facts[field]) by.set(pg.facts[field], [...(by.get(pg.facts[field]) || []), pth]);
  for (const [v, ps] of by) if (ps.length > 1) add(ps.join(', '), 'warn', `duplicate-${field}`, `duplicate ${label} on ${ps.length} pages: "${v.slice(0, 70)}"`);
}

// 7. Key pages, favicon, branded 404, secrets outside HTML
const KEY_PAGES = ['/', '/about/', '/contact/', '/services/'].map((p) => policyPath(p, SLASH));
if (!pages.has('/')) add('(build)', 'critical', 'render-failure', 'The homepage did not render. dist/index.html is missing.');
for (const p of KEY_PAGES) {
  if (p === '/') continue;
  if (!pages.has(p) && !pageFor(p)) add(p, 'critical', 'key-page-missing', `Key page ${p} is missing from the build, so that URL will 404.`);
}
if (!existsSync(join(DIST, 'favicon.ico'))) add('/favicon.ico', 'critical', 'favicon-missing', 'public/favicon.ico was not copied into the build, so the browser has no favicon.');
const notFoundPage = [...pages.values()].find((pg) => pg.isNotFound);
if (!notFoundPage) add('/404', 'critical', 'branded-404-missing', 'No 404 page was built (expected dist/404.html).');
else {
  const name = String(site.name || '').trim();
  const html = notFoundPage.html || readFileSync(notFoundPage.file, 'utf8');
  if (name && !html.includes(name)) add('/404', 'critical', 'branded-404-missing', `The 404 page does not include the business name "${name}".`);
  else if (!/<header[\s>]/i.test(html)) add('/404', 'critical', 'branded-404-missing', 'The 404 page does not include the site header.');
}
for (const f of files) {
  if (!SECRET_SCAN_EXT.test(f) || f.endsWith('.html')) continue;
  let text = '';
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const hits = secretHits(text);
  if (hits.length) add(rel(f), 'critical', 'secret-exposed', `Possible secret in ${rel(f)} (${hits.join(', ')}).`);
}

// 8. Config, tracking IDs (warnings), and host-level indexing rules
if (manifest) {
  const ph = findPlaceholderConfig(site);
  if (ph.length) add('(config)', 'warn', 'config-placeholder', `${ph.length} example value(s) still in src/config/site.ts: ${ph.slice(0, 4).join('; ')}${ph.length > 4 ? '; ...' : ''}. Replace them with confirmed client facts. Rendered TODO, lorem ipsum, 555 numbers, example.com, and #TODO links fail production; this config note is a warning.`);
}
const gtmId = String(site.gtmId || '');
if (gtmId && !/^GTM-[A-Z0-9]+$/.test(gtmId)) add('(config)', 'warn', 'gtm-id-malformed', `GTM container ID "${gtmId}" is malformed. Set PUBLIC_GTM_ID to GTM- followed by letters and digits in Vercel. This is a warning and does not fail the build.`);
else if (mode === 'launch' && !gtmId) add('(config)', 'warn', 'gtm-id-missing', 'No GTM container ID. Set PUBLIC_GTM_ID=GTM-XXXX in Vercel Production when the client has a container. Missing GTM, GA4, or pixel IDs are warnings.');
const ga4Id = String(site.ga4Id || process.env.PUBLIC_GA4_ID || '');
if (ga4Id && !/^G-[A-Z0-9]+$/.test(ga4Id)) add('(config)', 'warn', 'ga4-id-malformed', `GA4 measurement ID "${ga4Id}" is malformed. Use G- followed by letters and digits, or remove PUBLIC_GA4_ID and load GA4 inside GTM. This is a warning.`);
if (existsSync('vercel.json')) {
  const vj = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const rules = (vj.headers || []).filter((h) => (h.headers || []).some((x) => /x-robots-tag/i.test(x.key) && /noindex/i.test(x.value)));
  const scoped = rules.filter((r) => (r.has || []).some((h) => h.type === 'host' && /vercel\\?\.app/.test(h.value)));
  const appliesToLive = rules.filter((r) => {
    const has = r.has || [];
    if (!has.length) return true;
    return has.some((h) => {
      if (h.type !== 'host' || /vercel\.app/i.test(h.value || '')) return false;
      try { return new RegExp(h.value).test(HOST); } catch { return h.value === HOST; }
    });
  });
  if (!scoped.length && !appliesToLive.length) add('vercel.json', 'warn', 'x-robots-header-missing', 'vercel.json has no X-Robots-Tag noindex rule for *.vercel.app hosts. Add a host-scoped noindex header so preview URLs stay out of Google. This is a warning.');
  if (mode === 'launch' && appliesToLive.length) add('vercel.json', 'critical', 'x-robots-on-real-domain', `SITE_INDEXABLE=true but vercel.json still sends X-Robots-Tag noindex on the live domain ${HOST}.`);
  const ts = vj.trailingSlash;
  if (SLASH !== 'ignore' && ts !== undefined && ts !== (SLASH === 'always')) add('vercel.json', 'warn', 'slash-policy-mismatch', `vercel.json trailingSlash=${ts} does not match the site policy "${SLASH}". Make them agree. This is a warning.`);
}

// ---- Report ----
reportAndExit();

function reportAndExit() {
  const crit = findings.filter((f) => f.sev === 'critical');
  const warns = findings.filter((f) => f.sev === 'warn');
  const wouldFail = [...new Set(findings.filter((f) => PRODUCTION_CRITICAL_RULES.has(f.rule)).map((f) => f.rule))];
  const label = (f) => (f.sev === 'critical' ? 'FAIL    ' : 'WARN    ');
  const lines = [];
  lines.push('='.repeat(78));
  lines.push(`OWD SEO GATE  vercel_env=${process.env.VERCEL_ENV || '(unset)'}  production=${PRODUCTION}  indexable=${mode}  host=${HOST}  phone=${PHONE}  lang=${LANG}  slash=${SLASH}`);
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
  if (PRODUCTION && crit.length) verdict = `RESULT: FAIL. ${crit.length} critical issue(s) block this production build (VERCEL_ENV=production). Each FAIL line says what broke and how to fix it. Warnings do not block.`;
  else if (PRODUCTION) verdict = `RESULT: PASS (${warns.length} warning(s)). Production build is not blocked.`;
  else verdict = `RESULT: PASS (${warns.length} warning(s)). VERCEL_ENV is not production, so this build is not blocked.${wouldFail.length ? ` These rules would fail a Vercel production build: ${wouldFail.join(', ')}.` : ''}`;
  lines.push('\n' + verdict);
  const text = lines.join('\n');
  console.log(text);
  try {
    mkdirSync('.owd', { recursive: true });
    writeFileSync('.owd/seo-gate-report.txt', text + '\n');
    writeFileSync('.owd/seo-gate-report.json', JSON.stringify({ production: PRODUCTION, vercelEnv: process.env.VERCEL_ENV || null, mode, host: HOST, critical: crit.length, warnings: warns.length, wouldFailProduction: wouldFail, findings }, null, 2));
  } catch {}
  process.exit(PRODUCTION && crit.length ? 1 : 0);
}
