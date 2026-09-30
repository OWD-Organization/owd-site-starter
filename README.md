# OWD Site Starter

The OUTWORK'em DIGITAL starter for client websites: **Astro (static output) on Vercel, with SEO built in
from the first commit** and a build-time **SEO gate** that checks every page.

It contains **no client data**. Every value in `src/config/site.ts` is a clearly marked example.

- Build rules for agents: [`AGENTS.md`](AGENTS.md) and `.cursor/rules/seo-standards.mdc` (always applied)
- Full standards: [`docs/build-standards.md`](docs/build-standards.md) · checklist: [`docs/post-build-seo-check.md`](docs/post-build-seo-check.md)

## Start a new client site (plain steps)

1. On GitHub, open this repo and click **Use this template > Create a new repository**. Owner
   `OWD-Organization`, name `<client>-website`. Private is fine (the Vercel team `teamowds-projects` is on Pro). Make sure the Cursor GitHub app can access the new repo so cloud agents can work on it.
2. Open `src/config/site.ts` and replace every example value with facts the client confirmed
   (name, phone, email, city, hours, towns, social links, schema type). Leave unknown values empty.
   Do not invent reviews, ratings, license numbers, or a street address.
3. Replace `src/assets/hero.jpg`, `public/og/default.jpg` (1200x630), and the icons in `public/`
   (`favicon.ico`, `icon.svg`, `apple-touch-icon.png` 180px, `icon-192.png`, `icon-512.png`).
4. Edit services in `src/data/services.ts` (one page each at `/services/<slug>/`) and towns in
   `SITE.areaServed` (one page each at `/service-area/<slug>/`). Write real, unique copy.
5. In Vercel, **Add New > Project**, import the new repo. Framework: Astro. Leave `SITE_INDEXABLE` unset.
   Every deploy is a noindexed preview.
6. Run `npm run seo:strict` locally (or read the PR check) and fix every critical item before review.
7. After deploy: `npm run seo:live -- https://<project>.vercel.app --expect-host <production host>`.

## Preview vs launch

| | Preview (default) | Launch |
|---|---|---|
| `SITE_INDEXABLE` | unset / `false` | `true`, **Vercel Production env only** |
| Meta robots | `noindex, nofollow` on every page | removed (except `SITE.noindexPaths` and 404) |
| `robots.txt` | `Disallow: /` | `Allow: /` + `Sitemap:` line |
| `X-Robots-Tag` | `noindex, nofollow` on `*.vercel.app` (vercel.json) | still on `*.vercel.app` only; never on the real domain |
| GTM | never rendered | rendered when `PUBLIC_GTM_ID` is set |
| SEO gate | reports critical issues as `CRITICAL (preview: not blocking)`, **build succeeds** | **any critical issue fails the build** |

**Previews always publish. Only launch is blocked.**

