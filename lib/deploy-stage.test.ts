import { afterEach, describe, expect, it } from 'vitest';
import { deployStage, isStaging } from './deploy-stage';

const saved = { VERCEL_ENV: process.env.VERCEL_ENV, DEPLOY_STAGE: process.env.DEPLOY_STAGE };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('deployStage', () => {
  it('follows Vercel: Production is live, Preview is staging, anything else is development', () => {
    delete process.env.DEPLOY_STAGE;
    process.env.VERCEL_ENV = 'production';
    expect(deployStage()).toBe('production');
    process.env.VERCEL_ENV = 'preview';
    expect(deployStage()).toBe('staging');
    expect(isStaging()).toBe(true);
    delete process.env.VERCEL_ENV;
    expect(deployStage()).toBe('development');
  });

  it('can be overridden with DEPLOY_STAGE', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DEPLOY_STAGE = 'production';
    expect(deployStage()).toBe('production');
  });
});
