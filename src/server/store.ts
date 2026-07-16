import { redis } from '@devvit/web/server';
import type { AppConfig, LeaderboardEntry, UserState } from '../shared/types.js';
import { DEFAULT_CONFIG, createUserState, dateKey, levelForXp, type MutationResult } from './domain.js';

const CONFIG_KEY = 'subranks:config';
const LEADERBOARD_KEY = 'subranks:leaderboard';
const USER_PREFIX = 'subranks:user:';
const COMMENT_REWARD_PREFIX = 'subranks:comment-reward:';

const userKey = (userId: string) => `${USER_PREFIX}${userId}`;
const commentRewardKey = (commentId: string) => `${COMMENT_REWARD_PREFIX}${commentId}`;

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

export async function mutateUserState(
  userId: string,
  username: string,
  timezone: string,
  mutation: (state: UserState) => MutationResult
): Promise<MutationResult> {
  const key = userKey(userId);
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await redis.watch(key);
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const today = dateKey(now, timezone);
      const raw = await redis.get(key);
      const existing = raw
        ? parseJson(raw, createUserState(userId, username, today, nowIso))
        : createUserState(userId, username, today, nowIso);
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

export async function getLeaderboard(config: AppConfig, limit = 10): Promise<LeaderboardEntry[]> {
  const members = await redis.zRange(LEADERBOARD_KEY, 0, Math.max(0, limit - 1), {
    by: 'rank',
    reverse: true,
  });
  if (members.length === 0) return [];

  const states = await redis.mGet(members.map((member) => userKey(member.member)));
  return members.flatMap((member, index) => {
    const state = parseJson<UserState | null>(states[index] ?? undefined, null);
    if (!state) return [];
    const level = levelForXp(config.levels, state.xp);
    return [{ rank: index + 1, username: state.username, xp: state.xp, level: level.level, title: level.title }];
  });
}

export async function saveCommentReward(
  commentId: string,
  userId: string,
  username: string,
  awardedXp: number
): Promise<void> {
  const key = commentRewardKey(commentId);
  await redis.set(key, JSON.stringify({ userId, username, awardedXp }), { nx: true });
  await redis.expire(key, 90 * 24 * 60 * 60);
}

export async function getCommentReward(
  commentId: string
): Promise<{ userId: string; username: string; awardedXp: number } | null> {
  const value = await redis.get(commentRewardKey(commentId));
  return value ? parseJson(value, null) : null;
}

export async function deleteCommentReward(commentId: string): Promise<void> {
  await redis.del(commentRewardKey(commentId));
}

export async function deleteUserData(userId: string): Promise<void> {
  await redis.del(userKey(userId));
  await redis.zRem(LEADERBOARD_KEY, [userId]);
}