### How launch works
1. Get Orion's go-ahead. Make sure `npm run seo:launch-check` passes locally (a launch-mode build).
2. In Vercel > Project > Settings > Environment Variables, set **for Production only**:
   `SITE_INDEXABLE=true` and `PUBLIC_GTM_ID=GTM-XXXXXXX` (the client's container).
3. Attach the domain (both apex and www; redirect the non-canonical one to `SITE.url`'s host).
4. **Redeploy** production. If the gate finds a critical issue, the deploy fails and the old one stays live.
5. Run the live check on the real domain: `npm run seo:live -- https://www.clientdomain.com --launch`.
   Then do Stage 2 of `docs/post-build-seo-check.md` (GSC sitemap submit, URL inspection, analytics, forms).

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | `astro build && node scripts/seo-gate.mjs` (Vercel runs this) |
| `npm run seo:strict` | build + gate that fails on any critical issue regardless of the flag (used by the PR Action) |
| `npm run seo:launch-check` | build + gate in launch mode (`SITE_INDEXABLE=true`) |
| `npm run seo:gate` | re-run the gate on an existing `dist/` |
| `npm run seo:live -- <url>` | live post-deploy check (Node port of `seo-quick-audit.py` + the gate's page checks): sitemap + crawl, headers, robots, 404, stray files, broken links |
| `npm run test:gate` | self-test: deliberate breaks must be flagged (see proof below) |

The gate report prints to the build log and is saved to `.owd/seo-gate-report.txt` / `.json`
(outside `dist/`, never deployed). The GitHub Action (`.github/workflows/seo-gate.yml`) runs
`seo:strict` + `test:gate` on PRs as a **non-blocking** status check. Do not make it a required check.

## What the gate checks

**Critical** (reported on previews, blocks launch builds and `seo:strict`):
- missing/empty `<title>`, more than one `<title>`, generic homepage title ("Home", "Logo", brand only)
- canonical missing, not absolute, more than one, not on the production host, not self-referencing, or breaking the trailing-slash policy
- `<html lang>` missing or not matching `SITE.lang`
- sitemap missing, or listing the 404 page, noindexed pages, missing pages, other hosts, or wrong slash form
- `robots.txt` missing from the build
- no LocalBusiness JSON-LD, invalid JSON-LD, or a JSON-LD `telephone` that doesn't match `SITE.phone`
- any `tel:` link or visible phone number that doesn't match `SITE.phone` (a `SITE.trackingPhone` is allowed only on click-to-call links, never in the footer or schema)
- images hotlinked from another host (`img`, `srcset`, `source`, CSS `url()`)
- broken internal links or assets (links to pages that don't exist)
- stray working files in `dist/` (`.md`, `.pdf`, `.env`, backups, `inspiration/`, `docs/`, `src/`, `README`, etc.)
- preview mode: a page without `noindex`, `robots.txt` without `Disallow: /`, no `X-Robots-Tag` rule in `vercel.json`
- launch mode only: placeholder values in `site.ts`, `noindex` left on real pages, `Disallow: /` or no `Sitemap:` line in robots.txt, missing GTM ID / snippet, preview-only widgets (Feedbucket, Marker.io, Vercel toolbar...), an unscoped `X-Robots-Tag` rule, `trailingSlash` mismatch

**Warnings** (never block):
- title outside 30 to 60 chars; description missing or outside 140 to 160; em dash in description; duplicate titles/descriptions
- not exactly one `<h1>`
- content images without `alt`; images without `width`/`height`
- leftover placeholder/TODO/lorem/draft/"replace this" text
- OG/Twitter incomplete, no favicon, no BreadcrumbList on inner pages, no Service schema on service pages, FAQPage questions not visible, `aggregateRating`/reviews in schema (verify they're real)
- indexable page missing from the sitemap, internal links not in final URL form, missing `#anchors`, GTM on a preview, placeholder config (on previews)

**What the gate can't judge** (manual, see `docs/post-build-seo-check.md`): whether facts match the GBP, whether
copy is unique and good, whether forms deliver leads, Core Web Vitals, visual design, Deployment Protection,
and GSC/GA4 setup.

## Proof the gate works

`npm run test:gate` output (each break runs in a temp copy, so the real source is never changed and every break is reverted automatically):

| Break | Rule | Preview build (npm run build) | Strict gate (seo:strict / launch) |
|---|---|---|---|
| clean template | n/a | exit 0 yes | exit 0 (passes) |
| LAUNCH build of the untouched template (SITE_INDEXABLE=true) | config-placeholder, gtm-id-missing, gtm-missing | n/a | exit 1 (launch blocked) |
| LAUNCH build with filled test config + GTM ID | n/a | n/a | exit 0 (launch passes); robots: "User-agent: * / Allow: / / Sitemap: https://www.acme-test-plumbing.com/sitemap-index.xml"; meta noindex: absent; GTM: present |
| remove the canonical tag | canonical-missing | exit 0, labeled critical: yes | exit 1, FAIL [canonical-missing]: yes |
|  |  |  |   FAIL      [canonical-missing] missing canonical |
| hard-code a mismatched phone in the footer | tel-mismatch | exit 0, labeled critical: yes | exit 1, FAIL [tel-mismatch]: yes |
|  |  |  |   FAIL      [tel-mismatch] tel: link tel:+15555550199 does not match config phone +15555550100 |
| remove the <title> | title-missing | exit 0, labeled critical: yes | exit 1, FAIL [title-missing]: yes |
|  |  |  |   FAIL      [title-missing] missing or empty <title> |
| hotlink an image from another host | image-hotlink | exit 0, labeled critical: yes | exit 1, FAIL [image-hotlink]: yes |
|  |  |  |   FAIL      [image-hotlink] image hotlinked from another host: old-site.example.net (img: https://old-site.example.net/wp-content/uploads/van.jpg) |
| link to a page that does not exist | broken-internal-link | exit 0, labeled critical: yes | exit 1, FAIL [broken-internal-link]: yes |
|  |  |  |   FAIL      [broken-internal-link] internal link/asset to a missing page: link /services/does-not-exist/ |
| leave a working file in public/ | stray-file | exit 0, labeled critical: yes | exit 1, FAIL [stray-file]: yes |
|  |  |  |   FAIL      [stray-file] working/internal file deployed: /notes.md |
| wrong html lang | lang-mismatch | exit 0, labeled critical: yes | exit 1, FAIL [lang-mismatch]: yes |
|  |  |  |   FAIL      [lang-mismatch] html lang="es" but config lang is "en" |

SELF-TEST PASSED

## Project layout

```
src/config/site.ts        single source of truth (example placeholders)
src/lib/indexable.ts      SITE_INDEXABLE flag
src/lib/schema.ts         JSON-LD builders (LocalBusiness subtype, WebSite, BreadcrumbList, Service, FAQPage)
src/components/SEOHead.astro, JsonLd.astro, Gtm.astro, Header.astro (nav), Footer.astro, Hero.astro, Faq.astro, Breadcrumbs.astro
src/layouts/Base.astro    html lang, head, skip link, landmarks, reveal script
src/pages/                /, /services/, /services/<slug>/, /service-area/, /service-area/<slug>/, /about/, /contact/, 404, robots.txt, site.webmanifest
scripts/seo-gate.mjs      build gate (dist/)
scripts/seo-live.mjs      live check (deployed URL)
scripts/lib/seo-core.mjs  shared checks, no dependencies
docs/                     standards (not deployed)
vercel.json               trailingSlash, X-Robots-Tag on *.vercel.app, security headers
```

Demo (noindexed, no custom domain): https://owd-site-starter.vercel.app
