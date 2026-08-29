import { describe, expect, it } from 'vitest';
import type { AppConfig, UserState } from '../shared/types.js';
import { createUserState, DEFAULT_CONFIG } from './domain.js';
import { rankFlairForUser, shouldRemoveSyncedFlair } from './flair.js';

function config(flairSyncEnabled = false): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    flairSyncEnabled,
    levels: DEFAULT_CONFIG.levels.map((level) => ({ ...level })),
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function user(xp: number, syncedFlairText?: string): UserState {
  return {
    ...createUserState('t2_user', 'alice', '2026-07-15', '2026-07-15T12:00:00.000Z'),
    xp,
    ...(syncedFlairText ? { syncedFlairText } : {}),
  };
}

describe('Reddit flair ownership', () => {
  it('builds the flair from the current XP level', () => {
    expect(rankFlairForUser(config(), user(60))).toEqual({
      text: 'Contributor · Lv.3',
      backgroundColor: '#047857',
      textColor: 'light',
    });
  });

  it('removes flair for enabled synchronization and recorded ownership', () => {
    expect(shouldRemoveSyncedFlair(config(true), user(0))).toBe(true);
    expect(shouldRemoveSyncedFlair(config(false), user(0, 'Newcomer · Lv.1'))).toBe(true);
  });

  it('preserves unrelated flair when synchronization was never used', () => {
    expect(shouldRemoveSyncedFlair(config(false), user(0))).toBe(false);
  });
});
