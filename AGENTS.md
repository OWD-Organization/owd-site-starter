# AGENTS.md: rules for every builder agent working in this repo

This repo is the OUTWORK'em DIGITAL (OWD) client-site starter. Every site built from it must
follow our SEO build standards. **They are mandatory, not suggestions.**

- Full standards: [`docs/build-standards.md`](docs/build-standards.md)
- Post-build checklist: [`docs/post-build-seo-check.md`](docs/post-build-seo-check.md)
- The same short rules are in `.cursor/rules/seo-standards.mdc` (always applied).

## The gate (read this first)

`npm run build` = `astro build && node scripts/seo-gate.mjs`. The gate scans `dist/` and prints a
per-page report to the build log (also saved to `.owd/seo-gate-report.txt`, never deployed).

- **Previews always publish.** With `SITE_INDEXABLE` unset (every preview), critical issues print
  as `CRITICAL (preview: not blocking)` and the build still succeeds. Work can always be saved and previewed.
- **Only launch is blocked.** With `SITE_INDEXABLE=true` (set only in Vercel Production at launch),
  any critical issue fails the build.
- Before you finish any task, run `npm run seo:strict` (fails on any critical issue regardless of the
  flag) and fix every critical item it reports. The GitHub Action runs the same check on PRs as a
  non-blocking status. Treat a red check as your bug. Do not weaken the gate to make it pass.
- Also run `npm run test:gate` if you touch `scripts/`.

## Key rules (short form)

1. **One source of truth.** Business name, phone, email, address, hours, areas, social links, schema type,
   and GTM ID live only in `src/config/site.ts`. Titles, schema, header, and footer read from it.
   Never hand-type the phone or NAP into a page.
2. **No invented business facts.** Use only facts the client confirmed or that are already on their
   current site/GBP. Never invent reviews, ratings, `aggregateRating`, license numbers, street addresses,
   years in business, awards, or service areas. If a fact is unknown, leave it empty and ask.
3. **Client-facing previews contain no internal notes, TODOs, draft labels, lorem ipsum, or
   "replace this" text.** Put notes in code comments, the PR description, or `docs/`, never in page copy.
4. **Indexing.** Previews are noindexed three ways (meta robots, dynamic `robots.txt`, `X-Robots-Tag`
   on `*.vercel.app` in `vercel.json`). Controlled only by `SITE_INDEXABLE`. Do not add a static
   `public/robots.txt`. Do not infer indexability from `VERCEL_ENV`.
5. **Head tags.** Every page uses `Base.astro` / `SEOHead`: one `<title>` (30 to 60 chars, key term first,
   brand last), meta description (140 to 160, no em dashes), one self-referencing absolute canonical on the
   PRODUCTION host (never vercel.app) in the trailing-slash policy, OG + Twitter tags. Homepage title =
   primary service + area + brand, never "Home" or "Logo". `<html lang>` comes from config.
6. **One `<h1>` per page.** The logo is never an h1.
7. **JSON-LD from config only:** LocalBusiness subtype (`SITE.schemaType`) + WebSite sitewide,
   BreadcrumbList on inner pages, Service on service pages, FAQPage only where the FAQ is visible.
8. **URLs.** Trailing slash `always` (config, astro.config, vercel.json agree). Internal links use the final
   form (`/services/`, not `/services`). One page per service at `/services/<slug>/`, one per town at
   `/service-area/<slug>/`. Zero broken links.
9. **Images** live in the repo (`src/assets` via `astro:assets`, or `public/`). No hotlinking. Every content
   image has alt text; decorative images use `alt=""`. Width/height always set. Hero: `loading="eager"` +
   `fetchpriority="high"`; everything else lazy.
10. **Nothing but the site in `dist/`.** Keep drafts, PDFs, markdown, screenshots, `inspiration/`, and notes
    out of `public/`.
11. **Analytics.** GTM renders only when `SITE_INDEXABLE=true` and `PUBLIC_GTM_ID` is set. Never commit a
    real container ID into the template. Preview-only widgets (Feedbucket etc.) render only on previews.
12. **Content visible without JS.** Use the `.reveal` pattern (hidden only after `html.js`, disabled under
    `prefers-reduced-motion`).
13. **Accessibility.** Landmarks (`header`, `nav`, `main#main`, `footer`), skip link first, tap targets 44px.

## Nav rules (mandatory)

- **Services AND Service Area are both dropdowns on desktop**, nested the same way in the mobile menu.
- **Every top-level nav item, dropdown triggers included, uses ONE shared class: `.nav-link`.** Style nav
  with that class. Never use structural selectors (`li:nth-child`, `nav > ul > li > a`) to style items.
- **Only one dropdown open at a time.** Triggers are `<button>`s that toggle `aria-expanded`.
- The mobile hamburger shows a visible **"MENU"** label.
- The header phone number shows on desktop; a **tap-to-call button** shows on mobile.

## Launch (never do this without Orion's go-ahead)

Set `SITE_INDEXABLE=true` and `PUBLIC_GTM_ID` in the Vercel **Production** environment only, attach the
domain, redeploy, then run `npm run seo:live -- https://<production-host> --launch`.
