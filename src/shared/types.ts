export type RankLevel = {
  level: number;
  title: string;
  requiredXp: number;
  description: string;
  color: string;
};

export type AppConfig = {
  communityName: string;
  checkInXp: number;
  commentXp: number;
  dailyCommentLimit: number;
  flairSyncEnabled: boolean;
  timezone: string;
  levels: RankLevel[];
  updatedAt: string;
};

export type DailyActivity = {
  date: string;
  checkedIn: boolean;
  commentIds: string[];
};

export type UserState = {
  userId: string;
  username: string;
  xp: number;
  streak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  daily: DailyActivity;
  createdAt: string;
  updatedAt: string;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  xp: number;
  level: number;
  title: string;
};

export type AppStateResponse = {
  authenticated: boolean;
  enrolled: boolean;
  subredditName: string;
  isModerator: boolean;
  config: AppConfig;
  user: UserState | null;
  currentLevel: RankLevel | null;
  nextLevel: RankLevel | null;
  progressPercent: number;
  checkInXpToday: number;
  commentsRewardedToday: number;
  leaderboard: LeaderboardEntry[];
};

export type CheckInResponse = AppStateResponse & {
  awardedXp: number;
  alreadyCheckedIn: boolean;
  leveledUp: boolean;
  flairWarning?: string;
};

export type SaveConfigRequest = Pick<
  AppConfig,
  | 'communityName'
  | 'checkInXp'
  | 'commentXp'
  | 'dailyCommentLimit'
  | 'flairSyncEnabled'
  | 'timezone'
  | 'levels'
>;

export type ApiError = {
  error: string;
};
