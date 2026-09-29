import { describe, expect, it } from 'vitest';
import { healthCountsMessage, healthMessage, rowHealth } from './health';
import { task } from './testing';

describe('rowHealth', () => {
  it('flags the own status', () => {
    expect(rowHealth(task('a', { health: 'atRisk' }))).toBe('atRisk');
    expect(rowHealth(task('a', { health: 'needsAttention' }))).toBe('needsAttention');
  });

  it('flags the descendants\' status the same way', () => {
    expect(rowHealth(task('a', { healthBelow: { atRisk: 1, needsAttention: 0 } }))).toBe('atRisk');
    expect(rowHealth(task('a', { healthBelow: { atRisk: 0, needsAttention: 2 } }))).toBe('needsAttention');
  });

  it('takes the worse of the two: at risk beats needs attention', () => {
    expect(rowHealth(task('a', { health: 'needsAttention', healthBelow: { atRisk: 1, needsAttention: 0 } }))).toBe('atRisk');
    expect(rowHealth(task('a', { health: 'atRisk', healthBelow: { atRisk: 0, needsAttention: 3 } }))).toBe('atRisk');
  });

  it('never flags on track, nothing, or a closed row', () => {
    expect(rowHealth(task('a', { health: 'onTrack' }))).toBeUndefined();
    expect(rowHealth(task('a'))).toBeUndefined();
    expect(rowHealth(task('a', { health: 'atRisk', closed: true }))).toBeUndefined();
    expect(rowHealth(task('a', { closed: true, healthBelow: { atRisk: 1, needsAttention: 0 } }))).toBeUndefined();
  });
});

describe('health messages', () => {
  it('counts, with "needs" in the singular', () => {
    expect(healthCountsMessage({ atRisk: 2, needsAttention: 1 })).toBe('2 at risk · 1 needs attention');
    expect(healthCountsMessage({ atRisk: 0, needsAttention: 3 })).toBe('3 need attention');
    expect(healthCountsMessage({ atRisk: 1, needsAttention: 0 })).toBe('1 at risk');
  });

  it('says whether the status is direct, from below, or both', () => {
    expect(healthMessage(task('a', { health: 'atRisk' }))).toBe('At risk');
    expect(healthMessage(task('a', { healthBelow: { atRisk: 1, needsAttention: 1 } }))).toBe('1 at risk · 1 needs attention below');
    expect(healthMessage(task('a', { health: 'atRisk', healthBelow: { atRisk: 0, needsAttention: 2 } }))).toBe(
      'At risk · 2 need attention below',
    );
    // On track isn't a flag: only what is below shows.
    expect(healthMessage(task('a', { health: 'onTrack', healthBelow: { atRisk: 1, needsAttention: 0 } }))).toBe('1 at risk below');
  });
});
