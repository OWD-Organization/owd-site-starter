/**
 * JSON-LD graph builders. Everything is generated from SITE, never typed by hand.
 * Rules: LocalBusiness subtype + WebSite sitewide; BreadcrumbList on inner pages;
 * Service on service pages; FAQPage ONLY when the FAQ is visible on that page.
 * Never add reviews, ratings, or aggregateRating unless they are real and visible.
 */
import { SITE } from '../config/site';
import { absolute } from './urls';

const BUSINESS_ID = `${SITE.url}/#business`;
const WEBSITE_ID = `${SITE.url}/#website`;

export function businessNode() {
  const a = SITE.address;
  const address: Record<string, string> = { '@type': 'PostalAddress', addressCountry: a.country };
  if (a.street) address.streetAddress = a.street;
  if (a.city) address.addressLocality = a.city;
  if (a.region) address.addressRegion = a.region;
  if (a.postal) address.postalCode = a.postal;
  const node: Record<string, unknown> = {
    '@type': SITE.schemaType,
    '@id': BUSINESS_ID,
    name: SITE.name,
    url: absolute('/'),
    telephone: SITE.phone.e164,
    email: SITE.email || undefined,
    description: SITE.description,
    logo: new URL(SITE.logo, SITE.url).href,
    image: new URL(SITE.defaultOgImage, SITE.url).href,
    address,
    areaServed: SITE.areaServed.map((t) => ({ '@type': 'City', name: t.name })),
    openingHoursSpecification: SITE.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
    sameAs: [...SITE.sameAs, ...(SITE.gbpUrl ? [SITE.gbpUrl] : [])],
  };
  if (SITE.geo) node.geo = { '@type': 'GeoCoordinates', latitude: SITE.geo.lat, longitude: SITE.geo.lng };
  return JSON.parse(JSON.stringify(node)); // drops undefined
}

export function websiteNode() {
  return { '@type': 'WebSite', '@id': WEBSITE_ID, url: absolute('/'), name: SITE.name, inLanguage: SITE.lang, publisher: { '@id': BUSINESS_ID } };
}

export function breadcrumbNode(crumbs: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absolute(c.path) })),
  };
}

export function serviceNode(name: string, path: string, description: string) {
  return {
    '@type': 'Service',
    '@id': `${absolute(path)}#service`,
    name,
    serviceType: name,
    description,
    url: absolute(path),
    provider: { '@id': BUSINESS_ID },
    areaServed: SITE.areaServed.map((t) => ({ '@type': 'City', name: t.name })),
  };
}

/** Only call this for FAQs that are rendered visibly on the same page (use <Faq />). */
export function faqNode(faqs: { q: string; a: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

export function graph(nodes: unknown[]) {
  return { '@context': 'https://schema.org', '@graph': [businessNode(), websiteNode(), ...nodes] };
}
