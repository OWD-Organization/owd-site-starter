// Dynamic robots.txt. Do NOT also ship a static public/robots.txt.
import type { APIRoute } from 'astro';
import { INDEXABLE } from '../lib/indexable';
import { SITE } from '../config/site';

export const GET: APIRoute = () =>
  new Response(
    INDEXABLE
      ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap-index.xml\n`
      : `User-agent: *\nDisallow: /\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
