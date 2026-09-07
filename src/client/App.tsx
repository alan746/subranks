import { useEffect, useMemo, useState } from 'react';
import type {
  ApiError,
  AppConfig,
  AppStateResponse,
  CheckInResponse,
  DeleteDataResponse,
  RankLevel,
  SaveConfigRequest,
} from '../shared/types.js';

type Tab = 'home' | 'leaderboard' | 'ranks' | 'admin';
type Notice = { kind: 'success' | 'error'; text: string } | null;

type RankTemplate = {
  name: string;
  levels: Array<{ title: string; requiredXp: number }>;
};

const RANK_COLORS = ['#6B7280', '#0F766E', '#047857', '#2563EB', '#4F46E5', '#7C3AED', '#A21CAF', '#C2410C', '#B45309', '#A16207'];

const TEMPLATES: Record<string, RankTemplate> = {
  wizard: {
    name: 'Wizardry',
    levels: [
      { title: 'Arcane Novice', requiredXp: 0 },
      { title: 'Wizard Apprentice', requiredXp: 20 },
      { title: 'Junior Wizard', requiredXp: 60 },
      { title: 'Intermediate Wizard', requiredXp: 140 },
      { title: 'Adept Wizard', requiredXp: 300 },
      { title: 'Advanced Wizard', requiredXp: 600 },
      { title: 'Senior Wizard', requiredXp: 1000 },
      { title: 'Master Wizard', requiredXp: 1600 },
      { title: 'Archwizard', requiredXp: 2400 },
      { title: 'Legendary Wizard', requiredXp: 3500 },
    ],
  },
  software: {
    name: 'Software Engineering',
    levels: [
      { title: 'Junior / Entry', requiredXp: 0 },
      { title: 'Mid-Level', requiredXp: 30 },
      { title: 'Senior', requiredXp: 100 },
      { title: 'Staff', requiredXp: 250 },
      { title: 'Senior Staff', requiredXp: 600 },
      { title: 'Principal', requiredXp: 1100 },
      { title: 'Distinguished', requiredXp: 1900 },
      { title: 'Fellow', requiredXp: 3000 },
    ],
  },
};

async function api<T extends object>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  const body = (await response.json()) as T | ApiError;
  if (!response.ok) throw new Error('error' in body ? body.error : 'Request failed.');
  return body as T;
}

function cloneConfig(config: AppConfig): AppConfig {
  return { ...config, levels: config.levels.map((level) => ({ ...level })) };
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <div className="loader" />
      <p>Loading community ranks…</p>
    </main>
  );
}

function ErrorScreen({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="center-screen">
      <div className="empty-icon">!</div>
      <h1>SubRanks could not load</h1>
      <p>{message}</p>
      <button className="primary-button" onClick={retry}>Try again</button>
    </main>
  );
}

function AppHeader({ state, tab, setTab }: { state: AppStateResponse; tab: Tab; setTab: (tab: Tab) => void }) {
  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'home', label: 'My rank', icon: '✦' },
    { id: 'leaderboard', label: 'Leaders', icon: '↗' },
    { id: 'ranks', label: 'Ranks', icon: '≡' },
    ...(state.isModerator ? [{ id: 'admin' as Tab, label: 'Manage', icon: '⚙' }] : []),
  ];
  return (
    <>
      <header className="app-header">
        <div>
          <div className="brand"><span className="brand-mark">✦</span> SubRanks</div>
          <p>{state.config.communityName} · r/{state.subredditName}</p>
        </div>
        {state.user && <div className="user-pill">u/{state.user.username}</div>}
      </header>
      <nav className="tab-bar" aria-label="SubRanks sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'tab active' : 'tab'}
            onClick={() => setTab(item.id)}
          >
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
    </>
  );
}

