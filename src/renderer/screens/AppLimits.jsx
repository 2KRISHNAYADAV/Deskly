import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAPI } from '../utils/safeApi';
import { formatMinutes } from '../utils/formatDuration';
import AppIcon from '../components/AppIcon';
import Modal from '../components/Modal';
import './AppLimits.css';

// Enforcement mode configurations
const MODES = {
    warning: {
        id: 'warning',
        label: 'Warning',
        icon: 'notifications',
        color: 'var(--warning)',
        description: 'Shows a reminder popup you can dismiss',
        available: true
    },
    minimize: {
        id: 'minimize',
        label: 'Minimize & Block',
        icon: 'pause_circle',
        color: 'var(--on-surface-muted)',
        description: 'Temporarily minimize distracting apps when a limit is reached',
        available: false
    },
    strict: {
        id: 'strict',
        label: 'Force Close',
        icon: 'block',
        color: 'var(--on-surface-muted)',
        description: 'Immediately close the app after the limit is reached',
        available: false
    }
};

const AVAILABLE_MODES = Object.values(MODES).filter((mode) => mode.available);

function isDesklyAppName(name = '') {
    const value = String(name).trim().toLowerCase();
    if (!value) return false;
    return (
        value === 'deskly' ||
        value === 'deskly.exe' ||
        value.includes(' deskly') ||
        value.includes('deskly ') ||
        value.includes('deskly.exe')
    );
}

function suggestLimitMinutes(usedMin) {
    if (!usedMin || usedMin < 10) return 30;
    return Math.max(30, Math.floor(usedMin / 30) * 30);
}

function presetsFor(usedMin) {
    const base = suggestLimitMinutes(usedMin);
    const all = [15, 30, 45, 60, 90, 120, 180, 240, 360];
    const idx = all.findIndex(v => v >= base);
    const start = Math.max(0, idx - 1);
    return all.slice(start, start + 4);
}

function fmtPresetLabel(m) {
    if (m < 60) return `${m}m`;
    if (m % 60 === 0) return `${m / 60}h`;
    return `${Math.floor(m / 60)}h${m % 60}`;
}

