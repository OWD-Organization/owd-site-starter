// Shared, dependency-free SEO checks used by scripts/seo-gate.mjs (built dist/) and
// scripts/seo-live.mjs (deployed URLs). Severity: 'critical' (launch blocker) or 'warn'.

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®' };
export const decode = (s = '') =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
const norm = (s) => decode(s).replace(/\s+/g, ' ').trim();

function attrs(src) {
  const out = {};
  const re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** Parse HTML into the facts the checks need. Tolerant regex tokenizer (no deps). */
export function parseHtml(html) {
  const p = {
    lang: null, titles: [], metas: [], canonicals: [], h1s: [], imgs: [], srcsets: [], links: [], scripts: [],
    stylesheets: [], jsonld: [], ids: new Set(), text: [], footerText: [], styleUrls: [], iframes: [],
    hasMain: false, hasBody: false,
  };
  const TOKEN = /<!--[\s\S]*?-->|<(script|style|noscript|template|textarea)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</gi;
  const open = { head: 0, body: 0, title: 0, h1: 0, footer: 0, a: 0 };
  let title = null, h1 = null, anchor = null, m;
  const pushText = (t) => {
    if (open.title) { title += t; return; }
    if (open.head && !open.body) return;
    p.text.push(t);
    if (open.footer) p.footerText.push(t);
    if (h1 !== null) h1 += t;
    if (anchor) anchor.text += t;
  };
  while ((m = TOKEN.exec(html))) {
    if (m[1]) {
      const tag = m[1].toLowerCase(), a = attrs(m[2] || ''), body = m[3] || '';
      if (a.id) p.ids.add(a.id);
      if (tag === 'script') {
        p.scripts.push({ src: a.src || '', type: (a.type || '').toLowerCase(), body });
        if ((a.type || '').toLowerCase() === 'application/ld+json') p.jsonld.push(body);
      } else if (tag === 'style') {
        for (const u of body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) p.styleUrls.push(u[1]);
      } else if (tag === 'noscript') {
        for (const f of body.matchAll(/<iframe\b([^>]*)>/gi)) p.iframes.push(attrs(f[1]));
      } else if (tag === 'textarea') pushText(body);
      continue;
    }
    if (m[4]) {
      const tag = m[4].toLowerCase();
      if (tag in open && open[tag] > 0) open[tag]--;
      if (tag === 'title' && title !== null) { p.titles.push(norm(title)); title = null; }
      if (tag === 'h1' && h1 !== null) { p.h1s.push(norm(h1)); h1 = null; }
      if (tag === 'a' && anchor) { anchor.text = norm(anchor.text); p.links.push(anchor); anchor = null; }
      continue;
    }
    if (m[5]) {
      const tag = m[5].toLowerCase(), a = attrs(m[6] || '');
      if (a.id) p.ids.add(a.id);
      if (a.style) for (const u of a.style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) p.styleUrls.push(u[1]);
      switch (tag) {
        case 'html': p.lang = a.lang ?? null; break;
        case 'body': p.hasBody = true; break;
        case 'main': p.hasMain = true; break;
        case 'title': title = ''; break;
        case 'h1': h1 = ''; break;
        case 'meta': p.metas.push(a); break;
        case 'link': {
          const rel = (a.rel || '').toLowerCase().split(/\s+/);
          if (rel.includes('canonical')) p.canonicals.push(a.href ?? '');
          if (rel.includes('stylesheet')) p.stylesheets.push(a.href || '');
          if (rel.includes('preload') && a.as === 'image' && a.href) p.srcsets.push({ url: a.href, tag: 'link-preload' });
          if (rel.some((r) => r.includes('icon'))) p.favicon = true;
          break;
        }
        case 'img': p.imgs.push({ ...a, _inFooter: open.footer > 0 }); if (a.src) p.srcsets.push({ url: a.src, tag: 'img' }); addSrcset(p, a.srcset, 'img'); break;
        case 'source': addSrcset(p, a.srcset, 'source'); if (a.src) p.srcsets.push({ url: a.src, tag: 'source' }); break;
        case 'video': if (a.poster) p.srcsets.push({ url: a.poster, tag: 'video-poster' }); break;
        case 'iframe': p.iframes.push(a); break;
        case 'a': anchor = { href: a.href ?? null, text: '', attrs: a, inFooter: open.footer > 0 }; break;
      }
      if (tag in open && !VOID.has(tag) && !/\/\s*$/.test(m[6] || '')) open[tag]++;
      if (tag === 'br' || tag === 'p' || tag === 'li' || tag === 'div') pushText(' ');
      continue;
    }
    if (m[7]) pushText(decode(m[7]));
  }
  p.visibleText = p.text.join('').replace(/\s+/g, ' ').trim();
  p.footerVisible = p.footerText.join('').replace(/\s+/g, ' ').trim();
  p.meta = (key) => {
    const hit = p.metas.filter((x) => (x.name || x.property || '').toLowerCase() === key);
    return hit.map((x) => x.content ?? '');
  };
  return p;
}

function addSrcset(p, srcset, tag) {
  if (!srcset) return;
  for (const part of srcset.split(',')) {
    const url = part.trim().split(/\s+/)[0];
    if (url) p.srcsets.push({ url, tag });
  }
}

export const digits10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const PHONE_RE = /(?<![\d\w])(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-](\d{4})(?!\d)/g;
export function visiblePhones(text) {
  const out = [];
  for (const m of text.matchAll(PHONE_RE)) out.push({ raw: m[0].trim(), d: m[1] + m[2] + m[3] });
  return out;
}

export const LOCAL_BUSINESS_TYPES = new Set(
  ('LocalBusiness Plumber HVACBusiness Electrician RoofingContractor GeneralContractor HomeAndConstructionBusiness ' +
    'HousePainter Locksmith MovingCompany ProfessionalService AutomotiveBusiness AutoRepair LegalService Attorney ' +
    'MedicalBusiness Dentist HealthAndBeautyBusiness EmergencyService FinancialService RealEstateAgent Store ' +
    'FoodEstablishment Restaurant LodgingBusiness SportsActivityLocation ChildCare DryCleaningOrLaundry ' +
    'EmploymentAgency EntertainmentBusiness GovernmentOffice InternetCafe Library RecyclingCenter SelfStorage ' +
    'ShoppingCenter TouristInformationCenter TravelAgency AnimalShelter ArchiveOrganization').split(' '),
);

export const PREVIEW_WIDGETS = [
  ['feedbucket', /feedbucket/i], ['marker.io', /marker\.io|markerConfig/i], ['usersnap', /usersnap/i],
  ['userback', /userback/i], ['bugherd', /bugherd/i], ['pastel', /usepastel|pastel\.io/i], ['ruttl', /ruttl/i],
  ['vercel toolbar/comments', /vercel\.live\/_next-live|vercel-live-feedback|data-vercel-toolbar/i],
  ['preview-only marker', /data-preview-only/i],
];

const PLACEHOLDER_TEXT = /\b(TODO|FIXME|TBD|XXX)\b|lorem ipsum|\bplaceholder\b|\bdraft\b|\[insert|\binsert (?:here|text|copy)\b|replace (?:this|with)\b|\bsample text\b|\bcoming soon\b|\bexample (?:section|service page|town page|about page|content|copy)\b/i;
const GENERIC_TITLE = /^(home|homepage|home page|logo|index|untitled|untitled document|welcome|main|default|new page|my site|astro|site title|page title)$/i;

function walkJson(node, fn, key = null) {
  if (Array.isArray(node)) node.forEach((n) => walkJson(n, fn, key));
  else if (node && typeof node === 'object') {
    fn(node);
    for (const [k, v] of Object.entries(node)) walkJson(v, fn, k);
  }
}
const typesOf = (n) => (Array.isArray(n['@type']) ? n['@type'] : n['@type'] ? [n['@type']] : []);

/** Expected canonical path for a page path under a slash policy. */
export function policyPath(path, slash) {
  if (slash === 'always') return path.endsWith('/') || /\.[a-z0-9]+$/i.test(path) ? path : path + '/';
  if (slash === 'never') return path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;
  return path;
}
export function slashOk(path, slash) {
  if (slash === 'ignore' || path === '/' || /\.[a-z0-9]+$/i.test(path)) return true;
  return slash === 'always' ? path.endsWith('/') : !path.endsWith('/');
}

/**
 * Check one page. ctx: { mode: 'preview'|'launch', host, lang, phone, trackingPhone, slash,
 *   pathname, isNotFound, noindexAllowed, internalHosts:Set, allowedImageHosts:Set,
 *   forbidSchemaKeys:[], localBusinessTypes:Set }
 * Returns { issues: [{sev, rule, msg}], facts }.
 */
export function checkPage(p, ctx) {
  const issues = [];
  const C = (rule, msg) => issues.push({ sev: 'critical', rule, msg });
  const W = (rule, msg) => issues.push({ sev: 'warn', rule, msg });
  const phone = digits10(ctx.phone);
  const tracking = ctx.trackingPhone ? digits10(ctx.trackingPhone) : null;

  // Title
  const titles = p.titles;
  const title = titles[0] || '';
  if (titles.length === 0 || !title) C('title-missing', 'missing or empty <title>');
  if (titles.length > 1) C('title-multiple', `${titles.length} <title> tags`);
  if (title) {
    const segs = title.split(/\s[|\-–—:·]\s/).map((s) => s.trim());
    if (ctx.pathname === '/' && (segs.some((s) => GENERIC_TITLE.test(s)) || (ctx.siteName && title.trim() === ctx.siteName)))
      C('title-generic-home', `generic homepage title "${title}" (use service + area + brand)`);
    if (!ctx.isNotFound && (title.length < 30 || title.length > 60)) W('title-length', `title is ${title.length} chars (target 30 to 60): "${title}"`);
  }
  // Description
  const descs = p.meta('description');
  const desc = norm(descs[0] || '');
  if (!desc) W('desc-missing', 'meta description missing');
  else if (!ctx.isNotFound && (desc.length < 140 || desc.length > 160)) W('desc-length', `meta description is ${desc.length} chars (target 140 to 160)`);
  if (descs.length > 1) W('desc-multiple', `${descs.length} meta descriptions`);
  if (/[—]/.test(desc)) W('desc-em-dash', 'meta description contains an em dash (house style)');

  // Open Graph / Twitter / favicon
  const ogMissing = ['og:title', 'og:description', 'og:image', 'og:url'].filter((k) => !p.meta(k).some(Boolean));
  if (ogMissing.length && !ctx.isNotFound) W('og-incomplete', `Open Graph tags missing: ${ogMissing.join(', ')}`);
  if (!p.meta('twitter:card').some(Boolean) && !ctx.isNotFound) W('twitter-card-missing', 'no twitter:card meta tag');
  if (!p.favicon) W('favicon-missing', 'no favicon <link>');

  // Canonical
  const cans = p.canonicals;
  if (!ctx.isNotFound) {
    if (cans.length === 0 || !cans[0]) C('canonical-missing', 'missing canonical');
    else {
      if (cans.length > 1) C('canonical-multiple', `${cans.length} canonical tags`);
      const c = cans[0];
      let u = null;
      try { u = /^https?:\/\//i.test(c) ? new URL(c) : null; } catch {}
      if (!u) C('canonical-not-absolute', `canonical is not absolute: "${c}"`);
      else {
        if (u.host !== ctx.host) C('canonical-host', `canonical host ${u.host} is not the production host ${ctx.host}: ${c}`);
        if (u.protocol !== 'https:') C('canonical-host', `canonical is not https: ${c}`);
        if (!slashOk(u.pathname, ctx.slash)) C('canonical-slash', `canonical does not match the trailing-slash policy (${ctx.slash}): ${c}`);
        const expect = policyPath(ctx.pathname, ctx.slash);
        if (decodeURI(u.pathname).replace(/\/$/, '') !== decodeURI(expect).replace(/\/$/, '')) C('canonical-not-self', `canonical ${c} does not reference this page (${expect})`);
      }
    }
  } else if (cans[0]) {
    try { if (new URL(cans[0]).host !== ctx.host) C('canonical-host', `404 canonical on wrong host: ${cans[0]}`); } catch {}
  }

  // Language
  if (!p.lang) C('lang-missing', '<html lang> missing');
  else if (ctx.lang && p.lang.toLowerCase().split('-')[0] !== ctx.lang.toLowerCase().split('-')[0]) C('lang-mismatch', `html lang="${p.lang}" but config lang is "${ctx.lang}"`);

  // Robots / indexing
  const robots = p.meta('robots').join(' ').toLowerCase() + ' ' + p.meta('googlebot').join(' ').toLowerCase();
  const pageNoindex = /noindex/.test(robots) || /noindex/.test((ctx.xRobotsTag || '').toLowerCase());
  const metaNoindex = /noindex/.test(robots);
  if (ctx.mode === 'preview' && !metaNoindex) C('preview-indexable', 'preview page has no <meta name="robots" content="noindex">');
  if (ctx.mode === 'launch' && pageNoindex && !ctx.isNotFound && !ctx.noindexAllowed) C('noindex-on-launch', `noindex left on a real page at launch (${robots.trim() || 'X-Robots-Tag'})`);

  // H1
  if (p.h1s.length !== 1) W('h1-count', `${p.h1s.length} <h1> tags (want exactly 1)`);

  // JSON-LD
  const types = new Set();
  const phonesInSchema = [];
  let hasRating = false;
  const ratingBad = [];
  const forbidden = [];
  p.jsonld.forEach((raw, i) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { C('jsonld-invalid', `JSON-LD block ${i + 1} is not valid JSON (${e.message.slice(0, 80)})`); return; }
    walkJson(data, (n) => {
      typesOf(n).forEach((t) => types.add(t));
      if ('telephone' in n) phonesInSchema.push(String(n.telephone));
      if ('aggregateRating' in n || 'review' in n || typesOf(n).includes('AggregateRating')) hasRating = true;
      if (typesOf(n).includes('AggregateRating') && n.reviewCount != null && !/^\d+$/.test(String(n.reviewCount))) ratingBad.push(String(n.reviewCount));
      for (const k of ctx.forbidSchemaKeys || []) if (k in n) forbidden.push(`${k}=${JSON.stringify(n[k]).slice(0, 60)}`);
      if (typesOf(n).includes('FAQPage')) {
        const qs = [].concat(n.mainEntity || []);
        const vis = p.visibleText.toLowerCase();
        const hidden = qs.filter((q) => q && q.name && !vis.includes(norm(String(q.name)).toLowerCase().slice(0, 60)));
        if (hidden.length) W('faq-not-visible', `FAQPage has ${hidden.length} question(s) not visible on the page`);
      }
    });
  });
  const lbTypes = ctx.localBusinessTypes || LOCAL_BUSINESS_TYPES;
  if (!ctx.isNotFound && ![...types].some((t) => lbTypes.has(t))) C('jsonld-localbusiness-missing', `no LocalBusiness JSON-LD (types found: ${[...types].join(', ') || 'none'})`);
  for (const t of phonesInSchema) if (digits10(t) !== phone) C('jsonld-phone-mismatch', `JSON-LD telephone ${t} does not match config phone ${ctx.phone}`);
  if (hasRating) W('jsonld-rating', `JSON-LD contains aggregateRating/review: must be real, visible on the page, and valid; never invented${ratingBad.length ? ` (invalid reviewCount ${ratingBad.map((x) => JSON.stringify(x)).join(', ')}: must be an integer)` : ''}`);
  if (/^\/services\/[^/]+\/?$/.test(ctx.pathname) && !types.has('Service')) W('jsonld-service-missing', 'service page has no Service JSON-LD');
  if (forbidden.length) C('jsonld-forbidden-key', `JSON-LD contains forbidden fields: ${forbidden.join('; ')}`);
  if (!ctx.isNotFound && ctx.pathname !== '/' && !types.has('BreadcrumbList')) W('jsonld-breadcrumb-missing', 'inner page has no BreadcrumbList JSON-LD');

  // Phones: tel: links and visible numbers
  const telLinks = p.links.filter((l) => l.href && /^tel:/i.test(l.href));
  const trackingTextInLinks = new Set();
  for (const l of telLinks) {
    const d = digits10(l.href);
    if (d === phone) continue;
    if (tracking && d === tracking && !l.inFooter) { trackingTextInLinks.add(l.text); continue; }
    C('tel-mismatch', `tel: link ${l.href} does not match config phone ${ctx.phone}${tracking && d === tracking ? ' (tracking number is not allowed in the footer)' : ''}`);
  }
  const seen = new Set();
  for (const ph of visiblePhones(p.visibleText)) {
    if (ph.d === phone || seen.has(ph.raw)) continue;
    seen.add(ph.raw);
    if (tracking && ph.d === tracking && ![...trackingTextInLinks].some((t) => t.includes(ph.raw))) {
      C('phone-mismatch', `tracking number ${ph.raw} appears outside a click-to-call button`);
    } else if (!(tracking && ph.d === tracking)) C('phone-mismatch', `visible phone ${ph.raw} does not match config phone ${ctx.phone}`);
  }
  if (tracking) for (const ph of visiblePhones(p.footerVisible)) if (ph.d === tracking) C('phone-mismatch', `tracking number ${ph.raw} in the footer (footer must use the NAP number)`);

  // Images
  const imgHosts = new Set([ctx.host, ...(ctx.internalHosts || []), ...(ctx.allowedImageHosts || [])]);
  const hot = new Set();
  for (const s of [...p.srcsets, ...p.styleUrls.map((url) => ({ url, tag: 'css' }))]) {
    const url = s.url || '';
    if (/^(data:|blob:)/i.test(url)) continue;
    if (/^(https?:)?\/\//i.test(url)) {
      try { const h = new URL(url, 'https://x.invalid').host; if (!imgHosts.has(h)) hot.add(`${h} (${s.tag}: ${url.slice(0, 90)})`); } catch {}
    }
  }
  for (const h of hot) C('image-hotlink', `image hotlinked from another host: ${h}`);
  const noAlt = p.imgs.filter((i) => !('alt' in i));
  if (noAlt.length) W('img-alt-missing', `${noAlt.length} <img> missing alt (e.g. ${(noAlt[0].src || '').slice(0, 70)})`);
  const noDims = p.imgs.filter((i) => !(i.width && i.height));
  if (noDims.length) W('img-dims-missing', `${noDims.length} <img> missing width/height (e.g. ${(noDims[0].src || '').slice(0, 70)})`);

  // Preview-only widgets and GTM
  const scriptBlob = p.scripts.map((s) => s.src + ' ' + s.body).join('\n') + '\n' + p.iframes.map((f) => f.src || '').join('\n');
  const widgets = PREVIEW_WIDGETS.filter(([, re]) => re.test(scriptBlob)).map(([n]) => n);
  if (widgets.length) {
    if (ctx.mode === 'launch') C('preview-widget', `preview-only widget on a launch build: ${widgets.join(', ')}`);
    else W('preview-widget', `preview-only widget present (allowed on previews only): ${widgets.join(', ')}`);
  }
  const gtm = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(scriptBlob);
  if (ctx.mode === 'launch' && ctx.requireGtm && !gtm) C('gtm-missing', 'GTM container snippet not found on a launch page');
  if (ctx.mode === 'preview' && gtm) W('gtm-on-preview', 'GTM renders on a preview (preview traffic would reach client analytics)');

  // Placeholder / internal-note text
  const scan = [title, desc, p.visibleText, ...p.imgs.map((i) => i.alt || '')].join(' \n ');
  const ph = scan.match(PLACEHOLDER_TEXT);
  if (ph) {
    const i = scan.indexOf(ph[0]);
    W('placeholder-text', `placeholder/internal text "${ph[0]}" near: "${scan.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, ' ').trim()}"`);
  }

  if (!p.hasMain) W('landmark-main', 'no <main> landmark');

  return {
    issues,
    facts: { title, desc, h1s: p.h1s, canonical: cans[0] || '', robots: robots.trim(), types: [...types], noindex: pageNoindex },
  };
}

/** Resolve an href to an internal path, or null if external/non-navigational. */
export function internalPath(href, pagePath, internalHosts) {
  if (href == null) return null;
  href = href.trim();
  if (!href || /^(mailto:|tel:|sms:|javascript:|data:|#)/i.test(href)) return null;
  let u;
  try { u = new URL(href, 'https://__page__' + pagePath); } catch { return null; }
  if (u.host !== '__page__' && !internalHosts.has(u.host)) return null;
  return { path: u.pathname, hash: u.hash.slice(1), raw: href };
}

export function findPlaceholderConfig(site) {
  const hits = [];
  const t = (k, v, re) => { if (v && re.test(String(v))) hits.push(`${k}=${JSON.stringify(v)}`); };
  t('url', site.url, /example|localhost|vercel\.app|clientdomain/i);
  t('name', site.name, /example|sample|placeholder|client name/i);
  t('legalName', site.legalName, /example|sample|placeholder/i);
  t('email', site.email, /example\.|@test\./i);
  const d = digits10(site.phone?.e164 || site.phone?.display);
  if (!d || /^\d{3}555\d{4}$/.test(d) || /^(\d)\1{9}$/.test(d)) hits.push(`phone=${JSON.stringify(site.phone?.display)}`);
  t('address.postal', site.address?.postal, /^0+$/);
  t('address.city', site.address?.city, /example|sample/i);
  t('primaryArea', site.primaryArea, /example|sample/i);
  for (const a of site.areaServed || []) t('areaServed', a.name, /example|sample/i);
  for (const s of site.sameAs || []) t('sameAs', s, /\/example\b|\.\.\./i);
  for (const k of ['tagline', 'description']) t(k, site[k], /example|sample|lorem|placeholder|TODO/i);
  return hits;
}
