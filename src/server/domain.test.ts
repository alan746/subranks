import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../shared/types.js';
import {
  DEFAULT_CONFIG,
  applyCheckIn,
  applyComment,
  checkInXpForStreak,
  createUserState,
  dateKey,
  levelForXp,
  nextLevelForXp,
  progressForXp,
  removeCommentReward,
  validateConfig,
} from './domain.js';

function config(): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    levels: DEFAULT_CONFIG.levels.map((level) => ({ ...level })),
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

describe('daily date handling', () => {
  it('uses the configured community timezone', () => {
    const instant = new Date('2026-07-15T02:00:00.000Z');
    expect(dateKey(instant, 'UTC')).toBe('2026-07-15');
    expect(dateKey(instant, 'America/Toronto')).toBe('2026-07-14');
  });

  it('falls back to UTC for an invalid timezone', () => {
    expect(dateKey(new Date('2026-07-15T02:00:00.000Z'), 'not/a-zone')).toBe('2026-07-15');
  });
});

describe('check-ins', () => {
  it('awards reduced XP on day one and only once', () => {
    const initial = createUserState('t2_user', 'alice', '2026-07-15', '2026-07-15T12:00:00.000Z');
    const first = applyCheckIn(initial, config(), '2026-07-15', '2026-07-15T12:00:00.000Z');
    expect(first.changed).toBe(true);
    expect(first.awardedXp).toBe(3);
    expect(first.state.xp).toBe(3);
    expect(first.state.streak).toBe(1);

    const duplicate = applyCheckIn(first.state, config(), '2026-07-15', '2026-07-15T13:00:00.000Z');
    expect(duplicate.changed).toBe(false);
    expect(duplicate.state.xp).toBe(3);
  });

  it('ramps from 3 to 4 to 5 XP, stays at 5, and resets after a gap', () => {
    const initial = createUserState('t2_user', 'alice', '2026-07-14', '2026-07-14T12:00:00.000Z');
    const dayOne = applyCheckIn(initial, config(), '2026-07-14', '2026-07-14T12:00:00.000Z');
    const dayTwo = applyCheckIn(dayOne.state, config(), '2026-07-15', '2026-07-15T12:00:00.000Z');
    const dayThree = applyCheckIn(dayTwo.state, config(), '2026-07-16', '2026-07-16T12:00:00.000Z');
    const dayFour = applyCheckIn(dayThree.state, config(), '2026-07-17', '2026-07-17T12:00:00.000Z');
    expect(dayOne.awardedXp).toBe(3);
    expect(dayTwo.awardedXp).toBe(4);
    expect(dayThree.awardedXp).toBe(5);
    expect(dayFour.awardedXp).toBe(5);
    expect(dayTwo.state.streak).toBe(2);
    expect(dayFour.state.xp).toBe(17);
    const afterGap = applyCheckIn(dayFour.state, config(), '2026-07-19', '2026-07-19T12:00:00.000Z');
    expect(afterGap.state.streak).toBe(1);
    expect(afterGap.awardedXp).toBe(3);
    expect(afterGap.state.longestStreak).toBe(4);
  });

  it('never awards negative XP when the standard value is low', () => {
    expect(checkInXpForStreak(1, 1)).toBe(0);
    expect(checkInXpForStreak(1, 2)).toBe(0);
    expect(checkInXpForStreak(1, 3)).toBe(1);
  });
});

describe('comment rewards', () => {
  it('rewards the first three unique comments only', () => {
    const settings = config();
    let state = createUserState('t2_user', 'alice', '2026-07-15', '2026-07-15T12:00:00.000Z');
    for (const id of ['t1_a', 't1_b', 't1_c']) {
      const result = applyComment(state, settings, id, '2026-07-15', '2026-07-15T12:00:00.000Z');
      expect(result.awardedXp).toBe(2);
      state = result.state;
    }
    const fourth = applyComment(state, settings, 't1_d', '2026-07-15', '2026-07-15T12:00:00.000Z');
    expect(fourth.changed).toBe(false);
    expect(fourth.state.xp).toBe(6);

    const duplicate = applyComment(state, settings, 't1_a', '2026-07-15', '2026-07-15T12:00:00.000Z');
    expect(duplicate.changed).toBe(false);
  });

  it('rolls back XP when a rewarded comment is deleted', () => {
    const initial = createUserState('t2_user', 'alice', '2026-07-15', '2026-07-15T12:00:00.000Z');
    const rewarded = applyComment(initial, config(), 't1_a', '2026-07-15', '2026-07-15T12:00:00.000Z');
    const removed = removeCommentReward(rewarded.state, 't1_a', 2, '2026-07-15T13:00:00.000Z');
    expect(removed.state.xp).toBe(0);
    expect(removed.state.daily.commentIds).toEqual([]);
  });
});

describe('rank calculations', () => {
  it('finds current, next and progress', () => {
    const levels = config().levels;
    expect(levelForXp(levels, 60).level).toBe(3);
    expect(nextLevelForXp(levels, 60)?.level).toBe(4);
    expect(progressForXp(levels, 100)).toBe(50);
    expect(nextLevelForXp(levels, 5000)).toBeNull();
    expect(progressForXp(levels, 5000)).toBe(100);
  });
});

describe('moderator configuration validation', () => {
  it('accepts the default configuration', () => {
    const { updatedAt: _updatedAt, ...candidate } = config();
    expect(validateConfig(candidate)).toEqual([]);
  });

  it('accepts variable rank counts from 2 to 18', () => {
    const candidate = config();
    candidate.levels = candidate.levels.slice(0, 8);
    expect(validateConfig(candidate)).toEqual([]);

    candidate.levels = candidate.levels.slice(0, 1);
    expect(validateConfig(candidate)).toContain('Rank system must contain between 2 and 18 levels.');

    const base = config().levels;
    candidate.levels = Array.from({ length: 18 }, (_, index) => ({
      ...(base[index % base.length]),
      level: index + 1,
      title: `Rank ${index + 1}`,
      requiredXp: index * 20,
    }));
    expect(validateConfig(candidate)).toEqual([]);
  });

  it('rejects non-increasing thresholds and invalid timezone', () => {
    const { updatedAt: _updatedAt, ...candidate } = config();
    candidate.timezone = 'Mars/Olympus';
    candidate.levels[2].requiredXp = candidate.levels[1].requiredXp;
    const errors = validateConfig(candidate).join(' ');
    expect(errors).toContain('Timezone');
    expect(errors).toContain('higher than the previous level');
  });
});
