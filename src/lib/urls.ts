import { SITE } from '../config/site';

/** Normalize a path to the site's trailing-slash policy. */
export function withPolicy(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  const [p, rest = ''] = path.split(/(?=[?#])/);
  let out = p;
  if (SITE.trailingSlash === 'always') {
    if (!out.endsWith('/') && !/\.[a-z0-9]+$/i.test(out)) out += '/';
  } else if (out !== '/' && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out + rest;
}

/** Absolute URL on the PRODUCTION host (canonicals always point here, even on previews). */
export function absolute(path: string): string {
  return new URL(withPolicy(path), SITE.url).href;
}

export function isNoindexPath(pathname: string): boolean {
  const p = withPolicy(pathname);
  return p === withPolicy('/404') || SITE.noindexPaths.map(withPolicy).includes(p);
}