function HomeTab({
  state,
  joining,
  checkingIn,
  onJoin,
  onCheckIn,
  onDeleteData,
}: {
  state: AppStateResponse;
  joining: boolean;
  checkingIn: boolean;
  onJoin: () => void;
  onCheckIn: () => void;
  onDeleteData: () => void;
}) {
  if (!state.authenticated) {
    return (
      <section className="empty-state card">
        <div className="empty-icon">u/</div>
        <h2>Sign in to join the ranks</h2>
        <p>Your XP and streak are linked to your Reddit account inside this community.</p>
      </section>
    );
  }

  if (!state.enrolled || !state.user || !state.currentLevel) {
    return (
      <section className="empty-state card">
        <div className="empty-icon">✦</div>
        <h2>Join r/{state.subredditName} to begin</h2>
        <p>Join the subreddit and its SubRanks progression to claim the first title. Only enrolled members can earn XP from check-ins and comments.</p>
        <button className="primary-button" disabled={joining} onClick={onJoin}>
          {joining ? 'Joining…' : 'Join community & claim first rank'}
        </button>
      </section>
    );
  }

  const checkedIn = state.user.daily.checkedIn;
  const commentsLeft = Math.max(0, state.config.dailyCommentLimit - state.commentsRewardedToday);
  const xpToNext = state.nextLevel ? state.nextLevel.requiredXp - state.user.xp : 0;

  return (
    <div className="stack">
      <section className="rank-hero card" style={{ '--rank-color': state.currentLevel.color } as React.CSSProperties}>
        <div className="rank-glow" />
        <div className="rank-topline">
          <span className="level-chip">LEVEL {state.currentLevel.level}</span>
          <span className="xp-total">{state.user.xp.toLocaleString()} XP</span>
        </div>
        <h1>{state.currentLevel.title}</h1>
        <p>{state.currentLevel.description}</p>
        <div className="progress-label">
          <span>{state.nextLevel ? `${xpToNext} XP to ${state.nextLevel.title}` : 'Maximum rank reached'}</span>
          <strong>{state.progressPercent}%</strong>
        </div>
        <div className="progress-track"><div style={{ width: `${state.progressPercent}%` }} /></div>
      </section>

      <section className="daily-grid">
        <div className="card checkin-card">
          <div className="section-heading">
            <div><span className="eyebrow">TODAY</span><h2>Daily check-in</h2></div>
            <span className="reward-pill">+{state.checkInXpToday} XP</span>
          </div>
          <p>{checkedIn
            ? `Streak day ${state.user.streak} complete. Come back tomorrow to keep it going.`
            : `Days 1, 2 and 3+ award ${Math.max(0, state.config.checkInXp - 2)}, ${Math.max(0, state.config.checkInXp - 1)} and ${state.config.checkInXp} XP.`}</p>
          <button className={checkedIn ? 'primary-button checked' : 'primary-button'} disabled={checkedIn || checkingIn} onClick={onCheckIn}>
            {checkingIn ? 'Checking in…' : checkedIn ? '✓ Checked in today' : 'Check in now'}
          </button>
        </div>

        <div className="card activity-card">
          <div className="section-heading">
            <div><span className="eyebrow">PARTICIPATION</span><h2>Comment XP</h2></div>
            <span className="reward-pill">+{state.config.commentXp} each</span>
          </div>
          <div className="comment-dots" aria-label={`${state.commentsRewardedToday} comments rewarded today`}>
            {Array.from({ length: state.config.dailyCommentLimit }, (_, index) => (
              <span key={index} className={index < state.commentsRewardedToday ? 'filled' : ''}>{index < state.commentsRewardedToday ? '✓' : index + 1}</span>
            ))}
          </div>
          <p>{commentsLeft === 0 ? 'All comment XP earned for today.' : `${commentsLeft} rewarded comment${commentsLeft === 1 ? '' : 's'} left today. Comment naturally anywhere in this subreddit.`}</p>
        </div>
      </section>

      <section className="stats-row">
        <div className="card stat"><span>Current streak</span><strong>{state.user.streak}</strong><small>days</small></div>
        <div className="card stat"><span>Best streak</span><strong>{state.user.longestStreak}</strong><small>days</small></div>
        <div className="card stat"><span>Daily XP left</span><strong>{(checkedIn ? 0 : state.checkInXpToday) + commentsLeft * state.config.commentXp}</strong><small>XP</small></div>
      </section>

      <section className="privacy-row">
        <p>SubRanks stores only the account ID, username and activity needed for XP.</p>
        <button className="text-button danger" onClick={onDeleteData}>Delete my SubRanks data</button>
      </section>
    </div>
  );
}

