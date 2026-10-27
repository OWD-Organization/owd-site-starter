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
   Every deploy is a noindexed preview. Set environment variables in Vercel, not in GitHub.
6. Run `npm run build` and read the warnings. They do not fail a local or preview build.
7. After deploy: `npm run seo:live -- https://<project>.vercel.app --expect-host <production host>`.

## Preview vs launch

| | Preview (default) | Launch |
|---|---|---|
| `SITE_INDEXABLE` | unset / `false` | `true`, **Vercel Production env only** |
| Meta robots | `noindex, nofollow` on every page | removed (except `SITE.noindexPaths` and 404) |
| `robots.txt` | `Disallow: /` | `Allow: /` + `Sitemap:` line |
| `X-Robots-Tag` | `noindex, nofollow` on `*.vercel.app` (vercel.json) | still on `*.vercel.app` only; never on the real domain |
| GTM | never rendered | rendered when `PUBLIC_GTM_ID` is set |
| SEO gate | every issue is a **warning**, build **exits 0** | **fails only** on the production criticals below |

`SITE_INDEXABLE` changes indexing. It does not, by itself, pass or fail the gate.

## SEO gate SOP

Set these in **Vercel → Project → Settings → Environment Variables**. Do not set them in GitHub. The PR Action forces `VERCEL_ENV=preview` and always exits 0.

| Variable | Where | What it does |
|---|---|---|
| `VERCEL_ENV` | Set by Vercel. `production` only on Production deploys. Preview and staging are not production. | **The only switch that can fail the build.** Anything other than `production` (local, PR Action, preview, staging) prints every issue as a warning and exits 0. |
| `SITE_INDEXABLE` | Unset everywhere. Set `true` **only in the Production environment, on launch day**, after Orion's go-ahead. | Turns noindex off, switches `robots.txt` to `Allow: /`, and allows GTM to render. Does not decide the exit code. |
| `PUBLIC_GTM_ID` | Production, when the client has a container (`GTM-XXXX`). | Optional. A missing or malformed GTM, GA4, or pixel ID is a warning. |
| `PUBLIC_GA4_ID` | Only if the client tags GA4 directly (`G-XXXX`). Usually GA4 lives inside GTM, so leave this unset. | A malformed value is a warning. |

Check the production rules locally before launch day:

```bash
npm run seo:prod-check
```

That builds, then runs the gate with `VERCEL_ENV=production`. Fix every `FAIL` line. The line says what broke and how to fix it.

### Fails a production build only

1. **Build or page did not render** (`render-failure`). The homepage or a built file is missing or is an error page. Fix the build error and run `npm run build` again.
2. **`SITE_INDEXABLE=true` but noindex is still on** (`noindex-on-launch`, `robots-disallow-launch`, `x-robots-on-real-domain`). A real page still has a robots noindex meta, `robots.txt` still has `Disallow: /`, or `vercel.json` sends `X-Robots-Tag: noindex` on the live domain. The 404 may stay noindex. The `*.vercel.app` header must stay.
3. **`SITE_INDEXABLE` is not true, but the site is indexable** (`preview-indexable`, `robots-preview-open`). A page is missing `<meta name="robots" content="noindex">`, or `robots.txt` does not disallow everything.
4. **Canonical or sitemap URL on the wrong domain** (`canonical-host`, `sitemap-host`). The host is `vercel.app` or is not `SITE.url`. Set `SITE.url` to the real https origin and rebuild.
5. **Broken internal link, or a key page 404s** (`broken-internal-link`, `key-page-missing`, `sitemap-404`). A link or asset points at a file that was not built, or `/`, `/about/`, `/contact/`, or `/services/` is missing.
6. **Placeholder copy in the built pages** (`placeholder-output`): the word `TODO`, `lorem ipsum`, a `555` phone number, `example.com`, or a `#TODO` link. Replace them in `src/config/site.ts` and the page files.
7. **Form or booking control with nowhere to go** (`dead-destination`): `href` or `action` is empty or `#`.
8. **Secret or API key in the built files** (`secret-exposed`), including a published `.env`. Remove it, rotate the key, and use Vercel env vars.
9. **Missing favicon** (`favicon-missing`): `public/favicon.ico` did not make it into the build.
10. **Missing branded 404** (`branded-404-missing`): no `dist/404.html`, or the page does not show the business name and header.

### Warnings only (never fail the build)

GTM, GA4, and pixel IDs (missing or malformed). Meta titles and descriptions. Open Graph and Twitter tags. Image alt text, dimensions, and hotlinks. Schema / JSON-LD. Speed, CLS, and other performance notes. A privacy page. Contrast and tap targets. Stray files that are not secrets. Phone mismatches that are not a `555` placeholder. Everything else the gate prints.

