import express from 'express';
import {
  context,
  createServer,
  EntrypointHeight,
  getServerPort,
  reddit,
} from '@devvit/web/server';
import type {
  OnAppInstallRequest,
  OnCommentCreateRequest,
  OnCommentDeleteRequest,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared';
import type {
  ApiError,
  AppConfig,
  AppStateResponse,
  CheckInResponse,
  SaveConfigRequest,
  UserState,
} from '../shared/types.js';
import {
  DEFAULT_CONFIG,
  applyCheckIn,
  applyComment,
  checkInXpForToday,
  checkInXpForStreak,
  dateKey,
  levelForXp,
  nextLevelForXp,
  normalizeDaily,
  progressForXp,
  removeCommentReward,
  textColorForBackground,
  validateConfig,
} from './domain.js';
import {
  deleteCommentReward,
  deleteUserData,
  getCommentReward,
  getConfig,
  getLeaderboard,
  getUserState,
  mutateUserState,
  mutateUserStateForComment,
  saveConfig,
} from './store.js';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected server error.';
}

async function isCurrentUserModerator(): Promise<boolean> {
  if (!context.userId || !context.subredditName) return false;
  try {
    const user = await reddit.getCurrentUser();
    if (!user) return false;
    const permissions = await user.getModPermissionsForSubreddit(context.subredditName);
    return permissions.length > 0;
  } catch {
    return false;
  }
}

async function syncFlair(
  config: AppConfig,
  user: UserState
): Promise<string | undefined> {
  if (!config.flairSyncEnabled || !context.subredditName) return undefined;
  const level = levelForXp(config.levels, user.xp);
  try {
    await reddit.setUserFlair({
      subredditName: context.subredditName,
      username: user.username,
      text: `${level.title} · Lv.${level.level}`,
      backgroundColor: level.color,
      textColor: textColorForBackground(level.color),
    });
    return undefined;
  } catch (error) {
    console.error('Could not sync user flair:', error);
    return 'Your XP was saved, but Reddit flair could not be updated. Check the app’s moderator permissions and subreddit flair settings.';
  }
}

async function buildState(): Promise<AppStateResponse> {
  const config = await getConfig();
  const now = new Date();
  const today = dateKey(now, config.timezone);
  const username = context.username;
  let user: UserState | null = null;

  if (context.userId && username) {
    user = await getUserState(context.userId);
    if (user) user = normalizeDaily(user, today);
  }

  const currentLevel = user ? levelForXp(config.levels, user.xp) : null;
  const nextLevel = user ? nextLevelForXp(config.levels, user.xp) : null;
  const leaderboard = await getLeaderboard(config);

  return {
    authenticated: Boolean(context.userId && username),
    enrolled: Boolean(user),
    subredditName: context.subredditName ?? '',
    isModerator: await isCurrentUserModerator(),
    config,
    user,
    currentLevel,
    nextLevel,
    progressPercent: user ? progressForXp(config.levels, user.xp) : 0,
    checkInXpToday: user
      ? checkInXpForToday(user, config, today)
      : checkInXpForStreak(config.checkInXp, 1),
    commentsRewardedToday: user?.daily.date === today ? user.daily.commentIds.length : 0,
    leaderboard,
  };
}

app.get('/api/state', async (_req, res) => {
  try {
    const state = await buildState();
    if (state.user && state.config.flairSyncEnabled) await syncFlair(state.config, state.user);
    res.json(state);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errorMessage(error) } satisfies ApiError);
  }
});

app.post('/api/join', async (_req, res) => {
  if (!context.userId || !context.username) {
    res.status(401).json({ error: 'Sign in to Reddit before joining this community.' } satisfies ApiError);
    return;
  }

  try {
    const config = await getConfig();
    const existing = await getUserState(context.userId);
    if (!existing) {
      await reddit.subscribeToCurrentSubreddit();
      const result = await mutateUserState(
        context.userId,
        context.username,
        config.timezone,
        (state) => ({ state, awardedXp: 0, changed: true })
      );
      await syncFlair(config, result.state);
    }
    res.json(await buildState());
  } catch (error) {
    console.error('Could not join SubRanks:', error);
    res.status(500).json({ error: 'Could not join this community. Check the app permission and try again.' } satisfies ApiError);
  }
});

app.post('/api/check-in', async (_req, res) => {
  if (!context.userId || !context.username) {
    res.status(401).json({ error: 'Sign in to Reddit before checking in.' } satisfies ApiError);
    return;
  }

  try {
    const config = await getConfig();
    const before = await getUserState(context.userId);
    if (!before) {
      res.status(403).json({ error: 'Join this community before earning XP.' } satisfies ApiError);
      return;
    }
    const beforeLevel = levelForXp(config.levels, before.xp);
    const result = await mutateUserState(
      context.userId,
      context.username,
      config.timezone,
      (state) => applyCheckIn(state, config, dateKey(new Date(), config.timezone), new Date().toISOString())
    );
    const afterLevel = levelForXp(config.levels, result.state.xp);
    const flairWarning = await syncFlair(config, result.state);
    const state = await buildState();
    const response: CheckInResponse = {
      ...state,
      awardedXp: result.awardedXp,
      alreadyCheckedIn: !result.changed,
      leveledUp: afterLevel.level > beforeLevel.level,
      ...(flairWarning ? { flairWarning } : {}),
    };
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errorMessage(error) } satisfies ApiError);
  }
});

