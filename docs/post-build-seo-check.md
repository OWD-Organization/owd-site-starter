# OUTWORK'em DIGITAL: Post-Build SEO Check

Run this on every site: **Stage 1** on the preview before launch, **Stage 2** on launch day on the production domain, **Stage 3** 1 to 14 days after launch. Add **Stage M** for any migration or redesign.

Severity: **C = Critical** (launch blocker, must pass), **N = Normal** (fix before launch or schedule with an owner/date), **L = Low** (backlog). This matches the audits: P0/Critical/Blocker → C; P1/High/Medium → N; P2/Low → L.

Record results in a punch list: #, Issue, Category, Severity, Status (Not Fixed / Fixed / Needs Verification), Scope, Fix, Blocker?, Notes, Assignee. **Status must agree with the notes.** A row is "Fixed" only after a re-check that shows the passing result. (The Comfort One sheet shows why: its status column said FIXED while its notes said "still 404".)

Variables used below:
```bash
PREV=https://project-name.vercel.app        # preview
PROD=https://www.clientdomain.com           # final canonical origin
APEX=clientdomain.com; WWW=www.clientdomain.com
```

## Tools
- `curl` (headers, redirects, robots, sitemap)
- `seo-quick-audit.py` (in this folder; stdlib Python, GET only): per-URL title/meta/H1/canonical/robots/OG/JSON-LD/alt/lang/hotlink check across the sitemap, plus duplicate title/description and multi-phone detection. Exit code 1 = at least one FAIL.
  ```bash
  python3 seo-quick-audit.py $PREV --expect-host $WWW --preview   # stage 1: expects noindex everywhere
  python3 seo-quick-audit.py $PROD                                # stage 2: any noindex = FAIL
  ```
- Screaming Frog SEO Spider (full crawl, response codes, duplicates, directives, images, redirect chains, list mode for redirect maps)
- `npx linkinator <url> --recurse` (broken links; add `--skip` patterns for external hosts if needed)
- Lighthouse / PageSpeed Insights (`npx lighthouse <url> --only-categories=performance,seo,accessibility --form-factor=mobile --screenEmulation.mobile` or pagespeed.web.dev)
- Rich Results Test (search.google.com/test/rich-results) + validator.schema.org
- Chrome DevTools device mode (360/390/414 px), Google Search Console, GTM Preview / GA4 DebugView

---

## Stage 1: Preview (before launch)

### 1A. Preview is protected and noindexed three ways
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.1 | C | Meta robots noindex on every page | `curl -s $PREV/ \| grep -io '<meta[^>]*name="robots"[^>]*>'`; `seo-quick-audit.py --preview` | `noindex` present on every sitemap URL (audit shows no "preview page is indexable") |
| 1.2 | C | robots.txt disallows all | `curl -s $PREV/robots.txt` | `User-agent: *` + `Disallow: /` |
| 1.3 | C | X-Robots-Tag header | `curl -sI $PREV/ \| grep -i x-robots-tag`; repeat for a deep page and `/sitemap-index.xml` | `X-Robots-Tag: noindex` on every response |
| 1.4 | C | Deployment Protection / password when not in client review | Open the preview in a private window | Vercel auth or password prompt (or documented exception during review) |
| 1.5 | C | Preview not already indexed | Google `site:<preview-host>` | 0 results. If any: GSC Removals + keep noindex crawlable |
| 1.6 | C | Preview-only scripts gated | View source on the preview vs. a production build; grep for `feedbucket` | Only present when not indexable |

