import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, UserState } from '../shared/types.js';
import { createUserState, DEFAULT_CONFIG } from './domain.js';

type SortedMember = { member: string; score: number };

const redisMock = vi.hoisted(() => {
  let members: SortedMember[] = [];
  const values = new Map<string, string>();
  const rangeCalls: Array<{ start: number; stop: number }> = [];

  return {
    rangeCalls,
    reset() {
      members = [];
      values.clear();
      rangeCalls.length = 0;
    },
    seedMembers(next: SortedMember[]) {
      members = [...next];
    },
    seedUser(userId: string, username: string, xp: number) {
      const state: UserState = {
        ...createUserState(userId, username, '2026-07-15', '2026-07-15T12:00:00.000Z'),
        xp,
      };
      values.set(`subranks:user:${userId}`, JSON.stringify(state));
    },
    async zRange(_key: string, start: number, stop: number) {
      rangeCalls.push({ start, stop });
      return members.slice(start, stop + 1);
    },
    async mGet(keys: string[]) {
      return keys.map((key) => values.get(key));
    },
  };
});

vi.mock('@devvit/web/server', () => ({ redis: redisMock }));

import { getLeaderboard } from './store.js';

function config(): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    levels: DEFAULT_CONFIG.levels.map((level) => ({ ...level })),
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

describe('leaderboard reads', () => {
  beforeEach(() => redisMock.reset());

  it('continues through stale members and returns contiguous ranks', async () => {
    redisMock.seedMembers([
      { member: 'ghost-top', score: 500 },
      { member: 'alice', score: 300 },
      { member: 'ghost-2', score: 290 },
      { member: 'ghost-3', score: 280 },
      { member: 'ghost-4', score: 270 },
      { member: 'ghost-5', score: 260 },
      { member: 'ghost-6', score: 250 },
      { member: 'ghost-7', score: 240 },
      { member: 'ghost-8', score: 230 },
      { member: 'bob', score: 140 },
      { member: 'ghost-9', score: 130 },
      { member: 'carol', score: 60 },
    ]);
    redisMock.seedUser('alice', 'alice', 300);
    redisMock.seedUser('bob', 'bob', 140);
    redisMock.seedUser('carol', 'carol', 60);

    const entries = await getLeaderboard(config(), 3);

    expect(entries).toEqual([
      { rank: 1, username: 'alice', xp: 300, level: 5, title: 'Specialist' },
      { rank: 2, username: 'bob', xp: 140, level: 4, title: 'Pathfinder' },
      { rank: 3, username: 'carol', xp: 60, level: 3, title: 'Contributor' },
    ]);
    expect(redisMock.rangeCalls).toEqual([
      { start: 0, stop: 9 },
      { start: 10, stop: 19 },
    ]);
  });

  it('returns all available valid players when fewer than requested exist', async () => {
    redisMock.seedMembers([
      { member: 'ghost', score: 500 },
      { member: 'alice', score: 20 },
    ]);
    redisMock.seedUser('alice', 'alice', 20);

    const entries = await getLeaderboard(config(), 10);

    expect(entries).toEqual([
      { rank: 1, username: 'alice', xp: 20, level: 2, title: 'Regular' },
    ]);
  });

  it('returns an empty list for a non-positive limit without reading Redis', async () => {
    expect(await getLeaderboard(config(), 0)).toEqual([]);
    expect(await getLeaderboard(config(), -1)).toEqual([]);
    expect(redisMock.rangeCalls).toEqual([]);
  });
});
