import { redis } from '@devvit/web/server';
import type { AppConfig, LeaderboardEntry, UserState } from '../shared/types.js';
import {
  DEFAULT_CONFIG,
  createUserState,
  dateKey,
  levelForXp,
  removeCommentReward,
  type MutationResult,
} from './domain.js';

const CONFIG_KEY = 'subranks:config';
const LEADERBOARD_KEY = 'subranks:leaderboard';
const USER_PREFIX = 'subranks:user:';
const COMMENT_REWARD_PREFIX = 'subranks:comment-reward:';
const COMMENT_REWARD_INDEX_PREFIX = 'subranks:comment-rewards-by-user:';
const COMMENT_REWARD_TTL_SECONDS = 90 * 24 * 60 * 60;

const userKey = (userId: string) => `${USER_PREFIX}${userId}`;
const commentRewardKey = (commentId: string) => `${COMMENT_REWARD_PREFIX}${commentId}`;
const commentRewardIndexKey = (userId: string) => `${COMMENT_REWARD_INDEX_PREFIX}${userId}`;

export type CommentMutationResult = MutationResult & {
  duplicate: boolean;
};

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getConfig(): Promise<AppConfig> {
  const stored = await redis.get(CONFIG_KEY);
  if (!stored) {
    const seeded = { ...DEFAULT_CONFIG, levels: DEFAULT_CONFIG.levels.map((level) => ({ ...level })) };
    await redis.set(CONFIG_KEY, JSON.stringify(seeded), { nx: true });
    return seeded;
  }
  return parseJson(stored, DEFAULT_CONFIG);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await redis.set(CONFIG_KEY, JSON.stringify(config));
}

export async function getUserState(userId: string): Promise<UserState | null> {
  const value = await redis.get(userKey(userId));
  return value ? parseJson<UserState | null>(value, null) : null;
}

