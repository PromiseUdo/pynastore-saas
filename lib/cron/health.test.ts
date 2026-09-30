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
  it('is "never" before the first run', () => {
    expect(jobState(15, null, now)).toBe('never');
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

  it('asks for attention when failing, late or never run', () => {
    expect(['ok', 'running', 'failing', 'late', 'never'].filter((s) => needsAttention(s as never))).toEqual(['failing', 'late', 'never']);
  });
});
