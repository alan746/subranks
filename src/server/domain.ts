import type { AppConfig, RankLevel, UserState } from '../shared/types.js';

export const DEFAULT_LEVELS: RankLevel[] = [
  { level: 1, title: 'Newcomer', requiredXp: 0, description: 'A new face joins the community.', color: '#6B7280' },
  { level: 2, title: 'Regular', requiredXp: 20, description: 'Starting to become a familiar name.', color: '#0F766E' },
  { level: 3, title: 'Contributor', requiredXp: 60, description: 'Adds something worthwhile to the conversation.', color: '#047857' },
  { level: 4, title: 'Pathfinder', requiredXp: 140, description: 'Finds useful paths for others to follow.', color: '#2563EB' },
  { level: 5, title: 'Specialist', requiredXp: 300, description: 'Known for knowledge and steady participation.', color: '#4F46E5' },
  { level: 6, title: 'Mentor', requiredXp: 600, description: 'Helps newer members find their footing.', color: '#7C3AED' },
  { level: 7, title: 'Veteran', requiredXp: 1000, description: 'A long-standing pillar of the community.', color: '#A21CAF' },
  { level: 8, title: 'Luminary', requiredXp: 1600, description: 'A voice people recognize and look forward to.', color: '#C2410C' },
  { level: 9, title: 'Legend', requiredXp: 2400, description: 'Part of the community’s living history.', color: '#B45309' },
  { level: 10, title: 'Community Icon', requiredXp: 3500, description: 'A name woven into the identity of the community.', color: '#A16207' },
];

export const DEFAULT_CONFIG: AppConfig = {
  communityName: 'SubRanks',
  checkInXp: 5,
  commentXp: 2,
  dailyCommentLimit: 3,
  flairSyncEnabled: false,
  timezone: 'UTC',
  levels: DEFAULT_LEVELS,
  updatedAt: new Date(0).toISOString(),
};

export function dateKey(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return dateKey(date, 'UTC');
  }
}

