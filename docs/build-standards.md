# OUTWORK'em DIGITAL: SEO Build Standards

These are the default rules for every client site we build. Follow them and a site should pass our audits: the OWD migration Dev Tracker, the Comfort One pre-launch punch list, and the Semrush-based inspection used for Distinct Designs. The rules come from those three audits (see `audit-sources-and-master-list.md`).

Severity tags follow the audits: **[C] Critical** = launch blocker, **[N] Normal**, **[L] Low**. A site does not launch with any open [C] rule.

Stacks: **Astro on Vercel** (primary) and **WordPress** (secondary). Where the implementation differs, both are given.

---

## 0. Single source of truth (set up first)

Create one config object per site. Every template, schema block, footer, and header reads from it. Never hand-type the NAP into a page.

Astro: `src/config/site.ts`
```ts
export const SITE = {
  url: 'https://www.clientdomain.com',   // production origin, final host (www or apex, pick one)
  name: 'Comfort One Air Conditioning',
  lang: 'en',
  phone: { display: '(480) 555-0100', e164: '+14805550100' },  // canonical NAP number
  trackingPhone: null,            // optional call-tracking number, only for click-to-call buttons
  address: { street: '', city: '', region: 'AZ', postal: '', country: 'US' },
  geo: { lat: 0, lng: 0 },
  hours: [{ days: 'Mo-Fr', opens: '07:00', closes: '18:00' }],
  license: 'ROC #000000',
  areaServed: ['Phoenix', 'Mesa', 'Chandler'],
  gbpUrl: 'https://g.page/...',
  sameAs: ['https://www.facebook.com/...', 'https://www.linkedin.com/company/...'],
  schemaType: 'HVACBusiness',     // LocalBusiness subtype: HVACBusiness, Plumber, RoofingContractor, GeneralContractor, Electrician, ProfessionalService...
  defaultOgImage: '/og/default.jpg',
} as const;
```
WordPress: store the same values in the SEO plugin (RankMath/Yoast Local SEO) and in one options page or theme `inc/site-config.php`. Templates read from there.

