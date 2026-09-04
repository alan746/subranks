import type { AppConfig, UserState } from '../shared/types.js';
import { levelForXp, textColorForBackground } from './domain.js';

export type RankFlair = {
  text: string;
  backgroundColor: string;
  textColor: 'light' | 'dark';
};

export function rankFlairForUser(config: AppConfig, user: UserState): RankFlair {
  const level = levelForXp(config.levels, user.xp);
  return {
    text: `${level.title} · Lv.${level.level}`,
    backgroundColor: level.color,
    textColor: textColorForBackground(level.color),
  };
}

export function shouldRemoveSyncedFlair(
  config: AppConfig,
  user: UserState,
  currentFlairText: string | undefined
): boolean {
  const ownedFlairText = user.syncedFlairText
    ?? (config.flairSyncEnabled ? rankFlairForUser(config, user).text : undefined);
  return Boolean(ownedFlairText && currentFlairText === ownedFlairText);
}

export async function persistSyncedFlairOrCompensate(
  recordOwnership: () => Promise<boolean>,
  removeFlair: () => Promise<void>
): Promise<boolean> {
  let recorded: boolean;
  try {
    recorded = await recordOwnership();
  } catch (error) {
    await removeFlair();
    throw error;
  }
  if (recorded) return true;
  await removeFlair();
  return false;
}
