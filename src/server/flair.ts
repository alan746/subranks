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

export function shouldRemoveSyncedFlair(config: AppConfig, user: UserState): boolean {
  return config.flairSyncEnabled || Boolean(user.syncedFlairText);
}