export function previousDateKey(today: string): string {
  const value = new Date(`${today}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function checkInXpForStreak(standardXp: number, streak: number): number {
  const rampReduction = streak >= 3 ? 0 : 3 - Math.max(1, streak);
  return Math.max(0, standardXp - rampReduction);
}

export function nextCheckInStreak(state: UserState, today: string): number {
  return state.lastCheckInDate === previousDateKey(today) ? state.streak + 1 : 1;
}

export function checkInXpForToday(state: UserState, config: AppConfig, today: string): number {
  const current = normalizeDaily(state, today);
  const streak = current.daily.checkedIn && current.lastCheckInDate === today
    ? current.streak
    : nextCheckInStreak(current, today);
  return checkInXpForStreak(config.checkInXp, streak);
}

export function createUserState(userId: string, username: string, today: string, nowIso: string): UserState {
  return {
    userId,
    username,
    xp: 0,
    streak: 0,
    longestStreak: 0,
    lastCheckInDate: null,
    daily: { date: today, checkedIn: false, commentIds: [] },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function normalizeDaily(state: UserState, today: string): UserState {
  const streak = !state.lastCheckInDate || state.lastCheckInDate < previousDateKey(today)
    ? 0
    : state.streak;
  if (state.daily.date === today && streak === state.streak) return state;
  return {
    ...state,
    streak,
    daily: state.daily.date === today
      ? state.daily
      : { date: today, checkedIn: false, commentIds: [] },
  };
}

export function levelForXp(levels: RankLevel[], xp: number): RankLevel {
  const sorted = [...levels].sort((a, b) => a.requiredXp - b.requiredXp);
  return [...sorted].reverse().find((level) => xp >= level.requiredXp) ?? sorted[0];
}

export function nextLevelForXp(levels: RankLevel[], xp: number): RankLevel | null {
  const sorted = [...levels].sort((a, b) => a.requiredXp - b.requiredXp);
  return sorted.find((level) => level.requiredXp > xp) ?? null;
}

export function progressForXp(levels: RankLevel[], xp: number): number {
  const current = levelForXp(levels, xp);
  const next = nextLevelForXp(levels, xp);
  if (!next) return 100;
  const range = next.requiredXp - current.requiredXp;
  return Math.max(0, Math.min(100, Math.round(((xp - current.requiredXp) / range) * 100)));
}

export type MutationResult = {
  state: UserState;
  awardedXp: number;
  changed: boolean;
};

export function applyCheckIn(
  state: UserState,
  config: AppConfig,
  today: string,
  nowIso: string
): MutationResult {
  const current = normalizeDaily(state, today);
  if (current.daily.checkedIn) return { state: current, awardedXp: 0, changed: false };

  const streak = nextCheckInStreak(current, today);
  const awardedXp = checkInXpForStreak(config.checkInXp, streak);
  return {
    state: {
      ...current,
      xp: current.xp + awardedXp,
      streak,
      longestStreak: Math.max(current.longestStreak, streak),
      lastCheckInDate: today,
      daily: { ...current.daily, checkedIn: true },
      updatedAt: nowIso,
    },
    awardedXp,
    changed: true,
  };
}

export function applyComment(
  state: UserState,
  config: AppConfig,
  commentId: string,
  today: string,
  nowIso: string
): MutationResult {
  const current = normalizeDaily(state, today);
  if (
    current.daily.commentIds.includes(commentId) ||
    current.daily.commentIds.length >= config.dailyCommentLimit
  ) {
    return { state: current, awardedXp: 0, changed: false };
  }

  return {
    state: {
      ...current,
      xp: current.xp + config.commentXp,
      daily: {
        ...current.daily,
        commentIds: [...current.daily.commentIds, commentId],
      },
      updatedAt: nowIso,
    },
    awardedXp: config.commentXp,
    changed: true,
  };
}

export function removeCommentReward(
  state: UserState,
  commentId: string,
  awardedXp: number,
  nowIso: string
): MutationResult {
  const hadDailyComment = state.daily.commentIds.includes(commentId);
  return {
    state: {
      ...state,
      xp: Math.max(0, state.xp - awardedXp),
      daily: hadDailyComment
        ? { ...state.daily, commentIds: state.daily.commentIds.filter((id) => id !== commentId) }
        : state.daily,
      updatedAt: nowIso,
    },
    awardedXp: -awardedXp,
    changed: awardedXp > 0,
  };
}

export function validateConfig(input: Omit<AppConfig, 'updatedAt'>): string[] {
  const errors: string[] = [];
  if (!input.communityName.trim() || input.communityName.trim().length > 40) {
    errors.push('Community name must be between 1 and 40 characters.');
  }
  if (!Number.isInteger(input.checkInXp) || input.checkInXp < 0 || input.checkInXp > 100) {
    errors.push('Check-in XP must be a whole number from 0 to 100.');
  }
  if (!Number.isInteger(input.commentXp) || input.commentXp < 0 || input.commentXp > 100) {
    errors.push('Comment XP must be a whole number from 0 to 100.');
  }
  if (!Number.isInteger(input.dailyCommentLimit) || input.dailyCommentLimit < 0 || input.dailyCommentLimit > 10) {
    errors.push('Daily comment limit must be a whole number from 0 to 10.');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format();
  } catch {
    errors.push('Timezone must be a valid IANA timezone, such as America/Toronto or UTC.');
  }
  if (input.levels.length < 2 || input.levels.length > 18) {
    errors.push('Rank system must contain between 2 and 18 levels.');
  }

  input.levels.forEach((level, index) => {
    if (level.level !== index + 1) errors.push(`Rank row ${index + 1} has an invalid level number.`);
    if (!level.title.trim() || level.title.trim().length > 24) {
      errors.push(`Level ${index + 1} title must be between 1 and 24 characters.`);
    }
    if (level.description.length > 100) errors.push(`Level ${index + 1} description is too long.`);
    if (!Number.isInteger(level.requiredXp) || level.requiredXp < 0 || level.requiredXp > 1_000_000) {
      errors.push(`Level ${index + 1} XP must be a whole number from 0 to 1,000,000.`);
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(level.color)) errors.push(`Level ${index + 1} color must be a hex color.`);
    if (index === 0 && level.requiredXp !== 0) errors.push('Level 1 must start at 0 XP.');
    if (index > 0 && level.requiredXp <= input.levels[index - 1].requiredXp) {
      errors.push(`Level ${index + 1} XP must be higher than the previous level.`);
    }
  });

  return [...new Set(errors)];
}

export function textColorForBackground(hex: string): 'light' | 'dark' {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 155 ? 'dark' : 'light';
}
