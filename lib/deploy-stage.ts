/*
 * lib/deploy-stage.ts — which copy of the site this is.
 *
 *   production   the live site (Vercel's Production environment, `master`)
 *   staging      the private test copy (Vercel's Preview environment: `dev`
 *                and any feature branch) — docs/STAGING.md
 *   development  someone's own machine, and tests
 *
 * Vercel sets VERCEL_ENV itself, so nothing needs configuring. DEPLOY_STAGE
 * can override it (e.g. to try staging behaviour locally).
 *
 * What staging changes, so it can never be mistaken for — or act as — the
 * live site: Paystack refuses live keys, every email's subject starts
 * "[Staging]", search engines are told to stay out, and every page shows a
 * small "Staging" badge.
 */
export type DeployStage = 'production' | 'staging' | 'development';

export function deployStage(): DeployStage {
  const override = process.env.DEPLOY_STAGE?.trim();
  if (override === 'production' || override === 'staging' || override === 'development') return override;
  if (process.env.VERCEL_ENV === 'production') return 'production';
  if (process.env.VERCEL_ENV === 'preview') return 'staging';
  return 'development';
}

export function isStaging(): boolean {
  return deployStage() === 'staging';
}
