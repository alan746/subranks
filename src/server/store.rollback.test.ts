import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserState } from '../shared/types.js';
import { applyComment, createUserState, DEFAULT_CONFIG } from './domain.js';

type QueuedOperation = () => void;

const redisMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  const versions = new Map<string, number>();
  const scores = new Map<string, number>();
  const zsets = new Map<string, Map<string, number>>();
  const leaderboardKey = 'subranks:leaderboard';

  const bumpVersion = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);

  return {
    values,
    scores,
    zsets,
    reset() {
      values.clear();
      versions.clear();
      scores.clear();
      zsets.clear();
    },
    seed(key: string, value: string) {
      values.set(key, value);
      bumpVersion(key);
    },
    seedZSet(key: string, member: string, score: number) {
      zsets.set(key, new Map([[member, score]]));
      bumpVersion(key);
    },
    async get(key: string) {
      return values.get(key);
    },
    async watch(...keys: string[]) {
      const watchedVersions = new Map(keys.map((key) => [key, versions.get(key) ?? 0]));
      const operations: QueuedOperation[] = [];
      let active = true;

      return {
        async unwatch() {
          active = false;
          return this;
        },
        async multi() {},
        async set(key: string, value: string) {
          operations.push(() => {
            values.set(key, value);
            bumpVersion(key);
          });
          return this;
        },
        async del(...keys: string[]) {
          operations.push(() => {
            for (const key of keys) {
              values.delete(key);
              zsets.delete(key);
              bumpVersion(key);
            }
          });
          return this;
        },
        async zAdd(key: string, entry: { member: string; score: number }) {
          operations.push(() => {
            if (key === leaderboardKey) scores.set(entry.member, entry.score);
            else {
              const entries = zsets.get(key) ?? new Map<string, number>();
              entries.set(entry.member, entry.score);
              zsets.set(key, entries);
            }
            bumpVersion(key);
          });
          return this;
        },
        async zRem(key: string, members: string[]) {
          operations.push(() => {
            if (key === leaderboardKey) {
              members.forEach((member) => scores.delete(member));
            } else {
              const entries = zsets.get(key);
              members.forEach((member) => entries?.delete(member));
              if (entries?.size === 0) zsets.delete(key);
            }
            bumpVersion(key);
          });
          return this;
        },
        async exec() {
          if (!active) throw new Error('Transaction is no longer active.');
          for (const [key, version] of watchedVersions) {
            if ((versions.get(key) ?? 0) !== version) {
              active = false;
              throw new Error('Watched key changed.');
            }
          }
          operations.forEach((operation) => operation());
          active = false;
          return [];
        },
        async discard() {
          active = false;
          return this;
        },
      };
    },
  };
});

vi.mock('@devvit/web/server', () => ({ redis: redisMock }));

import { rollbackCommentReward } from './store.js';

const USER_KEY = 'subranks:user:t2_user';
const REWARD_KEY = 'subranks:comment-reward:t1_a';
const REWARD_INDEX_KEY = 'subranks:comment-rewards-by-user:t2_user';

function rewardRecord(): string {
  return JSON.stringify({ userId: 't2_user', username: 'alice', awardedXp: 2 });
}

function rewardedUser(): UserState {
  const initial = createUserState('t2_user', 'alice', '2026-07-15', '2026-07-15T12:00:00.000Z');
  return applyComment(
    initial,
    DEFAULT_CONFIG,
    't1_a',
    '2026-07-15',
    '2026-07-15T12:00:00.000Z'
  ).state;
}

describe('comment reward rollback', () => {
  beforeEach(() => redisMock.reset());

  it('removes a stale reward without recreating a deleted profile', async () => {
    redisMock.seed(REWARD_KEY, rewardRecord());
    redisMock.seedZSet(REWARD_INDEX_KEY, 't1_a', 1);

    const result = await rollbackCommentReward('t1_a', '2026-07-15T13:00:00.000Z');

    expect(result).toBeNull();
    expect(redisMock.values.has(USER_KEY)).toBe(false);
    expect(redisMock.values.has(REWARD_KEY)).toBe(false);
    expect(redisMock.zsets.has(REWARD_INDEX_KEY)).toBe(false);
    expect(redisMock.scores.has('t2_user')).toBe(false);
  });

  it('rolls back an enrolled player and removes the reward atomically', async () => {
    redisMock.seed(USER_KEY, JSON.stringify(rewardedUser()));
    redisMock.seed(REWARD_KEY, rewardRecord());
    redisMock.seedZSet(REWARD_INDEX_KEY, 't1_a', 1);

    const result = await rollbackCommentReward('t1_a', '2026-07-15T13:00:00.000Z');

    expect(result?.xp).toBe(0);
    expect(result?.daily.commentIds).toEqual([]);
    expect(redisMock.values.has(REWARD_KEY)).toBe(false);
    expect(redisMock.zsets.has(REWARD_INDEX_KEY)).toBe(false);
    expect(redisMock.scores.get('t2_user')).toBe(0);
  });

  it('treats repeated deletion delivery as a no-op', async () => {
    redisMock.seed(USER_KEY, JSON.stringify(rewardedUser()));
    redisMock.seed(REWARD_KEY, rewardRecord());
    redisMock.seedZSet(REWARD_INDEX_KEY, 't1_a', 1);

    await rollbackCommentReward('t1_a', '2026-07-15T13:00:00.000Z');
    const repeated = await rollbackCommentReward('t1_a', '2026-07-15T13:01:00.000Z');

    expect(repeated).toBeNull();
    expect((JSON.parse(redisMock.values.get(USER_KEY) ?? '{}') as UserState).xp).toBe(0);
    expect(redisMock.scores.get('t2_user')).toBe(0);
  });
});
