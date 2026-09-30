/**
 * Services. One page per core service at /services/<slug>/.
 * EXAMPLE CONTENT: replace with the client's real services and copy.
 * FAQs listed here are rendered visibly on the page AND marked up as FAQPage.
 */
export interface Service {
  slug: string;
  name: string;
  title: string; // <title>, 30 to 60 chars, key term first
  description: string; // meta description, 140 to 160 chars
  summary: string;
  body: string[];
  faqs: { q: string; a: string }[];
}

export const SERVICES: Service[] = [
  {
    slug: 'example-service',
    name: 'Drain Cleaning',
    title: 'Drain Cleaning in Exampleville, ST | Example Plumbing',
    description:
      'Slow or clogged drain? Example Plumbing Co. clears kitchen, bath, and main sewer lines with up-front pricing. Call today to book a same-day drain cleaning.',
    summary: 'Clogged sinks, tubs, and main lines cleared fast, with up-front pricing.',
    body: [
      'This is an example service page. Replace this copy with the client’s real service description, written at about a grade 6 to 7 reading level.',
      'Explain what the service covers, who it is for, what a visit looks like, and why customers pick this company. Link to related work and the contact page.',
    ],
    faqs: [
      {
        q: 'How fast can you clear a clogged drain?',
        a: 'Most drain calls are handled the same day. Replace this answer with the client’s real policy.',
      },
      {
        q: 'Do you give prices before you start?',
        a: 'Yes. You get the price before any work starts. Replace this answer with the client’s real policy.',
      },
    ],
  },
];