function AppLimits({ stats: propsStats }) {
    const { t } = useTranslation();
    const [limits, setLimits] = useState({});
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingLimit, setEditingLimit] = useState(null);
    // Key of the limit pending deletion — shows an inline confirmation row
    const [pendingDelete, setPendingDelete] = useState(null);
    const [actionError, setActionError] = useState(null);

    // Bulk-setup intro: one-time initialization flag + per-app selections Map
    const introInitRef = useRef(false);
    const [introSelections, setIntroSelections] = useState(() => new Map());

    // Memoized: propsStats.apps updates every 3s from live push; without memo this
    // filter() runs on every render even when the array reference hasn't changed.
    const apps = useMemo(
        () => (propsStats?.apps || []).filter(app => !isDesklyAppName(app?.name)),
        [propsStats?.apps]
    );

    // Load limits data (separate from stats)
    const loadLimits = useCallback(async () => {
        try {
            const limitsData = await SafeAPI.getAppLimits();
            setLimits(limitsData || {});
        } catch (err) {
            console.error('Failed to load limits:', err);
        }
    }, []);

    // Initial load - only limits, stats come from props
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            await loadLimits();
            setLoading(false);
        };
        init();

        // Listen for real-time limit triggered events (to refresh limit configs).
        // Capture the returned cleanup function so only this specific subscription
        // is removed on unmount (not all listeners on the channel).
        const removeLimitListener = SafeAPI.onLimitTriggered?.((data) => {
            loadLimits();
        });

        return () => {
            if (typeof removeLimitListener === 'function') removeLimitListener();
        };
    }, [loadLimits]);

    // Pre-fill introSelections with smart limit suggestions on first data load
    useEffect(() => {
        if (introInitRef.current || !apps.length || loading) return;
        introInitRef.current = true;
        const map = new Map();
        apps.slice(0, 5).forEach(app => {
            const usedMin = Math.floor((app.seconds || 0) / 60);
            map.set(app.name, { enabled: true, minutes: suggestLimitMinutes(usedMin) });
        });
        setIntroSelections(map);
    }, [apps, loading]);

    // Handlers
    const handleSave = async (appName, dailyMinutes, mode) => {
        try {
            await SafeAPI.setAppLimit(appName, dailyMinutes, mode);
            // Close only after the write succeeds — a failure keeps the modal open with
            // the user's values rather than silently discarding them.
            setShowAddModal(false);
            setEditingLimit(null);
            loadLimits(); // background sync — don't await
        } catch (err) {
            console.error('Failed to save limit:', err);
            setActionError('Could not save limit. Please try again.');
            setTimeout(() => setActionError(null), 4000);
        }
    };

    const handleRemove = async (appName) => {
        // First click sets pending state (shows inline confirmation).
        // Second click (confirmed) actually performs the deletion.
        if (pendingDelete !== appName) {
            setPendingDelete(appName);
            return;
        }
        setPendingDelete(null);
        try {
            await SafeAPI.removeAppLimit(appName);
            // Optimistic removal — remove from local state immediately so the card
            // disappears at the moment of confirmation, not after the IPC round-trip.
            setLimits(prev => {
                const next = { ...prev };
                delete next[appName];
                return next;
            });
            loadLimits(); // background sync to reconcile server state
        } catch (err) {
            console.error('Failed to remove limit:', err);
            setActionError('Could not remove limit. Please try again.');
            setTimeout(() => setActionError(null), 4000);
            loadLimits();
        }
    };

    const handleToggle = async (appName, enabled) => {
        // Optimistic update — flip the flag instantly so the toggle icon responds
        // at pointer-up with zero perceived latency.
        setLimits(prev => ({
            ...prev,
            [appName]: { ...prev[appName], enabled }
        }));
        try {
            await SafeAPI.toggleAppLimit(appName, enabled);
            loadLimits(); // background sync
        } catch (err) {
            console.error('Failed to toggle limit:', err);
            loadLimits(); // revert on failure
        }
    };

    const handleModeChange = async (appName, mode) => {
        try {
            await SafeAPI.setLimitMode(appName, mode);
            await loadLimits();
        } catch (err) {
            console.error('Failed to change mode:', err);
        }
    };

    const toggleIntroApp = useCallback((name) => {
        setIntroSelections(prev => {
            const next = new Map(prev);
            const cur = next.get(name);
            if (cur) next.set(name, { ...cur, enabled: !cur.enabled });
            return next;
        });
    }, []);

    const setIntroLimit = useCallback((name, minutes) => {
        setIntroSelections(prev => {
            const next = new Map(prev);
            const cur = next.get(name);
            if (cur) next.set(name, { ...cur, minutes });
            return next;
        });
    }, []);

    const handleBulkSave = useCallback(async () => {
        const selected = [...introSelections.entries()].filter(([, v]) => v.enabled);
        if (!selected.length) return;
        await Promise.all(selected.map(([name, { minutes }]) =>
            SafeAPI.setAppLimit(name, minutes, 'warning').catch(() => {})
        ));
        await loadLimits();
    }, [introSelections, loadLimits]);

    // Format time — input is minutes
    const formatTime = formatMinutes;

    // Get usage for an app - reads directly from propsStats
    const getAppUsage = (appName) => {
        const app = apps.find(a => a.name.toLowerCase() === appName.toLowerCase());
        return app ? Math.floor(app.seconds / 60) : 0;
    };

    // Calculate progress percentage
    const getProgress = (appName, limitMinutes) => {
        const used = getAppUsage(appName);
        return Math.min(100, Math.round((used / limitMinutes) * 100));
    };

    if (loading) {
        return (
            <div className="al-screen">
                <div className="loading-state-animated">
                    <div className="loading-spinner-smooth" />
                    <p className="loading-text-animated">Loading limits…</p>
                </div>
            </div>
        );
    }

    const limitEntries   = Object.entries(limits);
    const activeLimits   = limitEntries.filter(([, l]) => l.enabled).length;
    const overLimits     = limitEntries.filter(([key, l]) =>
        getAppUsage(key) >= (l.effectiveMinutes || l.dailyMinutes)
    ).length;
    const appsWithoutLimits = apps.filter(
        app => !limits[app.name.toLowerCase()]
    ).slice(0, 8);

    // ── Onboarding intro — bulk setup, shown before any limit is set ──
    if (limitEntries.length === 0) {
        const introApps = apps.slice(0, 5);
        const enabledCount = [...introSelections.values()].filter(v => v.enabled).length;
        const totalSecsToday = introApps.reduce((s, a) => s + (a.seconds || 0), 0);
        const hasData = introApps.some(a => (a.seconds || 0) > 0);

        return (
            <div className="al-screen al-bulk-intro">
                <div className="ali-header">
                    <div className="ali-hero-text">
                        <h1 className="ali-title">
                            {hasData ? 'Set limits on your top apps' : 'Start limiting your apps'}
                        </h1>
                        <p className="ali-sub">
                            {hasData
                                ? `You've used ${introApps.length} app${introApps.length !== 1 ? 's' : ''} today — pick your daily caps.`
                                : 'Add a daily time cap to any app and take back your focus.'}
                        </p>
                    </div>
                    {hasData && totalSecsToday > 0 && (
                        <div className="ali-hero-stat">
                            <span className="ali-hero-stat-value">{formatTime(Math.floor(totalSecsToday / 60))}</span>
                            <span className="ali-hero-stat-label">tracked today</span>
                        </div>
                    )}
                </div>

                {introApps.length > 0 ? (
                    <>
                        <div className="ali-list">
                            {introApps.map((app, i) => {
                                const usedMin = Math.floor((app.seconds || 0) / 60);
                                const sel = introSelections.get(app.name) || { enabled: true, minutes: suggestLimitMinutes(usedMin) };
                                const presets = presetsFor(usedMin);
                                return (
                                    <div
                                        key={app.name}
                                        className={`ali-row${sel.enabled ? '' : ' ali-row-off'}`}
                                        style={{ animationDelay: `${i * 0.05}s` }}
                                    >
                                        <AppIcon appName={app.name} size={34} />
                                        <div className="ali-row-info">
                                            <span className="ali-row-name" title={app.name.replace(/\.exe$/i, '')}>{app.name.replace(/\.exe$/i, '')}</span>
                                            <span className="ali-row-usage">
                                                {usedMin > 0 ? `${formatTime(usedMin)} today` : 'Not tracked yet'}
                                            </span>
                                        </div>
                                        <div className="ali-presets">
                                            {presets.map(p => (
                                                <button
                                                    key={p}
                                                    className={`ali-preset${sel.minutes === p && sel.enabled ? ' active' : ''}`}
                                                    onClick={() => setIntroLimit(app.name, p)}
                                                    disabled={!sel.enabled}
                                                >
                                                    {fmtPresetLabel(p)}
                                                </button>
                                            ))}
                                        </div>
                                        <button
                                            className={`ali-row-toggle${sel.enabled ? ' on' : ''}`}
                                            onClick={() => toggleIntroApp(app.name)}
                                            aria-label={`${sel.enabled ? 'Deselect' : 'Select'} ${app.name}`}
                                        >
                                            <span className="material-symbols-rounded" aria-hidden="true">
                                                {sel.enabled ? 'check_circle' : 'radio_button_unchecked'}
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="ali-actions">
                            <button
                                className="ali-cta"
                                onClick={handleBulkSave}
                                disabled={enabledCount === 0}
                            >
                                {enabledCount === 0
                                    ? 'Select apps above'
                                    : `Set ${enabledCount} Limit${enabledCount !== 1 ? 's' : ''}`}
                                {enabledCount > 0 && (
                                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                                )}
                            </button>
                            <button className="ali-link" onClick={() => setShowAddModal(true)}>
                                Add a different app
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="ali-empty-actions">
                        <button className="ali-cta" onClick={() => setShowAddModal(true)}>
                            Add your first limit
                            <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                        </button>
                    </div>
                )}

                {(showAddModal || editingLimit) && (
                    <LimitModal
                        limit={editingLimit}
                        apps={apps}
                        limits={limits}
                        onSave={handleSave}
                        onClose={() => { setShowAddModal(false); setEditingLimit(null); }}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="al-screen">

            {actionError && (
                <div role="alert" style={{ background: 'var(--error-container)', color: 'var(--error)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden="true">error</span>
                    {actionError}
                </div>
            )}

            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="al-header page-header page-header-animated">
                <div>
                    <h1 className="page-title">{t('limits.title')}</h1>
                    <p className="page-subtitle">{t('limits.subtitle')}</p>
                </div>
                <button className="al-btn-add" onClick={() => setShowAddModal(true)}>
                    <span className="material-symbols-rounded" aria-hidden="true">add</span>
                    {t('limits.addLimit')}
                </button>
            </div>

            {/* ── Stats row ─────────────────────────────────────────────── */}
            <div className="al-stats page-section">
                <div className="al-stat">
                    <span className="al-stat-ordinal">01</span>
                    <div className="al-stat-body">
                        <span className="al-stat-value">{limitEntries.length}</span>
                        <span className="al-stat-divider" aria-hidden="true" />
                        <span className="al-stat-label">Total Limits</span>
                    </div>
                </div>
                <div className="al-stat">
                    <span className="al-stat-ordinal">02</span>
                    <div className="al-stat-body">
                        <span className="al-stat-value">{activeLimits}</span>
                        <span className="al-stat-divider" aria-hidden="true" />
                        <span className="al-stat-label">Active</span>
                    </div>
                </div>
                <div className="al-stat">
                    <span className="al-stat-ordinal">03</span>
                    <div className="al-stat-body">
                        <span className="al-stat-value" style={{ color: overLimits > 0 ? '#ef4444' : undefined }}>
                            {overLimits}
                        </span>
                        <span className="al-stat-divider" aria-hidden="true" />
                        <span className="al-stat-label">Reached Today</span>
                    </div>
                </div>
                <div className="al-stat">
                    <span className="al-stat-ordinal">04</span>
                    <div className="al-stat-body">
                        <span className="al-stat-value">{apps.length}</span>
                        <span className="al-stat-divider" aria-hidden="true" />
                        <span className="al-stat-label">Apps Tracked</span>
                    </div>
                </div>
            </div>

            {/* ── Active Limits ─────────────────────────────────────────── */}
            <section className="al-section page-section">
                <div className="al-section-head">
                    <h2 className="al-section-title">
                        Active Limits
                        {limitEntries.length > 0 && (
                            <span className="al-count-badge">{limitEntries.length}</span>
                        )}
                    </h2>
                </div>

                {limitEntries.length === 0 ? (
                    <div className="empty-state-unified">
                        <span className="material-symbols-rounded empty-state-icon" aria-hidden="true">timer</span>
                        <span className="empty-state-title">{t('limits.noLimits')}</span>
                        <span className="empty-state-desc">{t('limits.noLimitsDesc')}</span>
                        <button className="al-btn-add" style={{ marginTop: 16 }} onClick={() => setShowAddModal(true)}>
                            <span className="material-symbols-rounded" aria-hidden="true">add</span>
                            Add Your First Limit
                        </button>
                    </div>
                ) : (
                    <div key={`limits-${limitEntries.length}`} className="al-list page-section">
                        {limitEntries.map(([key, limit], idx) => {
                            const used           = getAppUsage(key);
                            const effectiveLimit = limit.effectiveMinutes || limit.dailyMinutes;
                            const progress       = getProgress(key, effectiveLimit);
                            const mode           = MODES[limit.mode] || MODES.warning;
                            const isOverLimit    = used >= effectiveLimit;
                            const hasExtension   = (limit.addedMinutes || 0) > 0;

                            const barColor = isOverLimit
                                ? '#ef4444'
                                : progress > 85 ? '#f472b6'
                                : progress > 60 ? '#fbbf24'
                                : '#34d399';

                            return (
                                <div
                                    key={key}
                                    className={`al-list-row list-item-animated${!limit.enabled ? ' disabled' : ''}${isOverLimit ? ' over-limit' : ''}`}
                                    style={{ animationDelay: `${Math.min(idx * 0.025, 0.1)}s` }}
                                    onClick={() => { if (pendingDelete === key) setPendingDelete(null); }}
                                >
                                    <AppIcon appName={key} size={34} />

                                    <div className="al-row-info">
                                        <span className="al-row-name">{limit.displayName || key}</span>
                                        <div className="al-row-badges">
                                            <span className="al-mode-badge" style={{ background: `color-mix(in srgb, ${mode.color} 18%, transparent)`, color: mode.color }}>
                                                <span className="material-symbols-rounded" aria-hidden="true">{mode.icon}</span>
                                                {mode.label}
                                            </span>
                                            {hasExtension && (
                                                <span className="al-ext-badge">+{limit.addedMinutes}m</span>
                                            )}
                                            {isOverLimit && (
                                                <span className="al-over-badge">
                                                    <span className="material-symbols-rounded" aria-hidden="true">warning</span>
                                                    Over limit
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="al-row-progress">
                                        <div className="al-row-bar-wrap">
                                            <div className="al-row-bar-fill" style={{ width: `${Math.min(progress, 100)}%`, background: barColor }} />
                                        </div>
                                        <div className="al-row-time">
                                            <span style={{ color: barColor, fontWeight: 600 }}>{formatTime(used)}</span>
                                            <span className="al-row-sep">/</span>
                                            <span>{formatTime(effectiveLimit)}</span>
                                        </div>
                                    </div>

                                    <span className="al-row-pct" style={{ color: barColor }}>{progress}%</span>

                                    <button
                                        role="switch"
                                        aria-checked={limit.enabled}
                                        className={`al-toggle${limit.enabled ? ' on' : ''}`}
                                        onClick={e => { e.stopPropagation(); handleToggle(key, !limit.enabled); }}
                                        aria-label={`${limit.enabled ? 'Disable' : 'Enable'} limit for ${limit.displayName || key}`}
                                    >
                                        <span className="al-toggle-thumb" />
                                    </button>

                                    <div className="al-row-actions">
                                        <button className="al-icon-btn" onClick={e => { e.stopPropagation(); setEditingLimit({ key, ...limit }); }} aria-label={`Edit limit for ${limit.displayName || key}`}>
                                            <span className="material-symbols-rounded" aria-hidden="true">edit</span>
                                        </button>
                                        {pendingDelete === key ? (
                                            <>
                                                <button className="al-icon-btn confirm-delete" onClick={e => { e.stopPropagation(); handleRemove(key); }} aria-label={`Confirm delete limit for ${limit.displayName || key}`}>
                                                    <span className="material-symbols-rounded" aria-hidden="true">check</span>
                                                </button>
                                                <button className="al-icon-btn" onClick={e => { e.stopPropagation(); setPendingDelete(null); }} aria-label="Cancel delete">
                                                    <span className="material-symbols-rounded" aria-hidden="true">close</span>
                                                </button>
                                            </>
                                        ) : (
                                            <button className="al-icon-btn danger" onClick={e => { e.stopPropagation(); handleRemove(key); }} aria-label={`Remove limit for ${limit.displayName || key}`}>
                                                <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ── Suggestions ──────────────────────────────────────────── */}
            {appsWithoutLimits.length > 0 && (
                <section className="al-section page-section">
                    <div className="al-section-head">
                        <h2 className="al-section-title">Quick Add</h2>
                        <span className="al-section-sub">Apps without limits, sorted by today's usage</span>
                    </div>
                    <div className="al-suggestions-grid">
                        {appsWithoutLimits.map(app => (
                            <button
                                key={app.name}
                                className="al-suggestion"
                                onClick={() => {
                                    const usedMin = Math.floor((app.seconds || 0) / 60);
                                    setEditingLimit({ key: null, displayName: app.name, dailyMinutes: Math.max(30, Math.ceil(usedMin / 30) * 30), mode: 'warning' });
                                }}
                            >
                                <AppIcon appName={app.name} size={30} />
                                <div className="al-sugg-info">
                                    <span className="al-sugg-name">{app.name}</span>
                                    <span className="al-sugg-time">{formatTime(Math.floor((app.seconds || 0) / 60))} today</span>
                                </div>
                                <span className="al-sugg-add material-symbols-rounded" aria-hidden="true">add_circle</span>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {/* ── Modal ─────────────────────────────────────────────────── */}
            {(showAddModal || editingLimit) && (
                <LimitModal
                    limit={editingLimit}
                    apps={apps}
                    limits={limits}
                    onSave={handleSave}
                    onClose={() => { setShowAddModal(false); setEditingLimit(null); }}
                />
            )}
        </div>
    );
}

// Add/Edit Modal — rebuilt with the shared Modal component
function LimitModal({ limit, apps, limits, onSave, onClose }) {
    const { t } = useTranslation();
    const [step, setStep]           = useState(limit ? 2 : 1);
    const [selectedApp, setSelectedApp] = useState(limit?.key || limit?.displayName || null);
    const [search, setSearch]       = useState('');
    const [hours, setHours]         = useState(Math.floor((limit?.dailyMinutes || 60) / 60));
    const [mins, setMins]           = useState((limit?.dailyMinutes || 60) % 60);
    const [mode, setMode]           = useState(limit?.mode || 'warning');

    const isEditing = limit?.key !== null && limit?.key !== undefined;

    const available = apps.filter(app => {
        if (isDesklyAppName(app?.name)) return false;
        const has = limits && limits[app.name.toLowerCase()];
        if (isEditing && app.name.toLowerCase() === limit?.key?.toLowerCase()) return true;
        return !has;
    });

    const filtered = available
        .filter(app => app.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => b.seconds - a.seconds);

    const handleSave = () => {
        const total = hours * 60 + mins;
        if (selectedApp && total > 0) onSave(selectedApp, total, mode);
    };

    const fmtSec = (s) => {
        if (!s) return '0m';
        const m = Math.floor(s / 60);
        if (m >= 60) { const h = Math.floor(m / 60); const r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; }
        return `${m}m`;
    };

    const PRESETS = [
        { label: '30m', value: 30 },
        { label: '1h',  value: 60 },
        { label: '2h',  value: 120 },
        { label: '4h',  value: 240 },
    ];

    const setPreset = (v) => { setHours(Math.floor(v / 60)); setMins(v % 60); };
    const curTotal  = hours * 60 + mins;

    // Step 1: App selector
    if (step === 1) {
        return (
            <Modal title="Select App" onClose={onClose}>
                <div className="dm-body">
                    <div className="dm-search-wrap">
                        <span className="material-symbols-rounded dm-search-icon" aria-hidden="true">search</span>
                        <input
                            className="dm-search-input"
                            type="text"
                            placeholder={t('limits.searchPlaceholder')}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            autoFocus
                            onKeyDown={e => {
                                if (e.key === 'Enter' && filtered.length > 0) {
                                    setSelectedApp(filtered[0].name);
                                    setStep(2);
                                }
                            }}
                        />
                        {search && (
                            <button className="dm-search-clear" onClick={() => setSearch('')} data-no-active aria-label="Clear search">
                                <span className="material-symbols-rounded" aria-hidden="true">close</span>
                            </button>
                        )}
                    </div>

                    <div className="dm-app-list">
                        {filtered.length === 0 ? (
                            <div className="dm-list-empty">
                                <span className="material-symbols-rounded" aria-hidden="true">search_off</span>
                                <p>{search ? 'No apps match your search' : 'No apps available'}</p>
                            </div>
                        ) : filtered.map(app => (
                            <button
                                key={app.name}
                                className="dm-app-row"
                                onClick={() => { setSelectedApp(app.name); setStep(2); }}
                            >
                                <AppIcon appName={app.name} size={34} />
                                <div className="dm-app-info">
                                    <span className="dm-app-name">{app.name}</span>
                                    <span className="dm-app-meta">{fmtSec(app.seconds)} today</span>
                                </div>
                                <span className="material-symbols-rounded dm-app-chevron" aria-hidden="true">chevron_right</span>
                            </button>
                        ))}
                    </div>
                </div>
            </Modal>
        );
    }

    // Step 2: Configure
    return (
        <Modal
            title={isEditing ? 'Edit Limit' : 'Set Limit'}
            back={isEditing ? undefined : () => setStep(1)}
            onClose={onClose}
            footer={
                <>
                    <button className="dm-btn dm-ghost" onClick={onClose}>Cancel</button>
                    <button
                        className="dm-btn dm-primary"
                        onClick={handleSave}
                        disabled={!selectedApp || curTotal === 0}
                    >
                        {isEditing ? 'Save Changes' : 'Add Limit'}
                    </button>
                </>
            }
        >
            <div className="dm-body">
                {/* Selected app */}
                <div className="dm-selected-app">
                    <AppIcon appName={selectedApp} size={40} />
                    <span className="dm-selected-app-name">{selectedApp}</span>
                </div>

                {/* Daily limit */}
                <div className="dm-form-group">
                    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                    <legend className="dm-label">{t('limits.dailyLimit')}</legend>
                    <div className="dm-presets" role="radiogroup" aria-label={t('limits.dailyLimit')}>
                        {PRESETS.map(p => (
                            <button
                                key={p.label}
                                className={`dm-preset${curTotal === p.value ? ' dm-active' : ''}`}
                                role="radio"
                                aria-checked={curTotal === p.value}
                                onClick={() => setPreset(p.value)}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div className="dm-time-inputs">
                        <div className="dm-time-field">
                            <input
                                type="number" min="0" max="23"
                                value={hours}
                                aria-label="Hours"
                                onChange={e => setHours(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                                onKeyDown={e => e.key === 'Enter' && handleSave()}
                            />
                            <span>hours</span>
                        </div>
                        <div className="dm-time-field">
                            <input
                                type="number" min="0" max="59"
                                value={mins}
                                aria-label="Minutes"
                                onChange={e => setMins(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                                onKeyDown={e => e.key === 'Enter' && handleSave()}
                            />
                            <span>minutes</span>
                        </div>
                    </div>
                    </fieldset>
                </div>

                {/* Enforcement mode */}
                <div className="dm-form-group">
                    <label className="dm-label">When limit is reached</label>
                    <div className="dm-mode-options">
                        {AVAILABLE_MODES.map(m => (
                            <button
                                key={m.id}
                                className={`dm-mode-option${mode === m.id ? ' dm-active' : ''}`}
                                onClick={() => setMode(m.id)}
                            >
                                <span className="material-symbols-rounded dm-mode-icon" style={{ color: m.color }} aria-hidden="true">
                                    {m.icon}
                                </span>
                                <div className="dm-mode-text">
                                    <span className="dm-mode-label">{m.label}</span>
                                    <span className="dm-mode-desc">{m.description}</span>
                                </div>
                                {mode === m.id && (
                                    <span className="dm-mode-check material-symbols-rounded" style={{ color: m.color }} aria-hidden="true">
                                        check_circle
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

export default AppLimits;
