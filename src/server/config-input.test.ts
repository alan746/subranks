import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './domain.js';
import { parseConfigInput } from './config-input.js';

describe('configuration request parsing', () => {
  it.each([undefined, null, [], 3, 'settings'])('rejects a non-object body: %s', (input) => {
    expect(parseConfigInput(input).error).toBe('Configuration must be an object.');
  });

  it.each([null, [], 'rank', 1])('rejects malformed rank rows: %s', (row) => {
    expect(parseConfigInput({ ...DEFAULT_CONFIG, levels: [row] }).error).toContain('Rank row 1');
  });

  it.each([
    { flairSyncEnabled: 'false' },
    { flairSyncEnabled: 0 },
    { checkInXp: null },
    { commentXp: '2' },
    { dailyCommentLimit: true },
    { communityName: {} },
    { timezone: [] },
    { levels: null },
  ])('rejects incorrect field types: %j', (patch) => {
    const result = parseConfigInput({ ...DEFAULT_CONFIG, ...patch });
    expect(result.error).toBeTruthy();
    expect(result.config).toBeUndefined();
  });

  it('normalizes valid requests without enabling disabled synchronization', () => {
    const input = {
      ...DEFAULT_CONFIG,
      communityName: ' Community ', timezone: ' UTC ',
      levels: DEFAULT_CONFIG.levels.map((row) => ({ ...row, level: 99, title: ` ${row.title} ` })),
    };
    const result = parseConfigInput(input);
    expect(result.error).toBeUndefined();
    expect(result.config).toMatchObject({ communityName: 'Community', timezone: 'UTC', flairSyncEnabled: false });
    expect(result.config?.levels).toEqual(DEFAULT_CONFIG.levels);
    expect(input.levels[0].level).toBe(99);
  });

  it('applies existing reward, timezone and rank constraints', () => {
    const result = parseConfigInput({ ...DEFAULT_CONFIG, checkInXp: -1, timezone: 'Invalid/Zone', levels: [] });
    expect(result.error).toContain('Check-in XP');
    expect(result.error).toContain('Timezone');
    expect(result.error).toContain('between 2 and 18');
    expect(result.config).toBeUndefined();
  });

  it('rejects invalid rank field types without coercion', () => {
    const result = parseConfigInput({ ...DEFAULT_CONFIG, levels: [{ ...DEFAULT_CONFIG.levels[0], requiredXp: null }] });
    expect(result.error).toContain('Rank row 1');
  });
});
