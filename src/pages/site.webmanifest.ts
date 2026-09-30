import type { APIRoute } from 'astro';
import { SITE } from '../config/site';
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: SITE.name,
      short_name: SITE.name,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#12324a',
      background_color: '#ffffff',
      display: 'standalone',
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
