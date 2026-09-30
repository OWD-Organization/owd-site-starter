#!/usr/bin/env node
/**
 * OWD live SEO check (Node port of seo-quick-audit.py + the gate's page checks). GET/HEAD only.
 *
 *   npm run seo:live -- https://project.vercel.app            # preview (noindex expected)
 *   npm run seo:live -- https://www.client.com --launch       # launch day (any noindex = critical)
 *
 * Options: --expect-host www.client.com (production host for canonicals; default from
 *   .owd/seo-manifest.json or the URL)  --phone +15555550100  --lang en  --slash always|never|ignore
 *   --preview | --launch (default: preview on *.vercel.app, launch otherwise)  --limit 300
 *   --forbid-schema-key streetAddress (repeatable)  --no-gtm  --json report.json  --strict
 * Pages come from the sitemap AND a crawl of internal links, so pages missing from the sitemap show up.
 * Exit 1 on critical issues in launch mode (or with --strict). Preview mode only reports.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseHtml, checkPage, internalPath, policyPath, slashOk, digits10 } from './lib/seo-core.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const multi = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const flag = (k) => args.includes(`--${k}`);
const base = args.find((a) => /^https?:\/\//.test(a));
if (!base) { console.error('usage: npm run seo:live -- <https://site> [--expect-host host] [--preview|--launch]'); process.exit(2); }
const manifest = existsSync('.owd/seo-manifest.json') ? JSON.parse(readFileSync('.owd/seo-manifest.json', 'utf8')) : null;
const site = manifest?.site ?? {};
const BASE = new URL(base);
const HOST = opt('expect-host', site.url ? new URL(site.url).host : BASE.host);
const mode = flag('launch') ? 'launch' : flag('preview') ? 'preview' : BASE.host.endsWith('.vercel.app') ? 'preview' : 'launch';
const PHONE = opt('phone', site.phone?.e164 || '');
const LANG = opt('lang', site.lang || 'en');
const SLASH = opt('slash', site.trailingSlash || 'always');
const LIMIT = Number(opt('limit', 300));
const STRICT = flag('strict');
const internalHosts = new Set([HOST, BASE.host]);
const UA = 'Mozilla/5.0 (compatible; OWD-SEO-Check/2.0)';
const findings = [];
const add = (page, sev, rule, msg) => findings.push({ page, sev, rule, msg });
const toBase = (u) => { const x = new URL(u, BASE); if (internalHosts.has(x.host)) { x.protocol = BASE.protocol; x.host = BASE.host; } return x; };

async function get(url, method = 'GET') {
  let cur = url, hops = [];
  for (let i = 0; i < 6; i++) {
    let r;
    try { r = await fetch(cur, { method, redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) }); }
    catch (e) { return { status: 0, error: e.message, hops, url: cur, headers: new Headers(), body: '' }; }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { hops.push(`${r.status} ${cur}`); cur = new URL(r.headers.get('location'), cur).href; continue; }
    const body = method === 'GET' ? await r.text() : '';
    return { status: r.status, headers: r.headers, body, hops, url: cur };
  }
  return { status: 0, error: 'too many redirects', hops, url: cur, headers: new Headers(), body: '' };
}

// robots.txt
const rb = await get(new URL('/robots.txt', BASE).href);
const sitemapUrls = [];
if (rb.status !== 200) add('/robots.txt', 'critical', 'robots-missing', `robots.txt returned ${rb.status}`);
else {
  const disallowAll = /^\s*Disallow:\s*\/\s*$/im.test(rb.body);
  if (mode === 'preview' && !disallowAll) add('/robots.txt', 'critical', 'robots-preview-open', 'preview robots.txt must have "Disallow: /"');
  if (mode === 'launch' && disallowAll) add('/robots.txt', 'critical', 'robots-disallow-launch', 'robots.txt has "Disallow: /" on the launch site');
  for (const m of rb.body.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) sitemapUrls.push(m[1]);
  if (mode === 'launch' && !sitemapUrls.length) add('/robots.txt', 'critical', 'robots-sitemap-line', 'robots.txt has no Sitemap: line');
}
if (mode === 'preview' && !/noindex/i.test(rb.headers.get('x-robots-tag') || '')) add('/robots.txt', 'warn', 'x-robots-missing', 'no X-Robots-Tag on robots.txt');

// sitemap(s)
const smQueue = [...sitemapUrls.map((u) => toBase(u).href), new URL('/sitemap-index.xml', BASE).href, new URL('/sitemap.xml', BASE).href];
const smSeen = new Set(), inSitemap = new Map(); // base-href -> original loc
let smFound = false;
while (smQueue.length) {
  const sm = smQueue.shift();
  if (smSeen.has(sm)) continue;
  smSeen.add(sm);
  const r = await get(sm);
  if (r.status !== 200 || !/<(urlset|sitemapindex)/.test(r.body)) continue;
  smFound = true;
  for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const loc = m[1];
    if (/\.xml($|\?)/.test(loc)) { smQueue.push(toBase(loc).href); continue; }
    const u = new URL(loc);
    if (u.host !== HOST) add('/sitemap', 'critical', 'sitemap-host', `sitemap URL not on the production host ${HOST}: ${loc}`);
    if (!slashOk(u.pathname, SLASH)) add('/sitemap', 'critical', 'sitemap-slash', `sitemap URL breaks the trailing-slash policy: ${loc}`);
    inSitemap.set(toBase(loc).href, loc);
  }
}
if (!smFound) add('/sitemap', 'critical', 'sitemap-missing', 'no sitemap found (robots Sitemap:, /sitemap-index.xml, /sitemap.xml)');

// 404 behavior
const nf = await get(new URL('/owd-seo-check-does-not-exist/', BASE).href);
if (nf.status !== 404) add('/404', 'critical', 'status-404', `unknown URL returned ${nf.status}, expected 404`);

// crawl: sitemap URLs + BFS over internal links
const queue = [...inSitemap.keys(), new URL('/', BASE).href];
const visited = new Map(); // href -> {r, parsed, facts}
const linkTargets = new Map(); // base-href -> Set(pages)
while (queue.length && visited.size < LIMIT) {
  const href = queue.shift().split('#')[0];
  if (visited.has(href)) continue;
  const r = await get(href);
  const ctype = r.headers.get('content-type') || '';
  if (!/html/.test(ctype) && r.status === 200) { visited.set(href, null); continue; }
  const u = new URL(href);
  const pathname = policyPath(u.pathname, SLASH);
  const parsed = parseHtml(r.body || '');
  const xr = r.headers.get('x-robots-tag') || '';
  const { issues, facts } = checkPage(parsed, {
    mode, host: HOST, lang: LANG, phone: PHONE, slash: SLASH, pathname, isNotFound: false, noindexAllowed: false,
    internalHosts, xRobotsTag: xr, forbidSchemaKeys: multi('forbid-schema-key'), requireGtm: mode === 'launch' && !flag('no-gtm'),
  });
  if (r.status !== 200) add(u.pathname, 'critical', 'status', `status ${r.status}${r.error ? ' ' + r.error : ''}`);
  if (r.hops.length) add(u.pathname, 'warn', 'redirect', `redirects: ${r.hops.join(' -> ')} -> ${r.url}`);
  if (mode === 'preview' && !/noindex/i.test(xr)) add(u.pathname, 'critical', 'x-robots-missing', 'preview response has no X-Robots-Tag: noindex header');
  if (mode === 'launch' && /noindex/i.test(xr)) add(u.pathname, 'critical', 'noindex-on-launch', `X-Robots-Tag: ${xr} on the launch site`);
  issues.forEach((i) => add(u.pathname, i.sev, i.rule, i.msg));
  visited.set(href, { r, parsed, facts, pathname, xr });
  const note = (h, kind) => {
    const ip = internalPath(h, u.pathname, internalHosts);
    if (!ip) return;
    const t = toBase(ip.path).href;
    if (!linkTargets.has(t)) linkTargets.set(t, new Set());
    linkTargets.get(t).add(u.pathname);
    if (kind === 'link') {
      if (!slashOk(ip.path, SLASH)) add(u.pathname, 'warn', 'link-slash-policy', `internal link not in final URL form: ${ip.raw}`);
      if (!/\.[a-z0-9]{2,5}$/i.test(ip.path) && !visited.has(t) && !queue.includes(t)) queue.push(t);
    }
  };
  parsed.links.forEach((l) => note(l.href, 'link'));
  parsed.stylesheets.forEach((h) => note(h, 'asset'));
  parsed.scripts.forEach((s) => s.src && note(s.src, 'asset'));
  parsed.srcsets.forEach((s) => note(s.url, 'asset'));
}

// broken internal links/assets
const targets = [...linkTargets].slice(0, 800);
const results = new Map();
const worker = async () => {
  while (targets.length) {
    const [t] = targets.shift();
    const known = visited.get(t);
    if (known) { results.set(t, { status: known.r.status, hops: known.r.hops, known: true }); continue; }
    let r = await get(t, 'HEAD');
    if (r.status === 405 || r.status === 0) r = await get(t);
    results.set(t, { status: r.status, hops: r.hops, known: false });
  }
};
await Promise.all(Array.from({ length: 12 }, worker));
for (const [t, from] of linkTargets) {
  const res = results.get(t);
  if (!res) continue;
  if (res.status >= 400 || res.status === 0) add([...from].slice(0, 3).join(', '), 'critical', 'broken-internal-link', `internal link/asset returns ${res.status}: ${new URL(t).pathname}`);
  else if (res.hops.length && !res.known) add([...from].slice(0, 3).join(', '), 'warn', 'link-redirect', `internal link goes through a redirect: ${new URL(t).pathname}`);
}

// sitemap vs crawl
const pages = [...visited.entries()].filter(([, v]) => v);
for (const [href, v] of pages) {
  if (smFound && !inSitemap.has(href) && v.r.status === 200 && !(mode === 'launch' && v.facts.noindex)) add(v.pathname, 'warn', 'sitemap-omits-page', 'page found by crawl is not in the sitemap');
  if (inSitemap.has(href) && v.r.status !== 200) add('/sitemap', 'critical', 'sitemap-404', `sitemap URL returns ${v.r.status}: ${inSitemap.get(href)}`);
  if (inSitemap.has(href) && mode === 'launch' && v.facts.noindex) add('/sitemap', 'critical', 'sitemap-noindex', `sitemap lists a noindexed page: ${inSitemap.get(href)}`);
}

// stray files
for (const p of ['/README.md', '/AGENTS.md', '/.env', '/package.json', '/astro.config.mjs', '/docs/', '/src/', '/inspiration/', '/stdout', '/.git/HEAD', '/vercel.json']) {
  const r = await get(new URL(p, BASE).href);
  if (r.status === 200 && r.body !== nf.body) add(p, 'critical', 'stray-file', `non-site file is publicly served: ${p}`);
}

// sitewide duplicates and phones
for (const field of ['title', 'desc']) {
  const by = new Map();
  for (const [, v] of pages) if (v.facts[field]) by.set(v.facts[field], [...(by.get(v.facts[field]) || []), v.pathname]);
  for (const [val, ps] of by) if (ps.length > 1) add(ps.slice(0, 4).join(', '), 'warn', `duplicate-${field}`, `duplicate ${field} on ${ps.length} pages: "${val.slice(0, 70)}"`);
}
const tels = new Set(pages.flatMap(([, v]) => v.parsed.links.filter((l) => /^tel:/i.test(l.href || '')).map((l) => digits10(l.href))));
if (tels.size > 1) add('(sitewide)', 'warn', 'multiple-tel', `multiple tel: numbers sitewide: ${[...tels].join(', ')}`);

// report
console.log(['url', 'status', 'title_len', 'desc_len', 'h1', 'canonical', 'robots', 'x-robots-tag', 'jsonld_types', 'in_sitemap'].join('\t'));
for (const [href, v] of pages)
  console.log([href, v.r.status, v.facts.title.length, v.facts.desc.length, v.facts.h1s.length, v.facts.canonical || '-', v.facts.robots || '-', v.xr || '-', v.facts.types.join(',') || '-', inSitemap.has(href) ? 'yes' : 'NO'].join('\t'));
const crit = findings.filter((f) => f.sev === 'critical'), warns = findings.filter((f) => f.sev === 'warn');
const blocking = mode === 'launch' || STRICT;
console.log(`\nOWD LIVE SEO CHECK  base=${BASE.origin}  expect-host=${HOST}  mode=${mode}  pages=${pages.length}  critical=${crit.length}  warnings=${warns.length}`);
const byPage = new Map();
for (const f of findings) byPage.set(f.page, [...(byPage.get(f.page) || []), f]);
for (const [pg, fs] of [...byPage].sort()) {
  console.log(`\n${pg}`);
  for (const f of fs.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'critical' ? -1 : 1))) console.log(`  ${f.sev === 'critical' ? (blocking ? 'FAIL    ' : 'CRITICAL') : 'WARN    '}  [${f.rule}] ${f.msg}`);
}
const counts = new Map();
for (const f of findings) counts.set(`${f.sev}\t${f.rule}`, (counts.get(`${f.sev}\t${f.rule}`) || 0) + 1);
console.log('\nSUMMARY BY RULE');
for (const [k, n] of [...counts].sort()) { const [s, r] = k.split('\t'); console.log(`  ${s === 'critical' ? 'critical' : 'warn    '}  ${String(n).padStart(3)}  ${r}`); }
console.log(`\nRESULT: ${crit.length ? (blocking ? 'FAIL' : 'CRITICAL ISSUES FOUND (preview: report only)') : 'PASS'} critical=${crit.length} warnings=${warns.length}`);
if (opt('json')) writeFileSync(opt('json'), JSON.stringify({ base: BASE.origin, host: HOST, mode, pages: pages.map(([h, v]) => ({ url: h, status: v.r.status, ...v.facts, xRobotsTag: v.xr, inSitemap: inSitemap.has(h) })), findings }, null, 2));
process.exit(crit.length && blocking ? 1 : 0);
