/**
 * SINGLE SOURCE OF TRUTH for client facts.
 *
 * Every title, schema block, header, footer, and contact block reads from this file.
 * Never hand-type the business name, phone, hours, or areas into a page.
 *
 * EVERY VALUE BELOW IS AN EXAMPLE PLACEHOLDER. Replace each one with facts the client
 * has confirmed (match the Google Business Profile exactly). Do not invent facts:
 * if you do not know a value, leave it empty/null and ask.
 *
 * The SEO gate treats these example values as placeholders. They are allowed on a
 * preview, and they BLOCK the launch build (SITE_INDEXABLE=true) until replaced.
 */
export const SITE = {
  // Production origin: final host (www OR apex, pick one), https, no trailing slash.
  url: 'https://www.example-plumbing.com', // EXAMPLE
  name: 'Example Plumbing Co.', // EXAMPLE
  legalName: 'Example Plumbing Co. LLC', // EXAMPLE
  tagline: 'Fast, honest plumbing repair', // EXAMPLE
  description:
    'Example Plumbing Co. is a sample local plumbing company used to demonstrate the OWD starter template.', // EXAMPLE
  lang: 'en',
  locale: 'en_US',

  // Canonical NAP phone. Used in the header, footer, schema, and all tel: links.
  phone: { display: '(555) 555-0100', e164: '+15555550100' }, // EXAMPLE
  // Optional call-tracking number. Allowed ONLY on click-to-call buttons (never footer/schema).
  trackingPhone: null as null | { display: string; e164: string },
  email: 'hello@example-plumbing.com', // EXAMPLE

  // Leave street '' for a service-area business with no public address.
  address: { street: '', city: 'Exampleville', region: 'ST', postal: '00000', country: 'US' }, // EXAMPLE
  geo: null as null | { lat: number; lng: number },

  // Opening hours for schema (openingHoursSpecification) and the visible hours line.
  hours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '08:00', closes: '17:00' },
  ], // EXAMPLE
  hoursText: 'Mon to Fri, 8 am to 5 pm', // EXAMPLE
  license: null as null | string, // e.g. 'ROC #000000' (only if the client confirms it)

  // Primary keyword pieces used in the homepage title.
  primaryService: 'Plumber', // EXAMPLE
  primaryArea: 'Exampleville, ST', // EXAMPLE

  // Service area towns. Each gets a page at /service-area/<slug>/.
  areaServed: [{ name: 'Sample Town', slug: 'sample-town' }], // EXAMPLE

  gbpUrl: '' as string, // Google Business Profile link, only if confirmed
  sameAs: ['https://www.facebook.com/example'] as string[], // EXAMPLE

  // LocalBusiness subtype: Plumber, HVACBusiness, RoofingContractor, Electrician, GeneralContractor...
  schemaType: 'Plumber',
  logo: '/icon-512.png',
  defaultOgImage: '/og/default.jpg',

  // Google Tag Manager container. Set PUBLIC_GTM_ID in Vercel Production (never commit a real ID
  // for a different client). GTM renders only when the site is indexable (launch).
  gtmId: (process.env.PUBLIC_GTM_ID ?? '') as string,

  // URL policy. Keep 'always' unless migrating a site that had no trailing slashes.
  trailingSlash: 'always' as 'always' | 'never',

  // Pages that stay noindexed even after launch (thank-you pages etc.). 404 is always excluded.
  noindexPaths: [] as string[],

  // Extra hosts allowed to serve images (normally none: every asset lives in this repo).
  allowedImageHosts: [] as string[],
} as const;

export type Site = typeof SITE;