Rules:
- **[C]** Use one NAP phone number everywhere: site, schema, GBP, and citations. A call-tracking number may appear only in click-to-call buttons. The footer address block and schema always use the canonical NAP number. (OWD P0 #2, L4)
- **[N]** NAP, hours, and license number must match the Google Business Profile exactly. Confirm with the owner before launch. (Comfort One #18)

---

## 1. Preview stage vs. launch (indexing control)

Previews and staging are **noindexed three ways**, and **all three must be gone on the production domain at launch**:

| Layer | Preview (must be ON) | Launch (must be OFF on the production domain) |
|---|---|---|
| Meta robots | `<meta name="robots" content="noindex, nofollow">` in every page head | Tag absent, or `index, follow` |
| robots.txt | `User-agent: *` + `Disallow: /` | `Allow: /` (or no Disallow for real pages) + `Sitemap:` line |
| HTTP header | `X-Robots-Tag: noindex, nofollow` on every response | Header absent on the production host |

Also:
- **[C]** Previews must also be behind **Vercel Deployment Protection** (or host-level password on WP staging) when the client is not reviewing. A public, indexable preview is a full duplicate of production. (OWD P0 #1, Comfort One #13)
- **[C]** Canonicals on previews still point at the **production** domain, never `*.vercel.app`. (OWD P0 #4)
- Why all three: robots.txt `Disallow` stops crawling but not indexing of discovered URLs. The meta tag and the header only work if the page can be fetched. Together they cover every path. If a preview URL was already indexed, Disallow stops Google from seeing the noindex. In that case use the GSC Removals tool and let the noindex be crawled, rather than relying on Disallow alone.
- **Preview-only scripts** (Feedbucket and other feedback widgets, debug toolbars) load only when the site is in preview mode. **[C]** (OWD P0 #8)

### Astro/Vercel implementation
Use ONE explicit build flag. Do not infer indexability from `VERCEL_ENV` alone, because the pre-launch project's own production deployment is `VERCEL_ENV=production` too.

- Env var `SITE_INDEXABLE`: unset/`false` everywhere by default. At launch, set it to `true` **only in the Vercel Production environment**, then redeploy.

`src/lib/indexable.ts`
```ts
export const INDEXABLE = process.env.SITE_INDEXABLE === 'true';
```

In `src/components/SEOHead.astro` (see section 3):
```astro
{!INDEXABLE && <meta name="robots" content="noindex, nofollow" />}
```

`src/pages/robots.txt.ts` (do NOT also ship a static `public/robots.txt`):
```ts
import type { APIRoute } from 'astro';
import { INDEXABLE } from '../lib/indexable';
import { SITE } from '../config/site';
export const GET: APIRoute = () => new Response(
  INDEXABLE
    ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap-index.xml\n`
    : `User-agent: *\nDisallow: /\n`,
  { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
```

`vercel.json` header. Scope it to non-production hosts so it can never leak onto the live domain. It then keeps `*.vercel.app` aliases noindexed after launch, which is desirable:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "has": [{ "type": "host", "value": "(?<sub>.*)\\.vercel\\.app" }],
      "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
    }
  ]
}
```
If the preview uses a custom staging host (e.g. `staging.clientdomain.com`), add a second `has` rule for it. If you use a global (unscoped) header during preview instead, deleting it is a launch step.

Launch = set `SITE_INDEXABLE=true` in Production, remove any global noindex header rule, redeploy, and run the launch checks in `post-build-seo-check.md` §2 against the production domain.

### WordPress implementation
- Set `define('WP_ENVIRONMENT_TYPE', 'staging');` in `wp-config.php` on staging and `'production'` on live.
- Meta robots: Settings > Reading > "Discourage search engines" checked on staging. Also confirm that RankMath/Yoast has no sitewide noindex.
- robots.txt: don't trust the checkbox alone. Ship an explicit robots.txt (physical file, or the `robots_txt` filter) with `Disallow: /` on staging.
- Header: mu-plugin `wp-content/mu-plugins/owd-noindex.php`:
```php
<?php
if (function_exists('wp_get_environment_type') && wp_get_environment_type() !== 'production') {
  add_action('send_headers', function () { header('X-Robots-Tag: noindex, nofollow', true); });
  add_filter('robots_txt', fn() => "User-agent: *\nDisallow: /\n", 99);
  add_filter('wp_robots', fn($r) => array_merge($r, ['noindex' => true, 'nofollow' => true]));
}
```
- Launch: set the environment to `production`, uncheck "Discourage search engines", replace robots.txt with the production version, **purge every cache** (page cache plugin, host cache, Cloudflare), because cached HTML and headers keep the noindex alive, then run the launch checks.

---

## 2. Crawlability, URLs, and hosting

- **[C]** Pick one canonical host (www or apex) and one trailing-slash policy, and make every layer agree: config, links, canonicals, sitemap, and redirects. (Comfort One #15, #16)
  - Astro: `site: SITE.url`, `trailingSlash: 'always'`, `build: { format: 'directory' }` in `astro.config.mjs`. Add `"trailingSlash": true` in `vercel.json`. (Use `'never'` + `false` only if the old site had no slashes; on a migration, match the old site.)
  - Vercel: add both apex and www to the project and set the non-canonical one to redirect. HTTP to HTTPS is automatic.
  - WP: Settings > General URLs use `https://` + the canonical host; the permalink structure ends with `/`.
- **[C]** The deploy output contains only the site. No wireframes, PDFs, markdown drafts, `inspiration/`, `stdout`, or internal runbooks. Astro serves only `public/` + built pages, so keep working files out of `public/`. Never set the Vercel output directory to the repo root for a static HTML site. (OWD P0 #10)
- **[C]** Branded 404 page that returns **HTTP 404** (`src/pages/404.astro`; WP theme `404.php`), with links to services and the main CTA. (OWD P0 #9)
- **[C]** Clean, small response headers. Don't add large custom headers or cookies at the CDN; oversized headers caused crawl parse errors. (Distinct Designs, Critical)
- **[N]** Pages must answer fast and reliably (no timeouts or refused connections). Prefer static/SSG output on Vercel. On WP, use page caching and decent hosting, and target TTFB under 600 ms. (Distinct Designs, High)
- **[N]** Content is visible in the HTML without JavaScript. Scroll-reveal animations start visible; add the hidden state only after JS puts a class on `<html>`, and skip the animation under `prefers-reduced-motion: reduce`. (Comfort One #12, OWD #37)
  ```css
  html.js .reveal { opacity: 0; transition: opacity .4s; }
  html.js .reveal.is-visible { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { html.js .reveal { opacity: 1; transition: none; } }
  ```
- **[N]** No duplicate URLs for one page (`/home/`, `/index.html`, `OLD-Home`, `?replytocom`, `/page/1/`). Duplicates 301 to the canonical page. (Distinct Designs, Critical)
- **[N]** Thin pages (under ~300 words with no unique purpose) get expanded, merged, or `noindex`ed. (OWD #31)

## 3. Head tags on every page (on-page)

Build one `SEOHead` component (Astro) or configure the SEO plugin (WP). Every page passes `title`, `description`, optional `ogImage`, optional `noindex`.

```astro
---
import { SITE } from '../config/site';
import { INDEXABLE } from '../lib/indexable';
const { title, description, ogImage = SITE.defaultOgImage, noindex = false } = Astro.props;
const canonical = new URL(Astro.url.pathname, SITE.url).href;   // always production host
const img = new URL(ogImage, SITE.url).href;
---
<title>{title}</title>
<meta name="description" content={description} />
<link rel="canonical" href={canonical} />
{(!INDEXABLE || noindex) && <meta name="robots" content="noindex, nofollow" />}
<meta property="og:type" content="website" />
<meta property="og:site_name" content={SITE.name} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:url" content={canonical} />
<meta property="og:image" content={img} />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
```
Layout: `<html lang={SITE.lang}>`.

Rules:
- **[C]** `<html lang="en">` (or the real content language). Never leave template defaults such as `es`. (Comfort One #1)
- **[C]** Every page has a `<title>`. The homepage title = primary service + primary city/area + brand, e.g. "Custom Home Builder in Yucca Valley & Joshua Tree | Distinct Designs". Never "Home", "Logo", or a generic "Brand | Services". (Distinct Designs Critical; Comfort One #9)
- **[C]** One self-referencing absolute canonical on every page, on the production host, matching the trailing-slash policy. Exactly one canonical tag. (OWD P0 #4, Comfort One #5)
- **[N]** Title length 30 to 60 characters, key term first, brand suffix last. Drop the brand suffix on long post titles. Service pages may run to about 65 if the keywords earn it. Titles unique sitewide. (OWD #12, Distinct Designs)
- **[N]** Meta description on every page, unique, 140 to 160 characters, value proposition + CTA. No placeholder text ("WE are here for you", lorem ipsum). No em dashes (house style). (Comfort One #10, OWD #13, L5)
- **[N]** Exactly one `<h1>` per page, stating the page topic with its keyword. Logo, section titles, and cards use other elements or H2/H3. Don't put the site logo inside an `<h1>`. (Distinct Designs)
- **[N]** OG + Twitter tags on every page with a real 1200×630 image. (OWD P0 #4, Comfort One #7)
- **[L]** Favicon set: `favicon.ico`, SVG icon, 180px `apple-touch-icon.png`, 512px PNG in the manifest. (Comfort One #8, OWD #38)
- **[L]** No stale years in titles or copy. The footer copyright year is computed: `new Date().getFullYear()` in Astro, `<?php echo date('Y'); ?>` in WP. (Comfort One #11, OWD #32)
- WP: the SEO plugin (RankMath/Yoast) must output title, description, canonical, OG, and schema. Remove duplicate tags the theme also prints (two titles, two canonicals).

## 4. Content, conversion, and E-E-A-T

- **[C]** Every form delivers a lead end to end: correct webhook/workflow, correct `form_source`, all fields mapped. Keep a form-to-workflow table per site (like the Comfort One "Sheet1"). (Comfort One #14)
- **[N]** One page per core service, and one page per target city/service area, each with unique local copy, photos, and a dedicated keyword. One keyword maps to one page, so there is no cannibalization. (Distinct Designs High, OWD #28)
- **[N]** Hero on the home and service pages: H1, subhead, primary CTA button, and click-to-call. Phone number in the desktop header; sticky call/book bar on mobile. (OWD #21, #22)
- **[N]** Proof: testimonial on every service page, a proof stat + quote beside each pricing tier, client logos/badges on the homepage. Case studies carry a date, client quote, name/role, and a metrics block. (OWD #23 to #26)
- **[N]** Author entity: author page with bio, headshot, credentials, sameAs; bylines link to it. (OWD #27)
- **[N]** Posts and service pages get a 4 to 6 question FAQ, written the way people ask ChatGPT/Google, marked up as FAQPage. (OWD #30)
- **[N]** Reading level about grade 6 to 7 (Flesch-Kincaid) on service pages first. (OWD #29)
- **[N]** Visible local proof on About/Contact: full NAP, hours, license #, GBP link, map embed. It must match the schema exactly. (OWD #34, Comfort One #19)

## 5. Internal links

- **[C]** Nav, footer, and homepage cards link to the right, current URLs (no copy-paste of one URL across cards). (OWD L1 to L3)
- **[N]** Zero broken internal links. Run a link checker in CI or before every deploy (see post-build check). Internal links use the final URL form (trailing slash, no redirect hop). (OWD #15)
- **[N]** Icon fonts: every icon element gets `aria-hidden="true"`; prefer inline SVG. Ligature names like `trending_up` must never become anchor text. (OWD #33)
- **[L]** Blog posts link to their related service page; service pages link to related case studies. (Comfort One #20)

## 6. Images

- **[C]** No hotlinked images from another host or the old platform. All assets live in the repo (`src/assets` / `public/img`) or the WP media library of the new site. (OWD P0 #7)
- **[N]** Every content image has descriptive `alt` (subject + project type + location where natural). Decorative images use `alt=""`. (All three audits)
- **[L]** Every `<img>` has `width` and `height`. Astro: use `<Image />` / `<Picture />` from `astro:assets`, which sets dimensions and outputs WebP/AVIF. WP: core adds dimensions; don't strip them in the theme. (OWD #17)
- **[L]** Hero/LCP image: `loading="eager"` + `fetchpriority="high"`. Everything below the fold: `loading="lazy"`. (OWD #17)
- **[L]** WebP/AVIF at display size, with no image over ~300 KB unless it's a full-bleed hero. Don't deploy unused originals. (OWD #20, Comfort One #22)

## 7. Performance and Core Web Vitals

Targets (mobile, field or lab): **LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1**, Lighthouse Performance ≥ 90 on mobile for home and top service pages.
- **[L]** Shared CSS in one cacheable external stylesheet; inline only critical above-the-fold CSS. In Astro, keep `build.inlineStylesheets: 'auto'` and don't paste 40 to 60 KB of CSS into every page. (OWD #18)
- **[L]** Fonts: self-host, `font-display: swap`, subset. Icon fonts are subset (Material Symbols `&icon_names=`) or replaced with SVG. (OWD #19)
- **[L]** Third-party scripts (chat, reviews widgets, pixels) load through GTM and after the main content; no render-blocking third parties in `<head>`.
- WP: page cache + object cache, image optimization plugin (WebP), no page-builder bloat on key templates, only needed plugins.

## 8. Mobile and accessibility

- **[L]** No horizontal scroll at 360, 390, and 414 px. Common culprits: 100vw elements, wide images, negative margins, and unwrapped long words. (OWD #36)
- **[L]** Tap targets ≥ 44×44 px (never under 24 px) for nav, footer, social icons, and tel links. (OWD #38)
- **[L]** Landmarks: `<header>`, `<nav>`, `<main id="main">`, `<footer>`. Skip-to-content link as the first focusable element. Dropdowns and the mobile menu toggle `aria-expanded`. (OWD #35)
- **[N]** Respect `prefers-reduced-motion`. (Comfort One #12)

## 9. Structured data (JSON-LD)

- **[C]** Sitewide: the LocalBusiness subtype from `SITE.schemaType` (or `Organization`/`ProfessionalService` for our agency), with `name`, `url`, `telephone` (canonical NAP), `address`, `geo`, `areaServed`, `openingHoursSpecification`, `sameAs`, `logo`, `image`. Plus `WebSite`. Generated from `SITE`, never typed by hand. (OWD P0 #3, Comfort One #6, Distinct Designs)
- **[N]** `BreadcrumbList` on every inner page. `Service` on service pages (with `provider` referencing the business `@id` and `areaServed`). `FAQPage` only where the FAQ is visible on the page. `Article`/`BlogPosting` on posts with `author` → `Person` (with `url` to the author page and `sameAs`), `datePublished`, `dateModified`.
- **[N]** Use stable `@id`s (`${SITE.url}/#business`, `${SITE.url}/#website`) and cross-reference them.
- **[N]** Must validate with zero errors in the Rich Results Test and validator.schema.org. Schema values must match the visible page text.
- WP: RankMath/Yoast provides Organization/WebSite/Breadcrumb/Article. Set the LocalBusiness subtype and fill in the Local SEO fields. Add Service and FAQ via plugin blocks. Don't stack a second schema plugin.

Astro pattern:
```astro
<script type="application/ld+json" set:html={JSON.stringify(graph)} />
```

## 10. Sitemaps and robots

- **[C]** A sitemap that lists **only** canonical, indexable, 200-status URLs in the final URL form. Astro: `@astrojs/sitemap` (outputs `/sitemap-index.xml`) with a `filter` that excludes noindexed pages, 404, and thank-you pages. WP: the SEO plugin sitemap (`/sitemap_index.xml`), with noindexed post types and taxonomies excluded. (Comfort One #3, OWD #9)
- **[C]** Production robots.txt exists, doesn't block real pages, CSS, or JS, and includes the `Sitemap:` line. (Comfort One #4)
- **[L]** If the footer shows "Sitemap", it links to an HTML sitemap or the XML sitemap. (OWD #9)

## 11. Security / HTTPS

- **[C]** HTTPS only, with HTTP 301/308 to HTTPS in one hop, and a valid certificate on both apex and www. (Comfort One #15)
- **[N]** No mixed content: every `src`/`href` asset is `https://` or relative.
- **[N]** Recommended headers on production (vercel.json `headers` or WP host/plugin): `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Keep the total header size small.
- **[C]** No internal documents, source files, `.env`, or backups reachable by URL. (OWD P0 #10)

## 12. Analytics and Search Console

- **[C]** Production has the GTM container sitewide, with GA4 (+ Meta pixel or other client pixels) inside it. Verify pageview, form submit, click-to-call, and booking (including iframe booking such as GHL `/schedule/`) events. (OWD P0 #5)
- **[N]** Tags fire only on the production host (GTM trigger on hostname, or render GTM only when `INDEXABLE`), so preview traffic stays out of client data.
- **[C]** GSC: domain property verified (DNS). Sitemap submitted at launch. On a migration, keep the old property/sitemap history. (OWD #9)

## 13. Migration / redesign rules (only when replacing an existing site)

- **[C]** Before building, export every existing URL: the old sitemap(s), a Screaming Frog crawl of the live site, the GSC Pages report (indexed URLs), GSC top pages by clicks, and top backlinked pages. Put them all in a redirect map (Old URL / Source / Destination or Action), like the OWD "301 Redirect Map" tab.
- **[C]** Keep existing URLs wherever possible (same slugs, same trailing-slash style). Anything that changes gets a **one-hop 301** to its closest equivalent. Never 301 everything to the homepage.
  - Astro/Vercel: `vercel.json` `"redirects": [{ "source": "/old-path/", "destination": "/new-path/", "statusCode": 301 }]`. Vercel's `"permanent": true` sends 308, which is also a permanent redirect.
  - WP: RankMath Redirections or the Redirection plugin, or server rules.
- **[C]** Redirect the old sitemap URL (e.g. `/sitemap_index.xml`) to the new one.
- **[C]** Download and re-host every asset the old platform served (`/wp-content/uploads/*`) before the old site is shut off.
- **[N]** Preserve title, H1, and meta keywords on money pages unless GSC shows they don't drive impressions. Carry over trust elements (logos, badges, testimonials), existing tracking IDs, and existing schema coverage.
- **[N]** Rebuild high-value pages (press mentions, AI-cited posts, careers) instead of redirecting them.
- **[N]** When refreshing content (year updates), keep the URL.
- **[N]** Rebrand remnants (slugs, anchors, alt text) get renamed, and old slugs 301.
- **[C]** While the old site is still live, fix its broken nav/footer links and NAP conflicts so the cutover doesn't inherit errors.
