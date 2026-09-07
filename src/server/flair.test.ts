import { describe, expect, it } from 'vitest';
import type { AppConfig, UserState } from '../shared/types.js';
import { createUserState, DEFAULT_CONFIG } from './domain.js';
import {
  includeFlairWarning,
  persistSyncedFlairOrCompensate,
  rankFlairForUser,
  shouldRemoveSyncedFlair,
} from './flair.js';

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
  it('includes synchronization warnings only when present', () => {
    const state = { enrolled: true };

    expect(includeFlairWarning(state, 'Flair could not be updated.')).toEqual({
      enrolled: true,
      flairWarning: 'Flair could not be updated.',
    });
    expect(includeFlairWarning(state)).toEqual({ enrolled: true });
  });

  it('builds the flair from the current XP level', () => {
    expect(rankFlairForUser(config(), user(60))).toEqual({
      text: 'Contributor · Lv.3',
      backgroundColor: '#047857',
      textColor: 'light',
    });
  });

  it('removes flair only while it matches recorded ownership', () => {
    const stored = user(0, 'Newcomer · Lv.1');
    expect(shouldRemoveSyncedFlair(config(false), stored, 'Newcomer · Lv.1')).toBe(true);
    expect(shouldRemoveSyncedFlair(config(false), stored, 'Community Helper')).toBe(false);
  });

  it('recognizes matching legacy flair while synchronization is enabled', () => {
    expect(shouldRemoveSyncedFlair(config(true), user(60), 'Contributor · Lv.3')).toBe(true);
    expect(shouldRemoveSyncedFlair(config(true), user(60), 'Community Helper')).toBe(false);
  });

  it('preserves flair when synchronization was never used', () => {
    expect(shouldRemoveSyncedFlair(config(false), user(0), 'Community Helper')).toBe(false);
  });

  it('keeps synchronized flair when ownership is recorded', async () => {
    const effects: string[] = [];

    const recorded = await persistSyncedFlairOrCompensate(
      async () => {
        effects.push('record');
        return true;
      },
      async () => {
        effects.push('remove');
      }
    );

    expect(recorded).toBe(true);
    expect(effects).toEqual(['record']);
  });

  it('removes synchronized flair when profile ownership cannot be recorded', async () => {
    const effects: string[] = [];

    const recorded = await persistSyncedFlairOrCompensate(
      async () => {
        effects.push('record');
        return false;
      },
      async () => {
        effects.push('remove');
      }
    );

    expect(recorded).toBe(false);
    expect(effects).toEqual(['record', 'remove']);
  });

  it('removes synchronized flair when ownership persistence fails', async () => {
    const effects: string[] = [];

    await expect(persistSyncedFlairOrCompensate(
      async () => {
        effects.push('record');
        throw new Error('Storage unavailable');
      },
      async () => {
        effects.push('remove');
      }
    )).rejects.toThrow('Storage unavailable');

    expect(effects).toEqual(['record', 'remove']);
  });
});
