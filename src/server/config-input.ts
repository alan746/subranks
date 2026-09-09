import type { SaveConfigRequest } from '../shared/types.js';
import { validateConfig } from './domain.js';

type ConfigInputResult = { config: SaveConfigRequest; error?: never } | { error: string; config?: never };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseConfigInput(input: unknown): ConfigInputResult {
  if (!isRecord(input)) return { error: 'Configuration must be an object.' };
  if (typeof input.communityName !== 'string' || typeof input.timezone !== 'string') {
    return { error: 'Community name and timezone must be text.' };
  }
  if (typeof input.flairSyncEnabled !== 'boolean') {
    return { error: 'Flair synchronization must be a boolean.' };
  }
  if (typeof input.checkInXp !== 'number' || typeof input.commentXp !== 'number' || typeof input.dailyCommentLimit !== 'number') {
    return { error: 'XP rewards and daily comment limit must be numbers.' };
  }
  if (!Array.isArray(input.levels)) return { error: 'Ranks must be an array.' };

  const levels: SaveConfigRequest['levels'] = [];
  for (const [index, row] of input.levels.entries()) {
    if (!isRecord(row) || typeof row.title !== 'string' || typeof row.description !== 'string' || typeof row.color !== 'string' || typeof row.requiredXp !== 'number') {
      return { error: `Rank row ${index + 1} must contain text title, description and color fields, and numeric required XP.` };
    }
    levels.push({
      level: index + 1,
      title: row.title.trim(),
      description: row.description.trim(),
      color: row.color,
      requiredXp: row.requiredXp,
    });
  }

  const config: SaveConfigRequest = {
    communityName: input.communityName.trim(),
    timezone: input.timezone.trim(),
    flairSyncEnabled: input.flairSyncEnabled,
    checkInXp: input.checkInXp,
    commentXp: input.commentXp,
    dailyCommentLimit: input.dailyCommentLimit,
    levels,
  };
  const errors = validateConfig(config);
  return errors.length ? { error: errors.join(' ') } : { config };
}
