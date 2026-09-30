// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SITE } from './src/config/site.ts';

const INDEXABLE = process.env.SITE_INDEXABLE === 'true';
const slash = (p) => {
  if (SITE.trailingSlash === 'always') return p.endsWith('/') ? p : p + '/';
  return p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p;
};
const excluded = new Set(['/404', '/404/', ...SITE.noindexPaths.map(slash)]);

/** Writes .owd/seo-manifest.json (outside dist/, never deployed) for scripts/seo-gate.mjs. */
function owdSeoManifest() {
  return {
    name: 'owd-seo-manifest',
    hooks: {
      'astro:build:done': () => {
        mkdirSync('.owd', { recursive: true });
        writeFileSync(
          '.owd/seo-manifest.json',
          JSON.stringify({ generatedAt: new Date().toISOString(), indexable: INDEXABLE, site: SITE }, null, 2),
        );
      },
    },
  };
}

export default defineConfig({
  site: SITE.url,
  output: 'static',
  trailingSlash: SITE.trailingSlash,
  build: { format: SITE.trailingSlash === 'always' ? 'directory' : 'file', inlineStylesheets: 'auto' },
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        return !excluded.has(path) && !excluded.has(slash(path));
      },
    }),
    owdSeoManifest(),
  ],
});