### 1B. Crawlability, files, and status codes
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.7 | C | All pages 200, no crawl errors | Screaming Frog crawl (Response Codes: 4xx, 5xx, "No Response", timeouts) | 0 errors, 0 timeouts, 0 refused connections |
| 1.8 | C | Valid, small headers | `curl -sI $PREV/ \| wc -c`; Screaming Frog has no parse errors | Header block well under 8 KB; no parse errors |
| 1.9 | C | 404 page | `curl -s -o /dev/null -w '%{http_code}\n' $PREV/this-should-404/` | Status 404, branded page with links |
| 1.10 | C | No non-site files deployed | Screaming Frog "All" tab + try `/README.md`, `/docs/`, `/.env`, `/stdout`, `*.pdf`, `*.html` drafts | Only intended pages/assets; all others 404 |
| 1.11 | C | Correct language | `curl -s $PREV/ \| grep -o '<html[^>]*>'` | `lang="en"` (or the site's language) on all pages |
| 1.12 | N | Content without JS | Chrome DevTools > disable JavaScript, reload home + a service page; Screaming Frog JS rendering screenshot | All sections readable; nothing stuck at opacity 0 |
| 1.13 | N | Duplicate URLs | Screaming Frog "Duplicate" (exact/near) + test `/index.html`, `/home/` | Each duplicate redirects or canonicalizes to one URL |

### 1C. On-page
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.14 | C | Title present on every page | `seo-quick-audit.py` (FAIL: missing title) / SF Page Titles > Missing | 0 missing |
| 1.15 | C | Homepage title is service + location + brand | Manual read | Not generic, not "Home"/"Logo"; includes the primary keyword |
| 1.16 | C | Canonical: one, self-referencing, absolute, production host | `seo-quick-audit.py --expect-host $WWW` (canonical mismatch) / SF Canonicals | Every page canonical = `https://$WWW/<same path>` with the correct slash; never vercel.app |
| 1.17 | N | Title length | Audit output `title_len` / SF Page Titles | 30 to 60 chars (service pages ≤ ~65 OK); key term first |
| 1.18 | N | Titles and descriptions unique | Audit stderr "duplicate title/description" / SF Duplicate | 0 duplicates |
| 1.19 | N | Meta description present, not placeholder | Audit `desc_len`; manual read of home + services | Present on all pages; real copy; no em dashes |
| 1.20 | L | Meta description length | Audit / SF Meta Description | 140 to 160 chars |
| 1.21 | N | One H1 per page | Audit `h1` column / SF H1 | Exactly 1 on every page (0 = N, >1 = L) |
| 1.22 | N | OG + Twitter tags | Audit `og` column; paste URL into the Facebook Sharing Debugger / LinkedIn Post Inspector | og:title/description/image/url + twitter:card; image renders |
| 1.23 | L | Favicon set | Audit "no favicon link"; check the browser tab | Icon shows; apple-touch-icon 180px present |
| 1.24 | L | No stale years | `grep -riE '20(1[0-9]\|2[0-5])' dist/` (Astro) or site search; check the footer | Copyright = current year; no outdated years in titles/H1s |

### 1D. Content, conversion, local
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.25 | C | Single NAP phone | Audit stderr "multiple tel: numbers"; grep the build for phone patterns | One NAP number in footer/schema/contact; tracking number only in click-to-call buttons |
| 1.26 | C | Every form delivers a lead | Submit each form (popup, contact, plan signup, newsletter) with a test lead; confirm in GHL/CRM + inbox; check `form_source` and fields | Every form lands in the right workflow with all fields |
| 1.27 | N | NAP, hours, license match GBP | Compare the site footer/contact + schema with GBP | Character-for-character match |
| 1.28 | N | Service and city pages exist per target keyword | Compare the keyword map with the page list | One dedicated page per target keyword; no two pages targeting the same term |
| 1.29 | N | Hero CTA + header phone + mobile sticky bar | Manual, desktop + 390px | Book button + click-to-call in the hero; tel in the header |
| 1.30 | N | Trust/proof | Manual: testimonials on service pages, proof near pricing, dated case studies, author page | Present per build standards §4 |
| 1.31 | N | Reading level | Hemingway / readable.com on the service pages | Grade ≤ 7 to 8 on service pages |
| 1.32 | N | Thin pages | Audit / SF Word Count | No indexable page under ~300 words without a clear purpose |

### 1E. Links and images
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.33 | N | No broken internal links | `npx linkinator $PREV --recurse` / SF Response Codes > Internal 4xx | 0 broken |
| 1.34 | C | Nav/footer/cards point to the right pages | Click every nav, footer, and homepage card link | Each goes to its own correct page |
| 1.35 | N | No internal links through redirects | SF "Redirection (3xx)" inlinks | Internal links go straight to 200 URLs |
| 1.36 | N | Clean anchor text | `curl -s $PREV/ \| grep -oE '>[a-z_]+ [A-Z][^<]{0,40}<'` for ligature leaks; check icons have aria-hidden | No `trending_up`-style words in link text |
| 1.37 | L | Blog → service links | SF inlinks for service pages | Each service page linked from its related posts |
| 1.38 | C | No hotlinked assets | Audit "hotlinked"; SF Images filtered by external host | 0 images from the old domain or /wp-content/ on another host |
| 1.39 | N | Alt text | Audit `img_no_alt` / SF Images > Missing Alt | 0 content images missing alt; decorative = `alt=""` |
| 1.40 | L | Image dimensions + format + weight | Audit `img_no_dims`; SF Images > Over 100 KB; Lighthouse | Width/height on all; WebP/AVIF; none > ~300 KB except the hero |

### 1F. Performance, mobile, accessibility
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.41 | N | Lighthouse/PSI recorded (mobile) | PSI on home, top 3 service pages, a post, contact; record the scores in the punch list | Perf ≥ 90 (≥ 80 minimum with a note), SEO 100, Accessibility ≥ 90 |
| 1.42 | N | Core Web Vitals | PSI lab now; CrUX/GSC CWV after launch | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 |
| 1.43 | N | TTFB | `curl -s -o /dev/null -w '%{time_starttransfer}\n' $PREV/` (x3) | < 0.6 s |
| 1.44 | L | LCP image eager, rest lazy | View source on the hero `<img>` | Hero has no `loading="lazy"`; has `fetchpriority="high"` |
| 1.45 | L | CSS/fonts | Lighthouse "render-blocking resources"; view source for giant inline `<style>` | One cached stylesheet; subset fonts; no full icon font |
| 1.46 | L | No horizontal scroll | DevTools at 360/390/414 px; console: `document.documentElement.scrollWidth > innerWidth` | `false` on every template |
| 1.47 | L | Tap targets | Lighthouse accessibility "touch targets"; manual | ≥ 44 px (never < 24 px) |
| 1.48 | L | Landmarks + skip link + aria-expanded | Audit "no <main>"; keyboard Tab from the top; toggle the menus | `<main>` present; skip link first; aria-expanded toggles |
| 1.49 | N | Reduced motion | DevTools > Rendering > emulate prefers-reduced-motion | No animations; content visible |

### 1G. Structured data
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.50 | C | Sitewide LocalBusiness (subtype) + WebSite | Audit `jsonld_types`; Rich Results Test on the home page | Present, 0 errors; NAP/hours/geo/areaServed match the visible text and GBP |
| 1.51 | N | BreadcrumbList, Service, FAQPage, Article + Person | Rich Results Test on one of each template | Correct types per template, 0 errors; FAQ schema only where the FAQ is visible |
| 1.52 | N | Schema validator | validator.schema.org on each template | 0 errors (warnings reviewed) |

### 1H. Sitemap and robots (production build, pre-launch)
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.53 | C | Sitemap exists and is clean | `curl -s $PREV/sitemap-index.xml` (Astro) / `/sitemap_index.xml` (WP); SF list mode on the sitemap URLs | Only canonical, indexable, 200 URLs using the production host and slash policy; no 404, redirect, noindex, or thank-you pages |
| 1.54 | C | Production robots.txt ready | Inspect `src/pages/robots.txt.ts` / WP production robots with the flag on (local build with `SITE_INDEXABLE=true`) | `Allow: /`, no blocking of CSS/JS/pages, `Sitemap:` absolute URL |

### 1I. Analytics
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 1.55 | C | GTM + GA4 + pixels wired | GTM Preview + GA4 DebugView on the preview (or a temporary debug build) | page_view, form submit, click-to-call, booking (incl. iframe) events fire |
| 1.56 | N | Tags limited to production host | GTM trigger/hostname filter review | Preview hits excluded from production data |

**Stage 1 exit:** all C rows pass, and every N row is fixed or has an owner and date.

---

## Stage 2: Launch day (production domain)

Do the flips, then verify:
1. Astro/Vercel: set `SITE_INDEXABLE=true` in the **Production** environment only, remove any global noindex header rule, attach the domain(s), redeploy.
   WP: `WP_ENVIRONMENT_TYPE=production`, uncheck "Discourage search engines", production robots.txt, remove/disable the noindex mu-plugin, **purge all caches** (plugin, host, CDN).
2. Run the checks below.

| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 2.1 | C | **Meta robots noindex removed** | `python3 seo-quick-audit.py $PROD` (any "NOINDEX on production" = FAIL); `curl -s $PROD/ \| grep -i 'name="robots"'` | No `noindex` on any sitemap URL |
| 2.2 | C | **robots.txt no longer disallows** | `curl -s $PROD/robots.txt` | No `Disallow: /`; `Sitemap:` line present with the production URL |
| 2.3 | C | **X-Robots-Tag removed on production** | `for u in / /robots.txt /sitemap-index.xml /contact/; do curl -sI "$PROD$u" \| grep -i x-robots-tag; done` | No output (header absent) on the production host |
| 2.4 | N | vercel.app alias still noindexed | `curl -sI https://<project>.vercel.app/ \| grep -i x-robots` | `noindex` present on the alias; its canonicals point at $PROD |
| 2.5 | C | HTTPS + host canonicalization in one hop | `curl -sI http://$APEX/ ; curl -sI http://$WWW/ ; curl -sI https://$APEX/` then `curl -sIL -o /dev/null -w '%{num_redirects} %{url_effective}\n' http://$APEX/some-page/` | Each returns 301/308 to `https://$WWW/...` (the chosen host); ≤ 1 hop; final 200 |
| 2.6 | C | Trailing-slash policy | `curl -sI $PROD/services` vs `$PROD/services/` | The non-canonical form 301/308s to the canonical form; never 404 |
| 2.7 | C | Valid certificate on apex + www | `curl -vI https://$APEX 2>&1 \| grep -i 'expire\|subject'`; SSL Labs | Valid, not expiring soon, covers both hosts |
| 2.8 | N | No mixed content | Audit "possible mixed content"; DevTools console on key pages | 0 mixed-content warnings |
| 2.9 | C | Canonicals on production | `seo-quick-audit.py $PROD` | All canonical_ok = True |
| 2.10 | C | Preview-only scripts absent | `curl -s $PROD/ \| grep -ci feedbucket` | 0 |
| 2.11 | C | Sitemap submitted in GSC | GSC > Sitemaps | Submitted, "Success", discovered count ≈ page count |
| 2.12 | C | GSC URL Inspection on home + 2 service pages | GSC > URL Inspection > Test live URL | "URL is available to Google"; indexing allowed; the Google-selected canonical matches |
| 2.13 | C | Analytics live | GA4 Realtime + a test form submission + test call click | Events visible in production GA4/pixel |
| 2.14 | C | Forms re-tested on production | Submit each form once on the live domain | Leads arrive in the CRM with the correct source |
| 2.15 | N | Schema on production | Rich Results Test on the production home page | Same as 1.50, 0 errors |
| 2.16 | N | Full crawl on production | Screaming Frog on $PROD | 0 4xx/5xx, 0 noindex on indexable pages, 0 canonical mismatches |

---

## Stage 3: Post-launch (days 1 to 14)

| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| 3.1 | C | Indexing progress | GSC Pages report | Indexed count rising; no "Excluded by noindex" for real pages; no "Blocked by robots.txt" |
| 3.2 | N | Crawl errors | GSC Pages "Not found (404)", "Server error (5xx)" | 0 for real URLs |
| 3.3 | N | Money-page queries | GSC Performance, filtered to the home + service pages | Impressions stable or rising; primary keywords still present |
| 3.4 | N | Core Web Vitals (field) | GSC CWV / PSI field data once available | Good for mobile URL groups |
| 3.5 | N | Brand SERP | Google the brand name | Correct title/description; sitelinks show current pages (no legacy "OLD-Home"-type sitelinks) |
| 3.6 | N | GBP link and NAP | GBP website link → $PROD (correct host/slash); NAP matches | Match |
| 3.7 | N | Analytics sanity | GA4: sessions, conversions, no double-counting, no preview-host traffic | Plausible numbers |

---

## Stage M: Migration / redesign (in addition to Stages 1 to 3)

### M1. Before build (inventory)
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| M1.1 | C | Full old-URL inventory | Old XML sitemap(s) + Screaming Frog crawl of the live site + GSC Pages (indexed) export + GSC Performance top pages (16 months) + Semrush/Ahrefs top pages by backlinks | One de-duplicated list of every old URL |
| M1.2 | C | Redirect map built | Sheet columns: Old URL / Source / Destination or Action (Keep, 301, Rebuild) / Status | Every old URL has an action; no destination = homepage by default |
| M1.3 | N | Money-page SEO baseline | Record the old title/H1/meta/word count/schema/top queries for the home + service pages | Baseline saved for comparison |
| M1.4 | N | Tracking and schema baseline | Note the existing GA4/GTM IDs, pixels, and schema types on the old site | Carried over to the new build |
| M1.5 | C | Asset inventory | List of assets served from the old platform (`/wp-content/uploads/*`, PDFs) | Plan to re-host each one |

### M2. Before launch (verify on preview)
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| M2.1 | C | URLs preserved where possible | Diff the old inventory vs. the new sitemap | Unchanged URLs keep the exact path + slash style |
| M2.2 | C | Redirects configured | `vercel.json` `redirects` / WP redirect plugin contains every row of the map | Count matches the map |
| M2.3 | C | Redirects work (on preview) | `while read u; do curl -s -o /dev/null -w "%{http_code} %{redirect_url} $u\n" "$PREV$u"; done < old-paths.txt` or SF list mode | Every old path → 301/308 → expected destination → 200; single hop; no chains/loops |
| M2.4 | C | No hotlinks to the old platform | `grep -r "wp-content/uploads" dist/` (Astro); audit "hotlinked" | 0 |
| M2.5 | N | Money pages keep keywords | Compare with the M1.3 baseline | Primary keyword retained in title/H1 unless GSC shows otherwise |
| M2.6 | N | Trust elements carried over | Compare the old vs. new homepage | Logos, badges, testimonials, review stars present |
| M2.7 | N | Rebrand remnants | `grep -ri "<old brand>" dist/` + slugs | 0 in content; old slugs 301 |
| M2.8 | N | High-value pages rebuilt | Check the map rows marked "Rebuild" | Exist in the new build |
| M2.9 | C | Old sitemap URL redirects | `curl -sI $PREV/sitemap_index.xml` | 301/308 → the new sitemap |
| M2.10 | C | Legacy live-site fixes | Fix broken nav/footer links and the NAP on the old site until cutover | Old site has no broken nav/footer links |

### M3. Cutover and after
| # | Sev | Check | How | Pass |
|---|---|---|---|---|
| M3.1 | C | Redirects work on production | Re-run the M2.3 loop against $PROD, including `http://` and apex variants of old URLs | All pass, ≤ 1 hop (host + path redirect may be 2; avoid 3+) |
| M3.2 | C | Old assets still resolve or redirect | Sample old `/wp-content/uploads/...` URLs that had backlinks or image rankings | 200 (re-hosted) or 301 to the new asset |
| M3.3 | C | GSC | Same property kept (domain property); new sitemap submitted; old sitemap removed or redirected | Sitemaps "Success"; no spike in 404s |
| M3.4 | N | Keep the old WP backup | Archive the DB + uploads; don't delete for ≥ 90 days | Backup exists |
| M3.5 | N | Monitor 404s weekly for 8 weeks | GSC Pages 404 + Vercel/host logs | New 404s added to the redirect map |
| M3.6 | N | Legacy/duplicate SERP entries gone | `site:` search for old paths / GSC | Old URLs replaced by new ones in the index over 2 to 8 weeks |
| M3.7 | N | Traffic comparison | GSC clicks/impressions, 28 days post vs. pre | Within normal fluctuation; investigate drops > 20% on any money page |

---

## Off-site items (not part of the build check; flag to the SEO team)
Toxic backlink audit/disavow, GBP optimization (category, services, areas, photos, posts, Q&A), citations (Google, Bing, Apple Maps, Yelp, Houzz, Angi, BuildZoom, chamber), review generation, local link earning, and AI-search visibility tracking. These come from the Distinct Designs inspection. They are rated Critical (toxic links) to Medium (AI search) but are outside what the web build controls.