export async function recordSyncedFlairText(userId: string, text: string): Promise<boolean> {
  const key = userKey(userId);
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await redis.watch(key);
    try {
      const raw = await redis.get(key);
      const state = raw ? parseJson<UserState | null>(raw, null) : null;
      if (!state) {
        await transaction.unwatch();
        return false;
      }
      if (state.syncedFlairText === text) {
        await transaction.unwatch();
        return true;
      }

      await transaction.multi();
      await transaction.set(
        key,
        JSON.stringify({ ...state, syncedFlairText: text, updatedAt: new Date().toISOString() })
      );
      await transaction.exec();
      return true;
    } catch (error) {
      lastError = error;
      try {
        await transaction.discard();
      } catch {
        // The transaction may already have been aborted by Redis.
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not record synchronized flair.');
}

async function mutateStoredUserState(
  userId: string,
  username: string,
  mutation: (state: UserState) => MutationResult,
  createState?: () => UserState
): Promise<MutationResult | null> {
  const key = userKey(userId);
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await redis.watch(key);
    try {
      const raw = await redis.get(key);
      const stored = raw ? parseJson<UserState | null>(raw, null) : null;
      const existing = stored ?? createState?.() ?? null;
      if (!existing) {
        await transaction.unwatch();
        return null;
      }
      const normalized = { ...existing, username };
      const result = mutation(normalized);

      if (!result.changed) {
        await transaction.unwatch();
        return result;
      }

      await transaction.multi();
      await transaction.set(key, JSON.stringify(result.state));
      await transaction.zAdd(LEADERBOARD_KEY, { member: userId, score: result.state.xp });
      await transaction.exec();
      return result;
    } catch (error) {
      lastError = error;
      try {
        await transaction.discard();
      } catch {
        // The transaction may already have been aborted by Redis.
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not update player state.');
}

export async function createOrMutateUserState(
  userId: string,
  username: string,
  timezone: string,
  mutation: (state: UserState) => MutationResult
): Promise<MutationResult> {
  const now = new Date();
  const result = await mutateStoredUserState(userId, username, mutation, () =>
    createUserState(userId, username, dateKey(now, timezone), now.toISOString())
  );
  if (!result) throw new Error('Could not create player state.');
  return result;
}

export function mutateExistingUserState(
  userId: string,
  username: string,
  mutation: (state: UserState) => MutationResult
): Promise<MutationResult | null> {
  return mutateStoredUserState(userId, username, mutation);
}

export async function mutateUserStateForComment(
  userId: string,
  username: string,
  commentId: string,
  mutation: (state: UserState) => MutationResult
): Promise<CommentMutationResult | null> {
  const key = userKey(userId);
  const rewardKey = commentRewardKey(commentId);
  const rewardIndexKey = commentRewardIndexKey(userId);
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await redis.watch(key, rewardKey, rewardIndexKey);
    try {
      const [raw, existingReward] = await Promise.all([
        redis.get(key),
        redis.get(rewardKey),
      ]);
      const existing = raw ? parseJson<UserState | null>(raw, null) : null;
      if (!existing) {
        await transaction.unwatch();
        return null;
      }
      const normalized = { ...existing, username };

      if (existingReward) {
        await transaction.unwatch();
        return { state: normalized, awardedXp: 0, changed: false, duplicate: true };
      }

      const result = mutation(normalized);
      if (!result.changed) {
        await transaction.unwatch();
        return { ...result, duplicate: false };
      }

      await transaction.multi();
      await transaction.set(key, JSON.stringify(result.state));
      await transaction.zAdd(LEADERBOARD_KEY, { member: userId, score: result.state.xp });
      await transaction.set(
        rewardKey,
        JSON.stringify({ userId, username, awardedXp: result.awardedXp })
      );
      const nowSeconds = Math.floor(Date.now() / 1000);
      await transaction.expire(rewardKey, COMMENT_REWARD_TTL_SECONDS);
      await transaction.zRemRangeByScore(rewardIndexKey, 0, nowSeconds);
      await transaction.zAdd(rewardIndexKey, {
        member: commentId,
        score: nowSeconds + COMMENT_REWARD_TTL_SECONDS,
      });
      await transaction.expire(rewardIndexKey, COMMENT_REWARD_TTL_SECONDS);
      await transaction.exec();
      return { ...result, duplicate: false };
    } catch (error) {
      lastError = error;
      try {
        await transaction.discard();
      } catch {
        // The transaction may already have been aborted by Redis.
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not reward comment.');
}

export async function getLeaderboard(config: AppConfig, limit = 10): Promise<LeaderboardEntry[]> {
  if (limit <= 0) return [];

  const entries: LeaderboardEntry[] = [];
  const batchSize = Math.max(10, limit);
  let offset = 0;

  while (entries.length < limit) {
    const members = await redis.zRange(LEADERBOARD_KEY, offset, offset + batchSize - 1, {
      by: 'rank',
      reverse: true,
    });
    if (members.length === 0) break;

    const states = await redis.mGet(members.map((member) => userKey(member.member)));
    for (const [index, member] of members.entries()) {
      const state = parseJson<UserState | null>(states[index] ?? undefined, null);
      if (!state) continue;
      const level = levelForXp(config.levels, state.xp);
      entries.push({
        rank: entries.length + 1,
        username: state.username,
        xp: state.xp,
        level: level.level,
        title: level.title,
      });
      if (entries.length === limit) break;
    }

    offset += members.length;
    if (members.length < batchSize) break;
  }

  return entries;
}

export async function getCommentReward(
  commentId: string
): Promise<{ userId: string; username: string; awardedXp: number } | null> {
  const value = await redis.get(commentRewardKey(commentId));
  return value ? parseJson(value, null) : null;
}

export async function rollbackCommentReward(
  commentId: string,
  nowIso: string
): Promise<UserState | null> {
  const rewardKey = commentRewardKey(commentId);
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const initialReward = await getCommentReward(commentId);
    if (!initialReward) return null;

    const key = userKey(initialReward.userId);
    const rewardIndexKey = commentRewardIndexKey(initialReward.userId);
    const transaction = await redis.watch(key, rewardKey, rewardIndexKey);
    try {
      const [rawState, rawReward] = await Promise.all([
        redis.get(key),
        redis.get(rewardKey),
      ]);
      const reward = rawReward
        ? parseJson<typeof initialReward | null>(rawReward, null)
        : null;

      if (!reward) {
        await transaction.unwatch();
        return null;
      }

      const state = rawState ? parseJson<UserState | null>(rawState, null) : null;
      await transaction.multi();

      if (!state) {
        await transaction.del(rewardKey);
        await transaction.zRem(rewardIndexKey, [commentId]);
        await transaction.exec();
        return null;
      }

      const result = removeCommentReward(state, commentId, reward.awardedXp, nowIso);
      await transaction.set(key, JSON.stringify(result.state));
      await transaction.zAdd(LEADERBOARD_KEY, { member: reward.userId, score: result.state.xp });
      await transaction.del(rewardKey);
      await transaction.zRem(rewardIndexKey, [commentId]);
      await transaction.exec();
      return result.state;
    } catch (error) {
      lastError = error;
      try {
        await transaction.discard();
      } catch {
        // The transaction may already have been aborted by Redis.
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not roll back comment reward.');
}

export async function deleteUserData(userId: string): Promise<void> {
  const key = userKey(userId);
  const rewardIndexKey = commentRewardIndexKey(userId);
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await redis.watch(key, rewardIndexKey);
    try {
      const rewards = await redis.zRange(rewardIndexKey, 0, -1, { by: 'rank' });
      await transaction.multi();
      if (rewards.length > 0) {
        await transaction.del(...rewards.map((reward) => commentRewardKey(reward.member)));
      }
      await transaction.del(key, rewardIndexKey);
      await transaction.zRem(LEADERBOARD_KEY, [userId]);
      await transaction.exec();
      return;
    } catch (error) {
      lastError = error;
      try {
        await transaction.discard();
      } catch {
        // The transaction may already have been aborted by Redis.
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not delete player data.');
}
