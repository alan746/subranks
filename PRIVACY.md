# SubRanks Privacy Notice

Last updated: August 28, 2026

SubRanks is a Reddit Devvit application. It processes only the information needed to operate community XP, ranks, streaks, and leaderboards within a subreddit installation.

## Data stored

- Reddit account ID and username
- the time the account enrolled in this community's SubRanks progression
- XP, current streak, longest streak, and last check-in date
- current-day check-in status and rewarded comment IDs
- leaderboard score
- moderator-authored rank configuration

SubRanks does not store comment bodies, votes, email addresses, private messages, IP addresses, or external advertising identifiers. It does not send Reddit data to an external API.

When a player selects **Join community & claim first rank**, SubRanks asks Reddit to subscribe that account to the current subreddit and creates a 0 XP progression profile. Deleting SubRanks data removes that profile but does not unsubscribe the Reddit account from the subreddit.

Rewarded comment IDs are used to prevent duplicate XP and to remove XP if a rewarded comment is deleted. Comment-reward records expire after 90 days. Reddit permits retaining IDs and timestamps needed to contextualize deleted content; no deleted comment text is stored.

## Data sharing

SubRanks does not sell or share stored data with third parties. Leaderboard usernames, XP, and titles are visible to people who open the SubRanks experience in the installed subreddit.

## Data deletion

A signed-in player can select **Delete my SubRanks data** in the My Rank screen. This removes the player's stored profile, leaderboard entry, indexed comment-reward records, and matching synchronized Reddit flair from the current subreddit installation. Unrelated flair is left unchanged. Deleting data is irreversible.

Comment-reward records created before per-player reward indexing was introduced cannot be enumerated through the available storage interface. Those legacy records expire automatically within their original 90-day retention period and cannot recreate a deleted profile.

## Flair

If a moderator enables flair synchronization, SubRanks sets the participating user's flair in that subreddit to the unlocked rank and records the synchronized text. This can overwrite an existing subreddit flair. Moderators can leave this feature disabled. Profile deletion removes the flair only while its current text still matches the recorded SubRanks value. If Reddit rejects flair removal, stored data is still deleted and the player receives a warning to clear the flair through subreddit settings.

## Contact

Before public submission, replace this section with the developer's Reddit username or support subreddit so users can request help.
