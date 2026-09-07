import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, UserState } from '../shared/types.js';
import { applyCheckIn, applyComment, createUserState, DEFAULT_CONFIG } from './domain.js';

type QueuedOperation = () => void;

const redisMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  const versions = new Map<string, number>();
  const scores = new Map<string, number>();
  const zsets = new Map<string, Map<string, number>>();
  const leaderboardKey = 'subranks:leaderboard';

  const bumpVersion = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);
  const zset = (key: string) => {
    const existing = zsets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    zsets.set(key, created);
    return created;
  };

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
    async get(key: string) {
      return values.get(key);
    },
    async zRange(key: string, start: number, stop: number) {
      const entries = [...(zsets.get(key) ?? [])]
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => a.score - b.score);
      return entries.slice(start, stop < 0 ? entries.length : stop + 1);
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
            else zset(key).set(entry.member, entry.score);
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
        async zRemRangeByScore(key: string, min: number, max: number) {
          operations.push(() => {
            const entries = zsets.get(key);
            for (const [member, score] of entries ?? []) {
              if (score >= min && score <= max) entries?.delete(member);
            }
            if (entries?.size === 0) zsets.delete(key);
            bumpVersion(key);
          });
          return this;
        },
        async expire() {
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

import {
  createOrMutateUserState,
  mutateExistingUserState,
  mutateUserStateForComment,
  deleteUserData,
  recordSyncedFlairText,
} from './store.js';

const USER_KEY = 'subranks:user:t2_user';
const REWARD_KEY = 'subranks:comment-reward:t1_a';
const REWARD_INDEX_KEY = 'subranks:comment-rewards-by-user:t2_user';

function config(): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    levels: DEFAULT_CONFIG.levels.map((level) => ({ ...level })),
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function seedUser(): void {
  const state = createUserState('t2_user', 'alice', '2026-07-15', '2026-07-15T12:00:00.000Z');
  redisMock.seed(USER_KEY, JSON.stringify(state));
}

function storedUser(): UserState {
  return JSON.parse(redisMock.values.get(USER_KEY) ?? '{}') as UserState;
}

describe('user state mutations and persistent comment reward deduplication', () => {
  beforeEach(() => {
    redisMock.reset();
    seedUser();
  });

  it('does not reward a delayed duplicate after the daily activity resets', async () => {
    const first = await mutateUserStateForComment('t2_user', 'alice', 't1_a', (state) =>
      applyComment(state, config(), 't1_a', '2026-07-15', '2026-07-15T12:00:00.000Z')
    );
    const delayed = await mutateUserStateForComment('t2_user', 'alice', 't1_a', (state) =>
      applyComment(state, config(), 't1_a', '2026-07-16', '2026-07-16T12:00:00.000Z')
    );

    expect(first?.awardedXp).toBe(2);
    expect(delayed).toMatchObject({ awardedXp: 0, changed: false, duplicate: true });
    expect(storedUser().xp).toBe(2);
    expect(redisMock.scores.get('t2_user')).toBe(2);
    expect(redisMock.values.has(REWARD_KEY)).toBe(true);
    expect(redisMock.zsets.get(REWARD_INDEX_KEY)?.has('t1_a')).toBe(true);
  });

  it('awards XP once when the same comment is delivered concurrently', async () => {
    const reward = () =>
      mutateUserStateForComment('t2_user', 'alice', 't1_a', (state) =>
        applyComment(state, config(), 't1_a', '2026-07-15', '2026-07-15T12:00:00.000Z')
      );

    const results = await Promise.all([reward(), reward()]);

    expect(results.reduce((total, result) => total + (result?.awardedXp ?? 0), 0)).toBe(2);
    expect(results.filter((result) => result?.duplicate)).toHaveLength(1);
    expect(storedUser().xp).toBe(2);
    expect(redisMock.scores.get('t2_user')).toBe(2);
  });

  it('does not recreate a missing profile through a comment reward', async () => {
    redisMock.reset();

    const result = await mutateUserStateForComment('t2_user', 'alice', 't1_a', (state) =>
      applyComment(state, config(), 't1_a', '2026-07-15', '2026-07-15T12:00:00.000Z')
    );

    expect(result).toBeNull();
    expect(redisMock.values.has(USER_KEY)).toBe(false);
    expect(redisMock.scores.has('t2_user')).toBe(false);
  });

  it('does not recreate a missing profile through an existing-user mutation', async () => {
    redisMock.reset();

    const result = await mutateExistingUserState('t2_user', 'alice', (state) =>
      applyCheckIn(state, config(), '2026-07-15', '2026-07-15T12:00:00.000Z')
    );

    expect(result).toBeNull();
    expect(redisMock.values.has(USER_KEY)).toBe(false);
    expect(redisMock.scores.has('t2_user')).toBe(false);
  });

  it('persists an existing-user mutation normally', async () => {
    const result = await mutateExistingUserState('t2_user', 'alice', (state) =>
      applyCheckIn(state, config(), '2026-07-15', '2026-07-15T12:00:00.000Z')
    );

    expect(result?.awardedXp).toBe(3);
    expect(storedUser().xp).toBe(3);
    expect(redisMock.scores.get('t2_user')).toBe(3);
  });

  it('allows the enrollment mutation to create a missing profile', async () => {
    redisMock.reset();

    const result = await createOrMutateUserState('t2_user', 'alice', 'UTC', (state) => ({
      state,
      awardedXp: 0,
      changed: true,
    }));

    expect(result.state.userId).toBe('t2_user');
    expect(storedUser().username).toBe('alice');
    expect(redisMock.scores.get('t2_user')).toBe(0);
  });

  it('records synchronized flair only on an existing profile', async () => {
    expect(await recordSyncedFlairText('t2_user', 'Newcomer · Lv.1')).toBe(true);
    expect(storedUser().syncedFlairText).toBe('Newcomer · Lv.1');

    redisMock.reset();
    expect(await recordSyncedFlairText('t2_user', 'Newcomer · Lv.1')).toBe(false);
    expect(redisMock.values.has(USER_KEY)).toBe(false);
  });

  it('deletes the profile, leaderboard entry, and indexed rewards together', async () => {
    await mutateUserStateForComment('t2_user', 'alice', 't1_a', (state) =>
      applyComment(state, config(), 't1_a', '2026-07-15', '2026-07-15T12:00:00.000Z')
    );

    await deleteUserData('t2_user');

    expect(redisMock.values.has(USER_KEY)).toBe(false);
    expect(redisMock.values.has(REWARD_KEY)).toBe(false);
    expect(redisMock.zsets.has(REWARD_INDEX_KEY)).toBe(false);
    expect(redisMock.scores.has('t2_user')).toBe(false);
  });

  it('leaves no player or reward data when deletion races with a reward', async () => {
    const reward = mutateUserStateForComment('t2_user', 'alice', 't1_a', (state) =>
      applyComment(state, config(), 't1_a', '2026-07-15', '2026-07-15T12:00:00.000Z')
    );

    await Promise.all([reward, deleteUserData('t2_user')]);

    expect(redisMock.values.has(USER_KEY)).toBe(false);
    expect(redisMock.values.has(REWARD_KEY)).toBe(false);
    expect(redisMock.zsets.has(REWARD_INDEX_KEY)).toBe(false);
    expect(redisMock.scores.has('t2_user')).toBe(false);
  });
});