app.put('/api/admin/config', async (req, res) => {
  if (!(await isCurrentUserModerator())) {
    res.status(403).json({ error: 'Only moderators of this subreddit can change rank settings.' } satisfies ApiError);
    return;
  }

  const input = req.body as SaveConfigRequest;
  const candidate: Omit<AppConfig, 'updatedAt'> = {
    communityName: String(input.communityName ?? '').trim(),
    checkInXp: Number(input.checkInXp),
    commentXp: Number(input.commentXp),
    dailyCommentLimit: Number(input.dailyCommentLimit),
    flairSyncEnabled: Boolean(input.flairSyncEnabled),
    timezone: String(input.timezone ?? '').trim(),
    levels: Array.isArray(input.levels)
      ? input.levels.map((level, index) => ({
          level: index + 1,
          title: String(level.title ?? '').trim(),
          requiredXp: Number(level.requiredXp),
          description: String(level.description ?? '').trim(),
          color: String(level.color ?? ''),
        }))
      : [],
  };
  const errors = validateConfig(candidate);
  if (errors.length > 0) {
    res.status(400).json({ error: errors.join(' ') } satisfies ApiError);
    return;
  }

  try {
    await saveConfig({ ...candidate, updatedAt: new Date().toISOString() });
    res.json(await buildState());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errorMessage(error) } satisfies ApiError);
  }
});

app.delete('/api/me', async (_req, res) => {
  if (!context.userId) {
    res.status(401).json({ error: 'Sign in to Reddit first.' } satisfies ApiError);
    return;
  }
  try {
    await deleteUserData(context.userId);
    res.json(await buildState());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errorMessage(error) } satisfies ApiError);
  }
});

app.post('/internal/menu/create-post', async (_req, res) => {
  try {
    if (!(await isCurrentUserModerator())) {
      res.status(403).json({ showToast: 'Only subreddit moderators can create this post.' } satisfies UiResponse);
      return;
    }
    const config = await getConfig();
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: `🏅 ${config.communityName}: check in and level up`,
      entry: 'default',
      textFallback: {
        text: `Open the interactive SubRanks post to check in, earn XP from your first ${config.dailyCommentLimit} comments each day, and climb the community ranks.`,
      },
      styles: {
        backgroundColor: '#FFF7EDFF',
        backgroundColorDark: '#17120EFF',
        height: EntrypointHeight.REGULAR,
      },
    });
    res.json({
      showToast: { text: 'SubRanks post created.', appearance: 'success' },
      navigateTo: post.permalink,
    } satisfies UiResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ showToast: `Could not create post: ${errorMessage(error)}` } satisfies UiResponse);
  }
});

app.post('/internal/triggers/app-install', async (req, res) => {
  const _input = req.body as OnAppInstallRequest;
  try {
    const current = await getConfig();
    if (current.updatedAt === new Date(0).toISOString()) {
      await saveConfig({ ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() });
    }
    res.json({} satisfies TriggerResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({} satisfies TriggerResponse);
  }
});

app.post('/internal/triggers/comment-create', async (req, res) => {
  const input = req.body as OnCommentCreateRequest;
  const comment = input.comment;
  const author = input.author;
  if (
    !comment ||
    !author?.id ||
    !author.name ||
    author.name === context.appSlug ||
    comment.deleted ||
    comment.spam ||
    comment.body.trim().length === 0
  ) {
    res.json({} satisfies TriggerResponse);
    return;
  }

  try {
    const config = await getConfig();
    const before = await getUserState(author.id);
    if (!before) {
      res.json({} satisfies TriggerResponse);
      return;
    }
    const beforeLevel = levelForXp(config.levels, before.xp);
    const result = await mutateUserStateForComment(
      author.id,
      author.name,
      config.timezone,
      comment.id,
      (state) =>
        applyComment(state, config, comment.id, dateKey(new Date(), config.timezone), new Date().toISOString())
    );
    if (result.awardedXp > 0) {
      const afterLevel = levelForXp(config.levels, result.state.xp);
      if (afterLevel.level !== beforeLevel.level) await syncFlair(config, result.state);
    }
    res.json({} satisfies TriggerResponse);
  } catch (error) {
    console.error('Comment reward failed:', error);
    res.status(500).json({} satisfies TriggerResponse);
  }
});

app.post('/internal/triggers/comment-delete', async (req, res) => {
  const input = req.body as OnCommentDeleteRequest;
  try {
    const reward = await getCommentReward(input.commentId);
    if (!reward) {
      res.json({} satisfies TriggerResponse);
      return;
    }
    const config = await getConfig();
    const result = await mutateUserState(reward.userId, reward.username, config.timezone, (state) =>
      removeCommentReward(state, input.commentId, reward.awardedXp, new Date().toISOString())
    );
    await deleteCommentReward(input.commentId);
    await syncFlair(config, result.state);
    res.json({} satisfies TriggerResponse);
  } catch (error) {
    console.error('Comment deletion rollback failed:', error);
    res.status(500).json({} satisfies TriggerResponse);
  }
});

const port = getServerPort();
const server = createServer(app);
server.on('error', (error) => console.error('Server error:', error));
server.listen(port, () => console.log(`SubRanks server listening on ${port}`));
