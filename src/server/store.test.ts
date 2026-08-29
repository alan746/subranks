import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, UserState } from '../shared/types.js';
import { applyCheckIn, applyComment, createUserState, DEFAULT_CONFIG } from './domain.js';

type QueuedOperation = () => void;

const redisMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  const versions = new Map<string, number>();
  const scores = new Map<string, number>();

  const bumpVersion = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);

  return {
    values,
    scores,
    reset() {
      values.clear();
      versions.clear();
      scores.clear();
    },
    seed(key: string, value: string) {
      values.set(key, value);
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
        async zAdd(_key: string, entry: { member: string; score: number }) {
          operations.push(() => scores.set(entry.member, entry.score));
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
} from './store.js';

const USER_KEY = 'subranks:user:t2_user';

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
});
