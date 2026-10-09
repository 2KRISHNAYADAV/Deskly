import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import AppIcon from '../components/AppIcon';
import Modal from '../components/Modal';
import { AppUsageSkeleton } from '../components/SkeletonScreens';
import Pagination from '../components/ui/Pagination';
import { SafeAPI } from '../utils/safeApi';
import { formatDuration } from '../utils/formatDuration';
import { sanitizeText } from '../utils/sanitizeText';
import './AppUsage.css';

const APPS_PER_PAGE = 20;

// Untrusted process display name → spoof-safe text (strips bidi/zero-width).
const appLabel = (app) => sanitizeText(app?.displayName || app?.name || '');

// ── Goal Picker Modal ─────────────────────────────────────────────
const QUICK_MINS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function GoalPickerModal({ app, existing, onSave, onRemove, onClose }) {
    const [type, setType]    = useState(existing?.type || 'minimum');
    const [mins, setMins]    = useState(existing?.targetMinutes || 30);
    const [raw,  setRaw]     = useState(String(existing?.targetMinutes || 30));
    const [busy, setBusy]    = useState(null); // 'save' | 'remove' | null
    const inputRef           = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleRawBlur = () => {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= 1) { setMins(Math.min(n, 480)); setRaw(String(Math.min(n, 480))); }
        else setRaw(String(mins));
    };

    const handleSave = async () => {
        if (mins < 1 || busy) return;      // block re-entry while a write is in flight
        setBusy('save');
        try { await onSave(type, mins); }
        catch { setBusy(null); }           // parent closes on success; re-enable on failure
    };

    const handleRemove = async () => {
        if (busy) return;
        setBusy('remove');
        try { await onRemove(); }
        catch { setBusy(null); }
    };

    const fmtMins = (m) => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}m` : ''}`.trim() : `${m}m`;

    return (
        <Modal
            title={existing ? 'Edit goal' : 'Set a usage goal'}
            onClose={onClose}
            footer={
                <>
                    {existing && (
                        <button className="dm-btn dm-danger" onClick={handleRemove} disabled={!!busy} style={{ marginRight: 'auto' }}>
                            <span className="material-symbols-rounded" aria-hidden="true">{busy === 'remove' ? 'progress_activity' : 'delete'}</span>
                            Remove goal
                        </button>
                    )}
                    <button className="dm-btn dm-ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
                    <button className="dm-btn dm-primary" onClick={handleSave} disabled={!!busy || mins < 1}>
                        <span className="material-symbols-rounded" aria-hidden="true">{busy === 'save' ? 'progress_activity' : 'check'}</span>
                        {existing ? 'Update goal' : 'Set goal'}
                    </button>
                </>
            }
        >
            <div className="dm-body">
                <div className="dm-selected-app">
                    <AppIcon appName={app.name} size={40} />
                    <span className="dm-selected-app-name">{appLabel(app)}</span>
                </div>

                <div className="dm-form-group">
                    <label className="dm-label">Goal type</label>
                    <div className="au-goal-type-row" role="radiogroup" aria-label="Goal type">
                        {[
                            { v: 'minimum', icon: 'arrow_upward', label: 'At least', desc: 'Spend minimum X minutes (positive habit)' },
                            { v: 'maximum', icon: 'arrow_downward', label: 'At most', desc: 'Cap usage at X minutes (soft advisory)' },
                        ].map(({ v, icon, label, desc }) => (
                            <button
                                key={v}
                                className={`au-goal-type-btn${type === v ? ' dm-active' : ''}`}
                                role="radio"
                                aria-checked={type === v}
                                onClick={() => setType(v)}
                                title={desc}
                            >
                                <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="dm-form-group">
                    <label className="dm-label">Target</label>
                    <div className="au-goal-mins-input-wrap">
                        <input
                            ref={inputRef}
                            className="au-goal-mins-input"
                            type="number"
                            min={1}
                            max={480}
                            value={raw}
                            onChange={e => setRaw(e.target.value)}
                            onBlur={handleRawBlur}
                            onKeyDown={e => e.key === 'Enter' && handleSave()}
                        />
                        <span className="au-goal-mins-unit">min</span>
                    </div>
                    <div className="au-goal-quick-pills" role="radiogroup" aria-label="Quick minute presets">
                        {QUICK_MINS.map(m => (
                            <button
                                key={m}
                                className={`au-goal-quick-pill${mins === m ? ' dm-active' : ''}`}
                                role="radio"
                                aria-checked={mins === m}
                                onClick={() => { setMins(m); setRaw(String(m)); }}
                            >
                                {m >= 60 ? `${m / 60}h` : `${m}m`}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="au-goal-preview">
                    <span className="material-symbols-rounded" aria-hidden="true">{type === 'minimum' ? 'trending_up' : 'trending_down'}</span>
                    {type === 'minimum'
                        ? `Use ${appLabel(app)} for at least ${fmtMins(mins)} daily`
                        : `Keep ${appLabel(app)} under ${fmtMins(mins)} daily`
                    }
                </div>
            </div>
        </Modal>
    );
}

// 4-color rank palette — blue (brand), then emerald, rose, amber, cycling
const RANK_COLORS = ['#1D4ED8', '#34d399', '#f472b6', '#fbbf24', '#a78bfa'];
const rankColor = (i) => RANK_COLORS[i % RANK_COLORS.length];

function AppUsage({ stats: propsStats }) {
    const { t } = useTranslation();
    const [allApps, setAllApps]         = useState(propsStats?.apps || []);
    const [totalSeconds, setTotalSeconds] = useState(propsStats?.totalSeconds || 0);
    const [search, setSearch]           = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const searchDebounceRef = useRef(null);
    const [sortBy, setSortBy]   = useState('time');
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'
    const [loading, setLoading] = useState(!propsStats?.apps?.length);
    const [loadError, setLoadError] = useState(null);
    const [page, setPage]       = useState(1);
    const [goals, setGoals]     = useState({});
    const [goalModal, setGoalModal] = useState(null); // { app } | null
    const initialLoadDone = useRef(false);
    const listTopRef      = useRef(null);
    const mountedRef      = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (propsStats?.apps?.length > 0) {
            setAllApps(propsStats.apps);
            setTotalSeconds(propsStats.totalSeconds || 0);
            setLoading(false);
        }
    }, [propsStats]);

    const loadData = useCallback(async () => {
        if (propsStats?.apps?.length > 0) return;
        setLoading(true);
        setLoadError(null);
        try {
            // allSettled so one failed read (e.g. goals) doesn't blank the app list.
            const [appsData, todayStats, goalsData] = await Promise.allSettled([
                SafeAPI.getAppUsage({ limit: 100 }),
                SafeAPI.getTodayStats(),
                SafeAPI.getAppGoals(),
            ]).then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null));
            if (!mountedRef.current) return;
            if (appsData === null && todayStats === null) {
                setLoadError('Could not load your app usage. Please try again.');
                return;
            }
            setAllApps(appsData || []);
            setTotalSeconds(todayStats?.totalSeconds || 0);
            setGoals(goalsData || {});
        } catch (e) {
            console.error('AppUsage load failed:', e);
            if (mountedRef.current) setLoadError('Could not load your app usage. Please try again.');
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [propsStats]);

    useEffect(() => {
        if (initialLoadDone.current) return;
        initialLoadDone.current = true;
        loadData();
    }, [loadData]);

    const apps = useMemo(() => {
        let result = [...allApps];
        if (debouncedSearch) {
            const q = debouncedSearch.toLowerCase();
            result = result.filter(a => a.name.toLowerCase().includes(q));
        }
        if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
        else result.sort((a, b) => b.seconds - a.seconds);
        return result;
    }, [allApps, debouncedSearch, sortBy]);

    const mostUsed = useMemo(() =>
        allApps.reduce((max, a) => (!max || a.seconds > max.seconds) ? a : max, null),
    [allApps]);

    const topApps = useMemo(() =>
        [...allApps].sort((a, b) => b.seconds - a.seconds).slice(0, 5),
    [allApps]);

    useEffect(() => { setPage(1); }, [debouncedSearch, sortBy]);

    const totalPages = Math.max(1, Math.ceil(apps.length / APPS_PER_PAGE));
    const safePage   = Math.min(page, totalPages);
    const pagedApps  = useMemo(
        () => apps.slice((safePage - 1) * APPS_PER_PAGE, safePage * APPS_PER_PAGE),
        [apps, safePage]
    );

    const handleGoalSave = useCallback(async (type, targetMinutes) => {
        if (!goalModal) return;
        // Let errors propagate so the modal can re-enable its buttons.
        await SafeAPI.setAppGoal(goalModal.name, targetMinutes, type, goalModal.displayName || goalModal.name);
        const updated = await SafeAPI.getAppGoals();
        if (!mountedRef.current) return;
        setGoals(updated || {});
        setGoalModal(null);
    }, [goalModal]);

    const handleGoalRemove = useCallback(async () => {
        if (!goalModal) return;
        await SafeAPI.removeAppGoal(goalModal.name);
        const updated = await SafeAPI.getAppGoals();
        if (!mountedRef.current) return;
        setGoals(updated || {});
        setGoalModal(null);
    }, [goalModal]);

    const goToPage = (p) => {
        setPage(p);
        requestAnimationFrame(() =>
            listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        );
    };

    const pct = (sec) => totalSeconds > 0 ? Math.round((sec / totalSeconds) * 100) : 0;
    // Use the top app by seconds (not apps[0] which depends on current sort order)
    const maxSec = [...allApps].reduce((m, a) => a.seconds > m ? a.seconds : m, 1);

    return (
        <div className="app-usage-screen">

            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="page-header page-header-animated">
                <h1 className="page-title">{t('appUsage.title')}</h1>
                <p className="page-subtitle">{t('appUsage.subtitle')}</p>
            </div>

            {loadError && !loading ? (
                <div role="alert" style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '14px', padding: '48px 24px', textAlign: 'center',
                    background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: '12px',
                }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 40, color: 'var(--on-surface-muted)' }} aria-hidden="true">cloud_off</span>
                    <p style={{ color: 'var(--on-surface)', fontSize: '15px', fontWeight: 600, margin: 0 }}>{loadError}</p>
                    <button className="refined-btn primary" onClick={() => { initialLoadDone.current = true; loadData(); }}>{t('common.retry')}</button>
                </div>
            ) : loading ? <AppUsageSkeleton /> : (
                <>
                    {/* ── Stats row ────────────────────────────────────── */}
                    <div className="au-stats page-section">
                        {/* Total Screen Time */}
                        <div className="au-stat au-stat--hero">
                            <span className="au-stat-ordinal">01</span>
                            <div className="au-stat-body">
                                <span className="au-stat-value au-stat-value--hero">{formatDuration(totalSeconds)}</span>
                                <span className="au-stat-divider" aria-hidden="true" />
                                <span className="au-stat-label">Total Screen Time<i className="au-stat-label-em"> · today</i></span>
                            </div>
                        </div>

                        {/* Apps Used Today */}
                        <div className="au-stat">
                            <span className="au-stat-ordinal">02</span>
                            <div className="au-stat-body">
                                <span className="au-stat-value">{allApps.length}</span>
                                <span className="au-stat-dots" aria-hidden="true">
                                    {Array.from({ length: Math.min(allApps.length, 7) }).map((_, i) => (
                                        <span key={i} className="au-stat-dot" style={{ animationDelay: `${i * 0.06}s` }} />
                                    ))}
                                </span>
                                <span className="au-stat-divider" aria-hidden="true" />
                                <span className="au-stat-label">Apps Used Today</span>
                            </div>
                        </div>

                        {/* Most Used */}
                        <div className="au-stat">
                            <span className="au-stat-ordinal">03</span>
                            <div className="au-stat-body">
                                <div className="au-stat-most-used-row">
                                    {mostUsed && <AppIcon appName={mostUsed.name} size={28} />}
                                    <span className="au-stat-value au-stat-value--app">
                                        {mostUsed ? (appLabel(mostUsed) || '—') : '—'}
                                    </span>
                                </div>
                                {mostUsed && (
                                    <span className="au-stat-subline">
                                        <span className="au-stat-subtime">{formatDuration(mostUsed.seconds)}</span>
                                        <span className="au-stat-submeta">of today</span>
                                    </span>
                                )}
                                <span className="au-stat-divider" aria-hidden="true" />
                                <span className="au-stat-label">Most Used</span>
                            </div>
                        </div>

                        {/* Top App Share — ring */}
                        <div className="au-stat au-stat--ring">
                            <span className="au-stat-ordinal">04</span>
                            <div className="au-stat-body">
                                <div className="au-stat-ring-wrap">
                                    <svg className="au-stat-ring" viewBox="0 0 36 36" aria-hidden="true">
                                        <circle className="au-stat-ring-track" cx="18" cy="18" r="15.915" />
                                        <circle
                                            className="au-stat-ring-fill"
                                            cx="18" cy="18" r="15.915"
                                            style={{ strokeDashoffset: 99.97 - (99.97 * (Math.min(Math.max(pct(mostUsed?.seconds || 0), 0), 100) / 100)) }}
                                        />
                                    </svg>
                                    <span className="au-stat-value au-stat-value--ring">{pct(mostUsed?.seconds || 0)}<span className="au-stat-pct-mark">%</span></span>
                                </div>
                                <span className="au-stat-divider" aria-hidden="true" />
                                <span className="au-stat-label">Top App Share</span>
                            </div>
                        </div>
                    </div>

                    {/* ── Top 5 chart ──────────────────────────────────── */}
                    {topApps.length > 0 && (
                        <div className="au-chart page-section">
                            <div className="au-chart-header">
                                <h2 className="au-section-title">Top Activity</h2>
                                <span className="au-section-sub">Today's top apps by time</span>
                            </div>
                            {topApps.map((app, i) => {
                                const barW = totalSeconds > 0 ? (app.seconds / totalSeconds) * 100 : 0;
                                const color = rankColor(i);
                                return (
                                    <div key={app.name} className="au-chart-row">
                                        <div className="au-chart-rank" style={{ color }}>{i + 1}</div>
                                        <AppIcon appName={app.name} size={26} />
                                        <span className="au-chart-name">
                                            {appLabel(app)}
                                        </span>
                                        <div className="au-chart-track">
                                            <div
                                                className="au-chart-fill"
                                                style={{
                                                    width: `${barW}%`,
                                                    background: color,
                                                    animationDelay: `${i * 0.08}s`,
                                                }}
                                            />
                                        </div>
                                        <span className="au-chart-time">{formatDuration(app.seconds)}</span>
                                        <span className="au-chart-pct" style={{ color }}>{pct(app.seconds)}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Controls row ─────────────────────────────────── */}
                    <div ref={listTopRef} className="au-controls page-section" style={{ scrollMarginTop: '12px' }}>
                        {/* Search */}
                        <div className="au-search-wrap">
                            <span className="material-symbols-rounded au-search-icon" aria-hidden="true">search</span>
                            <input
                                className="au-search"
                                type="text"
                                placeholder={t('appUsage.searchPlaceholder')}
                                value={search}
                                onChange={e => {
                                    const val = e.target.value;
                                    setSearch(val);
                                    clearTimeout(searchDebounceRef.current);
                                    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(val), 200);
                                }}
                                aria-label="Search apps"
                            />
                            {search && (
                                <button className="au-search-clear" onClick={() => { setSearch(''); setDebouncedSearch(''); }} aria-label="Clear search">
                                    <span className="material-symbols-rounded" aria-hidden="true">close</span>
                                </button>
                            )}
                        </div>

                        <div className="au-controls-right">
                            {/* Sort pills */}
                            <div className="au-sort-pills">
                                {[{ v: 'time', label: t('common.byTime') }, { v: 'name', label: t('common.alphabetical') }].map(({ v, label }) => (
                                    <button
                                        key={v}
                                        className={`au-sort-pill${sortBy === v ? ' active' : ''}`}
                                        onClick={() => setSortBy(v)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* View toggle */}
                            <div className="au-view-toggle">
                                {[['list', 'view_list'], ['grid', 'grid_view']].map(([mode, icon]) => (
                                    <button
                                        key={mode}
                                        className={`au-view-btn${viewMode === mode ? ' active' : ''}`}
                                        onClick={() => setViewMode(mode)}
                                        aria-label={mode === 'list' ? t('appUsage.switchToListView') : t('appUsage.switchToGridView')}
                                        aria-pressed={viewMode === mode}
                                    >
                                        <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ── Empty state ──────────────────────────────────── */}
                    {apps.length === 0 ? (
                        <div className="empty-state-unified">
                            <span className="material-symbols-rounded empty-state-icon" aria-hidden="true">apps</span>
                            <span className="empty-state-title">
                                {debouncedSearch ? t('appUsage.noSearchResults') : t('appUsage.noApps')}
                            </span>
                            <span className="empty-state-desc">
                                {debouncedSearch
                                    ? 'Try a different search term'
                                    : t('appUsage.noAppsDesc')}
                            </span>
                        </div>
                    ) : viewMode === 'list' ? (

                        /* ── LIST VIEW ───────────────────────────────── */
                        <div key={`list-${sortBy}-${debouncedSearch}`} className="au-list page-section">
                            {pagedApps.map((app, idx) => {
                                const globalIdx = (safePage - 1) * APPS_PER_PAGE + idx;
                                const color = rankColor(globalIdx);
                                const barW  = (app.seconds / maxSec) * 100;
                                const appPct = pct(app.seconds);
                                return (
                                    <div
                                        key={app.name}
                                        className="au-list-row list-item-animated"
                                        style={{ animationDelay: `${Math.min(idx * 0.010, 0.10)}s` }}
                                    >
                                        {/* Rank number */}
                                        <span className="au-list-rank" style={{ color }}>
                                            {globalIdx + 1}
                                        </span>
                                        {/* App icon */}
                                        <AppIcon appName={app.name} size={32} />
                                        {/* Name + category */}
                                        <div className="au-list-info">
                                            <span className="au-list-name">{appLabel(app)}</span>
                                            <span className="au-list-cat">
                                                {app.category
                                                    ? app.category.split('-')[0]
                                                    : 'General'}
                                            </span>
                                        </div>
                                        {/* Bar */}
                                        <div className="au-list-bar-wrap">
                                            <div
                                                className="au-list-bar-fill"
                                                style={{
                                                    width: `${barW}%`,
                                                    background: color,
                                                    animationDelay: `${Math.min(idx * 0.018, 0.28)}s`,
                                                }}
                                            />
                                        </div>
                                        {/* Time */}
                                        <span className="au-list-time">{formatDuration(app.seconds)}</span>
                                        {/* Percentage */}
                                        <span className="au-list-pct" style={{ color }}>
                                            {appPct > 0 ? `${appPct}%` : '<1%'}
                                        </span>
                                        {/* Goal badge / Set goal button */}
                                        {goals[app.name] ? (
                                            <button
                                                className={`au-goal-badge au-goal-badge--${goals[app.name].type}`}
                                                onClick={() => setGoalModal(app)}
                                                title={`Goal: ${goals[app.name].type === 'minimum' ? 'at least' : 'at most'} ${goals[app.name].targetMinutes}m`}
                                            >
                                                <span className="material-symbols-rounded" aria-hidden="true">
                                                    {goals[app.name].type === 'minimum' ? 'trending_up' : 'trending_down'}
                                                </span>
                                                {goals[app.name].targetMinutes}m
                                            </button>
                                        ) : (
                                            <button
                                                className="au-set-goal-btn"
                                                onClick={() => setGoalModal(app)}
                                                aria-label={`Set goal for ${app.displayName || app.name}`}
                                                title="Set a usage goal for this app"
                                            >
                                                <span className="material-symbols-rounded" aria-hidden="true">add_task</span>
                                                <span className="au-set-goal-label">Set goal</span>
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                    ) : (

                        /* ── GRID VIEW ───────────────────────────────── */
                        <div key={`grid-${sortBy}-${debouncedSearch}`} className="au-grid page-section">
                            {pagedApps.map((app, idx) => {
                                const globalIdx = (safePage - 1) * APPS_PER_PAGE + idx;
                                const color = rankColor(globalIdx);
                                const barW  = (app.seconds / maxSec) * 100;
                                return (
                                    <div
                                        key={app.name}
                                        className="au-grid-card list-item-animated"
                                        style={{ animationDelay: `${Math.min(idx * 0.012, 0.10)}s`, '--au-color': color }}
                                    >
                                        <div className="au-grid-card-accent" />
                                        <div className="au-grid-top">
                                            <AppIcon appName={app.name} size={38} />
                                            {globalIdx === 0 ? (
                                                <span className="au-grid-favorite-badge">
                                                    <span className="material-symbols-rounded" aria-hidden="true">bolt</span>
                                                    Most used
                                                </span>
                                            ) : (
                                                <span className="au-grid-rank" style={{ color }}>#{globalIdx + 1}</span>
                                            )}
                                        </div>
                                        <div className="au-grid-name">{appLabel(app)}</div>
                                        <div className="au-grid-cat">
                                            {app.category ? app.category.split('-')[0] : 'General'}
                                        </div>
                                        <div className="au-grid-time" style={{ color }}>{formatDuration(app.seconds)}</div>
                                        <div className="au-grid-bar-track">
                                            <div className="au-grid-bar-fill" style={{ width: `${barW}%`, background: color }} />
                                        </div>
                                        <div className="au-grid-pct">{pct(app.seconds)}% of today</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Pagination ───────────────────────────────────── */}
                    <Pagination page={safePage} totalPages={totalPages} onChange={goToPage} />
                </>
            )}

            {goalModal && (
                <GoalPickerModal
                    app={goalModal}
                    existing={goals[goalModal.name] || null}
                    onSave={handleGoalSave}
                    onRemove={handleGoalRemove}
                    onClose={() => setGoalModal(null)}
                />
            )}
        </div>
    );
}

export default AppUsage;