function LeaderboardTab({ state }: { state: AppStateResponse }) {
  return (
    <section className="card page-card">
      <div className="page-title"><span className="eyebrow">ALL TIME</span><h1>Community leaders</h1><p>Consistency wins. XP comes from daily check-ins and genuine participation.</p></div>
      {state.leaderboard.length === 0 ? (
        <div className="empty-state compact"><div className="empty-icon">↗</div><h2>No rankings yet</h2><p>Be the first person to check in.</p></div>
      ) : (
        <ol className="leaderboard-list">
          {state.leaderboard.map((entry) => (
            <li key={entry.username} className={entry.username === state.user?.username ? 'is-me' : ''}>
              <span className="position">{entry.rank <= 3 ? ['Ⅰ', 'Ⅱ', 'Ⅲ'][entry.rank - 1] : entry.rank}</span>
              <span className="avatar">{entry.username.slice(0, 1).toUpperCase()}</span>
              <span className="leader-name"><strong>u/{entry.username}</strong><small>Lv.{entry.level} · {entry.title}</small></span>
              <strong className="leader-xp">{entry.xp.toLocaleString()} XP</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RanksTab({ state }: { state: AppStateResponse }) {
  return (
    <section className="card page-card">
      <div className="page-title"><span className="eyebrow">THE JOURNEY</span><h1>{state.config.levels.length} community ranks</h1><p>Each community’s moderators choose the size, language and personality of its progression.</p></div>
      <div className="rank-list">
        {state.config.levels.map((level) => {
          const unlocked = (state.user?.xp ?? -1) >= level.requiredXp;
          const current = state.currentLevel?.level === level.level;
          return (
            <article key={level.level} className={`${unlocked ? 'unlocked' : ''} ${current ? 'current' : ''}`}>
              <span className="rank-node" style={{ backgroundColor: level.color }}>{unlocked ? '✓' : level.level}</span>
              <div><span className="rank-meta">LEVEL {level.level} · {level.requiredXp.toLocaleString()} XP</span><h2>{level.title}</h2><p>{level.description || 'No description yet.'}</p></div>
              {current && <span className="you-are-here">YOU ARE HERE</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function AdminTab({ state, onSaved }: { state: AppStateResponse; onSaved: (state: AppStateResponse) => void }) {
  const [draft, setDraft] = useState(() => cloneConfig(state.config));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const updateLevel = (index: number, patch: Partial<RankLevel>) => {
    setDraft((current) => ({ ...current, levels: current.levels.map((level, i) => i === index ? { ...level, ...patch } : level) }));
  };
  const addLevel = () => {
    setDraft((current) => {
      if (current.levels.length >= 18) return current;
      const previous = current.levels[current.levels.length - 1];
      const beforePrevious = current.levels[current.levels.length - 2];
      const step = Math.max(20, previous.requiredXp - (beforePrevious?.requiredXp ?? 0));
      return {
        ...current,
        levels: [...current.levels, {
          level: current.levels.length + 1,
          title: `Rank ${current.levels.length + 1}`,
          requiredXp: previous.requiredXp + step,
          description: '',
          color: RANK_COLORS[current.levels.length % RANK_COLORS.length],
        }],
      };
    });
  };
  const removeLevel = (index: number) => {
    setDraft((current) => {
      if (current.levels.length <= 2) return current;
      return {
        ...current,
        levels: current.levels
          .filter((_, i) => i !== index)
          .map((level, i) => ({ ...level, level: i + 1, requiredXp: i === 0 ? 0 : level.requiredXp })),
      };
    });
  };
  const applyTemplate = (key: string) => {
    const template = TEMPLATES[key];
    setDraft((current) => ({
      ...current,
      communityName: template.name,
      levels: template.levels.map((level, index) => ({
        level: index + 1,
        title: level.title,
        requiredXp: level.requiredXp,
        description: '',
        color: RANK_COLORS[index % RANK_COLORS.length],
      })),
    }));
    setNotice({ kind: 'success', text: `${template.name} titles loaded. Edit anything before saving.` });
  };
  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const payload: SaveConfigRequest = {
        communityName: draft.communityName,
        checkInXp: draft.checkInXp,
        commentXp: draft.commentXp,
        dailyCommentLimit: draft.dailyCommentLimit,
        flairSyncEnabled: draft.flairSyncEnabled,
        timezone: draft.timezone,
        levels: draft.levels,
      };
      const updated = await api<AppStateResponse>('/api/admin/config', { method: 'PUT', body: JSON.stringify(payload) });
      setDraft(cloneConfig(updated.config));
      onSaved(updated);
      setNotice({ kind: 'success', text: 'Rank system published. Existing players will see it immediately.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack admin-stack">
      <section className="card page-card">
        <div className="page-title"><span className="eyebrow">MODERATOR STUDIO</span><h1>Give your community its own ladder</h1><p>Choose 2–18 ranks, then write titles from your community’s lore, jokes and shared language.</p></div>
        <div className="template-row">
          <span>Quick start:</span>
          <button onClick={() => applyTemplate('wizard')}>Wizardry · 10 ranks</button>
          <button onClick={() => applyTemplate('software')}>Software Engineering · 8 ranks</button>
        </div>
        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
        <div className="settings-grid">
          <label className="field wide"><span>Community progression name</span><input maxLength={40} value={draft.communityName} onChange={(event) => setDraft({ ...draft, communityName: event.target.value })} /></label>
          <label className="field wide"><span>Daily timezone</span><input value={draft.timezone} placeholder="UTC or America/Toronto" onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /></label>
          <NumberField label="Standard check-in XP (day 3+)" value={draft.checkInXp} min={0} max={100} onChange={(value) => setDraft({ ...draft, checkInXp: value })} />
          <NumberField label="XP per comment" value={draft.commentXp} min={0} max={100} onChange={(value) => setDraft({ ...draft, commentXp: value })} />
          <NumberField label="Rewarded comments per day" value={draft.dailyCommentLimit} min={0} max={10} onChange={(value) => setDraft({ ...draft, dailyCommentLimit: value })} />
          <label className="toggle-field"><input type="checkbox" checked={draft.flairSyncEnabled} onChange={(event) => setDraft({ ...draft, flairSyncEnabled: event.target.checked })} /><span><strong>Sync rank to Reddit user flair</strong><small>This overwrites the user’s flair in this subreddit when they earn XP.</small></span></label>
        </div>
      </section>

      <section className="card levels-editor">
        <div className="editor-header"><div><span className="eyebrow">{draft.levels.length} LEVELS</span><h2>Titles and thresholds</h2></div><span>Choose 2–18 levels · titles max 24 characters</span></div>
        <div className="level-edit-list">
          {draft.levels.map((level, index) => (
            <div className="level-edit-row" key={level.level}>
              <div className="edit-level-number" style={{ backgroundColor: level.color }}>{level.level}</div>
              <label className="field title-field"><span>Title</span><input maxLength={24} value={level.title} onChange={(event) => updateLevel(index, { title: event.target.value })} /></label>
              <label className="field xp-field"><span>Required XP</span><input type="number" min={0} max={1_000_000} value={level.requiredXp} disabled={index === 0} onChange={(event) => updateLevel(index, { requiredXp: Number(event.target.value) })} /></label>
              <label className="field description-field"><span>Description</span><input maxLength={100} value={level.description} onChange={(event) => updateLevel(index, { description: event.target.value })} /></label>
              <label className="color-field" title="Rank color"><input type="color" value={level.color} onChange={(event) => updateLevel(index, { color: event.target.value.toUpperCase() })} /></label>
              <button className="remove-level-button" disabled={draft.levels.length <= 2} title="Remove rank" aria-label={`Remove level ${level.level}`} onClick={() => removeLevel(index)}>×</button>
            </div>
          ))}
        </div>
        <button className="add-level-button" disabled={draft.levels.length >= 18} onClick={addLevel}>+ Add rank</button>
        <div className="save-bar"><p>Changes affect the whole subreddit. Flair refreshes when each player next opens SubRanks or earns XP.</p><button className="primary-button" disabled={saving} onClick={save}>{saving ? 'Publishing…' : 'Publish rank system'}</button></div>
      </section>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<AppStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [joining, setJoining] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    setNotice(null);
    try {
      const response = await api<AppStateResponse>('/api/state');
      setState(response);
      if (response.flairWarning) setNotice({ kind: 'error', text: response.flairWarning });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load SubRanks.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const join = async () => {
    setJoining(true);
    setNotice(null);
    try {
      const response = await api<AppStateResponse>('/api/join', { method: 'POST' });
      setState(response);
      setNotice(response.flairWarning
        ? { kind: 'error', text: response.flairWarning }
        : { kind: 'success', text: `Welcome to the ranks — ${response.currentLevel?.title ?? 'first rank'} unlocked.` });
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'Could not join this community.' });
    } finally {
      setJoining(false);
    }
  };

  const checkIn = async () => {
    setCheckingIn(true);
    setNotice(null);
    try {
      const response = await api<CheckInResponse>('/api/check-in', { method: 'POST' });
      setState(response);
      setNotice({
        kind: 'success',
        text: response.alreadyCheckedIn
          ? 'You already checked in today.'
          : response.leveledUp
            ? `+${response.awardedXp} XP — new rank unlocked: ${response.currentLevel?.title}!`
            : `+${response.awardedXp} XP. Streak secured.`,
      });
      if (response.flairWarning) setTimeout(() => setNotice({ kind: 'error', text: response.flairWarning! }), 1800);
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'Check-in failed.' });
    } finally {
      setCheckingIn(false);
    }
  };

  const deleteData = async () => {
    if (!window.confirm('Delete your SubRanks enrollment, XP, streak, leaderboard entry and matching synchronized flair? This cannot be undone and will not leave the subreddit.')) return;
    try {
      const response = await api<DeleteDataResponse>('/api/me', { method: 'DELETE' });
      setState(response);
      setNotice(response.flairWarning
        ? { kind: 'error', text: response.flairWarning }
        : { kind: 'success', text: 'Your SubRanks data has been deleted.' });
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'Could not delete data.' });
    }
  };

  const content = useMemo(() => {
    if (!state) return null;
    if (tab === 'leaderboard') return <LeaderboardTab state={state} />;
    if (tab === 'ranks') return <RanksTab state={state} />;
    if (tab === 'admin' && state.isModerator) return <AdminTab state={state} onSaved={setState} />;
    return <HomeTab state={state} joining={joining} checkingIn={checkingIn} onJoin={join} onCheckIn={checkIn} onDeleteData={deleteData} />;
  }, [state, tab, joining, checkingIn]);

  if (loading) return <LoadingScreen />;
  if (error || !state) return <ErrorScreen message={error || 'Unknown error.'} retry={() => void load()} />;

  return (
    <div className="app-shell">
      <AppHeader state={state} tab={tab} setTab={setTab} />
      {notice && <div className={`floating-notice ${notice.kind}`} role="status"><span>{notice.kind === 'success' ? '✓' : '!'}</span>{notice.text}<button aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}
      <main className="content">{content}</main>
      <footer>Built for this community · Daily activity resets in {state.config.timezone}</footer>
    </div>
  );
}
