/**
 * ONE explicit indexing flag. Do not infer indexability from VERCEL_ENV: the pre-launch
 * project's own production deployment is VERCEL_ENV=production too.
 * Launch = set SITE_INDEXABLE=true in the Vercel PRODUCTION environment only, then redeploy.
 */
export const INDEXABLE = process.env.SITE_INDEXABLE === 'true';