### How launch works
1. Get Orion's go-ahead. Run `npm run seo:prod-check` and clear every `FAIL` line.
2. In Vercel, **Production only**: `SITE_INDEXABLE=true` and `PUBLIC_GTM_ID=GTM-XXXXXXX` (the client's container). Do not add these in GitHub.
3. Attach the domain (apex and www; redirect the non-canonical host to `SITE.url`).
4. **Redeploy** production. Vercel sets `VERCEL_ENV=production` on that deploy. A `FAIL` stops the deploy and the previous one stays live. Preview deploys still publish.
5. Run `npm run seo:live -- https://www.clientdomain.com --launch`, then Stage 2 of `docs/post-build-seo-check.md`.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | `astro build && node scripts/seo-gate.mjs`. Local and preview: warnings, exit 0. |
| `npm run seo:prod-check` | same build, then the gate with `VERCEL_ENV=production` (the launch-day check) |
| `npm run seo:launch-check` | build with `SITE_INDEXABLE=true` so you can read the indexable HTML. Does not fail unless you also set `VERCEL_ENV=production`. |
| `npm run seo:strict` | same as `npm run build` (older command name; it does not add a stricter exit code) |
| `npm run seo:gate` | re-run the gate on an existing `dist/` |
| `npm run seo:live -- <url>` | live check. Preview exits 0. `--launch` fails only on the same production criticals. |
| `npm run test:gate` | self-test of both modes (temp copies; source is not modified) |

The report prints in the build log and is saved to `.owd/seo-gate-report.txt` / `.json`
(outside `dist/`, never deployed). The GitHub Action (`.github/workflows/seo-gate.yml`) runs on
pull requests with `VERCEL_ENV=preview`. Site warnings do not fail that job. Do not set
`VERCEL_ENV=production` or `SITE_INDEXABLE` in GitHub.

The gate still reports titles, descriptions, canonical shape, language, schema, phone mismatches, hotlinked images, alt text, headings, and stray files. Off production those are warnings. On production, only the ten items in the SOP above fail the build. Broken links are in that list. A missing `<title>`, a hotlinked image, or a mismatched phone that is not a `555` number stays a warning.

Speed, CLS, contrast, tap targets, and a privacy page are not launch blockers. Confirm those by hand with `docs/post-build-seo-check.md`. The gate also cannot judge whether facts match the Google Business Profile, whether the copy is any good, or whether a form actually delivers a lead.

## Proof the gate works

`npm run test:gate` builds temp copies (the repo source is not modified) and checks both modes. Locally, `SITE_INDEXABLE=true` with no GTM id still exits 0. `VERCEL_ENV=production` is what blocks.

| Case | Rule | Result |
|---|---|---|
| template, local / preview (no VERCEL_ENV) | placeholder-output | exit 0 (warn, not blocked) |
| template, SITE_INDEXABLE=true, VERCEL_ENV unset, no GTM | placeholder-output | exit 0 (still not blocked) |
| template, VERCEL_ENV=production | placeholder-output | exit 1 (blocked, Fix: present) |
| production + real config + SITE_INDEXABLE=true, no GTM | gtm-id-missing | exit 0 (GTM is a warning) |
| inject noindex while indexable | noindex-on-launch | exit 1 (production FAIL) |
| canonical on vercel.app | canonical-host | exit 1 (production FAIL) |
| sitemap URL on the wrong domain | sitemap-host | exit 1 (production FAIL) |
| robots.txt still disallows everything | robots-disallow-launch | exit 1 (production FAIL) |
| X-Robots-Tag on the real domain | x-robots-on-real-domain | exit 1 (production FAIL) |
| broken internal link | broken-internal-link | exit 1 (production FAIL) |
| key page missing | key-page-missing | exit 1 (production FAIL) |
| homepage did not render | render-failure | exit 1 (production FAIL) |
| TODO left in the page | placeholder-output | exit 1 (production FAIL) |
| form action is # | dead-destination | exit 1 (production FAIL) |
| live secret in the HTML | secret-exposed | exit 1 (production FAIL) |
| favicon.ico removed | favicon-missing | exit 1 (production FAIL) |
| branded 404 removed | branded-404-missing | exit 1 (production FAIL) |
| title removed (warning only) | title-missing | exit 0 (warning, production still passes) |
| same broken link, VERCEL_ENV=preview | broken-internal-link | exit 0 (warning only) |
| production, SITE_INDEXABLE unset, real config | n/a | exit 0 (noindex is correct) |
| production, flag off, but page has no noindex | preview-indexable | exit 1 |
| production, flag off, robots.txt allows crawling | robots-preview-open | exit 1 |

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
scripts/lib/seo-blockers.mjs  production-only critical rules and fix text
docs/                     standards (not deployed)
vercel.json               trailingSlash, X-Robots-Tag on *.vercel.app, security headers
```

Demo (noindexed, no custom domain): https://owd-site-starter.vercel.app
