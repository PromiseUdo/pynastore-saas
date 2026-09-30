import { describe, expect, it } from 'vitest';
import { CUT_OFF_MINUTES, jobState, lateAfterMinutes, needsAttention } from './health';

const now = new Date('2026-10-01T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const run = (startedMinutesAgo: number, ok: boolean | null, finished = true) => ({
  startedAt: ago(startedMinutesAgo),
  finishedAt: finished ? ago(startedMinutesAgo - 0.1) : null,
  ok,
});

describe('jobState', () => {
  it('is "never" before the first run, until its window has passed since runs began being recorded', () => {
    expect(jobState(15, null, now)).toBe('never');
    // A daily job deployed 3 hours ago hasn't missed anything yet…
    expect(jobState(1440, null, now, ago(3 * 60))).toBe('never');
    // …but one watched for 27 hours with no run is late.
    expect(jobState(1440, null, now, ago(27 * 60))).toBe('late');
    expect(jobState(15, null, now, ago(60))).toBe('late');
  });

  it('is late after three missed beats for a frequent job, and two hours past a day for a daily one', () => {
    expect(lateAfterMinutes(15)).toBe(45);
    expect(lateAfterMinutes(1440)).toBe(1560);
    expect(jobState(15, run(44, true), now)).toBe('ok');
    expect(jobState(15, run(46, true), now)).toBe('late');
    expect(jobState(1440, run(25 * 60, true), now)).toBe('ok');
    expect(jobState(1440, run(27 * 60, true), now)).toBe('late');
  });

  it('is late even when the last run failed — the scheduler stopping is the bigger news', () => {
    expect(jobState(15, run(60, false), now)).toBe('late');
  });

  it('is running while unfinished and young, failing once past the cut-off', () => {
    expect(jobState(15, run(2, null, false), now)).toBe('running');
    expect(jobState(15, run(CUT_OFF_MINUTES + 1, null, false), now)).toBe('failing');
  });

  it('follows the last run otherwise', () => {
    expect(jobState(15, run(5, true), now)).toBe('ok');
    expect(jobState(15, run(5, false), now)).toBe('failing');
  });

  it('asks for attention when failing or late — "never" alone is just new', () => {
    expect(['ok', 'running', 'failing', 'late', 'never'].filter((s) => needsAttention(s as never))).toEqual(['failing', 'late']);
  });
});
