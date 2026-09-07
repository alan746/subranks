# SubRanks

SubRanks is a persistent community progression game for Reddit. A player explicitly joins the subreddit through SubRanks, immediately claims its first title at 0 XP, then earns XP from daily check-ins and their first few genuine comments. XP unlocks a 2–18 level title ladder written by the community's moderators. An optional setting synchronizes each unlocked title to the member's Reddit user flair.

SubRanks is designed for communities whose identity comes from their own language, lore, jokes, and expertise. A wizard community can use ten ranks from `Arcane Novice` to `Legendary Wizard`, while a software-development community can use the eight-level industry ladder `Junior / Entry → Mid-Level → Senior → Staff → Senior Staff → Principal → Distinguished → Fellow`. The app does not call an LLM or any external API. Moderators remain the authors and final decision-makers.

## What members can do

- Join the subreddit and claim its first community title at 0 XP.
- Check in once per community day. With the default 5 XP standard reward, streak days 1, 2, and 3+ award 3, 4, and 5 XP.
- Earn configurable XP from their first 0–10 comments each day (default: first three).
- Build current and longest check-in streaks.
- See their current title, progress to the next title, and every community rank.
- View a top-ten all-time leaderboard.
- Delete their stored SubRanks profile, leaderboard entry, comment reward records, and matching synchronized flair.

## What moderators can do

- Set the community-facing name and IANA timezone.
- Configure the standard day-3+ check-in XP, comment XP, and the daily comment reward limit.
- Add or remove ranks, from a minimum of 2 to a maximum of 18.
- Edit every title, description, color, and XP threshold.
- Start from built-in Wizardry (10 ranks) or Software Engineering (8 ranks) examples.
- Optionally synchronize ranks to Reddit user flair.
- Create the interactive SubRanks post from the subreddit moderator menu.

## Important behavior

- Comments are counted automatically through Reddit's `onCommentCreate` trigger. The app stores the comment ID only to prevent duplicate rewards; it never stores comment text.
- Check-ins and comments award XP only after the player explicitly joins through SubRanks. The join button uses Reddit's subscribe permission; if the account already joined the subreddit, Reddit treats it as a no-op and SubRanks creates the progression profile.
- Devvit does not expose a reliable user-context subscription lookup or unsubscribe trigger to this app, so a later subreddit departure cannot automatically freeze an existing profile.
- Trigger delivery can occur more than once, so the same comment ID cannot receive XP twice.
- If a rewarded comment is deleted within 90 days, its XP is rolled back and the stored comment-reward record is deleted.
- Reddit does not expose a per-user upvote trigger, so SubRanks does not award XP for Reddit votes.
- Flair synchronization is off by default. Enabling it overwrites a player's user flair in this subreddit whenever the player earns XP or opens SubRanks.
- The daily boundary uses the moderator-configured timezone. `UTC` is the default.

## Technology

- TypeScript
- React 19
- Devvit Web 0.13.8
- Express server endpoints
- Devvit Redis
- Reddit API and comment/app triggers
- Vite
- Vitest

Node.js 22.2.0 or newer is required.

## Configure the Devvit app identity

The included `devvit.json` uses the placeholder app name `subranks-demo`. Devvit app names are globally unique and must belong to your Reddit developer account.

1. Sign in at [Reddit for Developers](https://developers.reddit.com/new) and create/reserve a new app with a unique 3–16 character slug, such as `alan-subranks`.
2. Replace `subranks-demo` in `devvit.json` with that exact slug.
3. Do not change the configured Redis, Reddit, menu, or trigger permissions unless you also change the corresponding code.

## Install and verify locally

```bash
npm install
npm run check
```

`npm run check` performs strict TypeScript checking, runs the pure domain tests, and creates a production Devvit bundle. It does not connect to Reddit.

## Playtest on Reddit

Devvit backend capabilities do not run in a standalone local browser. Use a Reddit playtest for Redis, identity, triggers, post creation, and flair.

```bash
npx devvit login
npm run dev
```

If the app has no saved playtest subreddit, Devvit creates a small development subreddit automatically. To choose a public test subreddit with fewer than 200 members that you moderate:

```bash
npx devvit playtest r/YOUR_TEST_SUBREDDIT
```

When the CLI prints `Playtest ready`, open its Reddit URL. From the subreddit moderator menu, choose **Create SubRanks post**. Open the new post and select **Open my rank**.

## Moderator setup

1. Open the **Manage** tab. It is returned only when the server verifies that the current user moderates this subreddit.
2. Set a progression name and timezone, for example `America/Toronto`.
3. Choose a starter theme or create a ladder of 2–18 ranks manually.
4. Confirm that XP thresholds are strictly increasing and level 1 starts at 0 XP.
5. Leave flair synchronization disabled for the first functional test.
6. Select **Publish rank system**.
7. If you later enable flair synchronization, first enable user flair in the subreddit's Reddit settings. Be aware that SubRanks will overwrite participating users' existing flair in that subreddit.

## Reddit integration test checklist

1. Open the app while signed in. Confirm the account name and subreddit name are correct.
2. Before joining, confirm check-in is unavailable and comments do not award XP.
3. Select **Join community & claim first rank**. Confirm Reddit joins the subreddit and the first 0 XP title appears.
4. Check in. With the default standard reward, confirm streak day 1 awards 3 XP and a second check-in awards nothing. On later days, confirm day 2 awards 4 XP and day 3+ awards 5 XP; a missed day resets the next reward to 3 XP.
5. Add four non-empty, non-spam comments anywhere in the test subreddit.
6. Reopen or refresh SubRanks after each comment. Confirm only the first three comments receive XP with the default settings.
7. Delete one of the rewarded comments. Refresh and confirm its XP is removed.
8. Change a low rank threshold temporarily so your test user levels up. Confirm the title and progress bar update.
9. Confirm the leaderboard contains the test user once, with the correct XP.
10. Enable user flair, earn XP again, and confirm the title appears beside the username.
11. Confirm a non-moderator cannot call the configuration endpoint and cannot see the Manage tab.
12. Select **Delete my SubRanks data** and confirm XP, streak, leaderboard entry, enrollment, and the matching synchronized flair are removed. Unrelated flair must remain unchanged. This does not unsubscribe the Reddit account from the subreddit.
13. Test the post on narrow mobile width and in Reddit light and dark themes.

## Upload and publish

Run the complete check before every upload:

```bash
npm run check
npm run upload
```

For an unlisted release:

```bash
npm run release
```

To request an App Directory listing so any moderator can install it:

```bash
npm run release:public
```

Public availability requires Reddit App Review. Keep this README in the project because Reddit requires a complete, non-placeholder README for review. After publishing, use the app listing URL from the developer dashboard and a public interactive-post URL for the hackathon submission.

## Data and privacy

Per installation, SubRanks stores:

- Reddit user ID and username
- progression enrollment time
- XP and streak values
- current day's check-in state
- IDs of rewarded comments for deduplication and deletion rollback
- moderator-authored configuration
- leaderboard scores

It does not store comment bodies, votes, email addresses, private messages, or external tracking data. Comment reward records expire after 90 days. Players can delete their profile from the My Rank screen. See [PRIVACY.md](PRIVACY.md).

## Project structure

```text
src/client/           React interface and inline launch screen
src/server/domain.ts  Pure XP, streak, rank, and validation rules
src/server/store.ts   Redis persistence and leaderboard
src/server/index.ts   API, moderator menu, triggers, and flair sync
src/shared/types.ts   Shared client/server data contracts
```

## License

MIT. See [LICENSE](LICENSE).
