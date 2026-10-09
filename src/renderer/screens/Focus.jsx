import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import AppIcon from '../components/AppIcon';
import Modal from '../components/Modal';
import './Focus.css';

const PRESETS = [
    { label: '25 min', mins: 25 },
    { label: '50 min', mins: 50 },
    { label: '90 min', mins: 90 },
];
const CUSTOM_MAX = 180;

function fmtTime(sec) {
    const m = Math.floor((sec || 0) / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
}

function fmtClock(s) {
    const sec = Math.max(0, Math.round(s));
    const m = Math.floor(sec / 60), r = sec % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

function isDeskly(name = '') {
    const v = String(name).trim().toLowerCase();
    return v === 'deskly' || v === 'deskly.exe' || v.includes('deskly');
}

export default function Focus({ stats }) {
    const { t } = useTranslation();
    // Config
    const [durMin,   setDurMin]   = useState(25);
    const [strict,   setStrict]   = useState(true);
    const [pomoOn,   setPomoOn]   = useState(false);
    const [workMin,  setWorkMin]  = useState(25);
    const [breakMin, setBreakMin] = useState(5);
    const [lbMin,    setLbMin]    = useState(15);
    const [apps,     setApps]     = useState([]);
    const [cats,     setCats]     = useState([]);
    const [picker,   setPicker]   = useState(false);
    const [allApps,  setAllApps]  = useState([]);
    const [allCats,  setAllCats]  = useState([]);
    const [search,   setSearch]   = useState('');

    // Session
    const [active,     setActive]     = useState(false);
    const [phase,      setPhase]      = useState('focus');
    const [left,       setLeft]       = useState(0);
    const [endsAt,     setEndsAt]     = useState(0);
    const [cycle,      setCycle]      = useState(1);
    const [endAsk,     setEndAsk]     = useState(false);
    const [sessionDur, setSessionDur] = useState(0);

    // Focus session stats — separate from the app-usage stats prop
    const [focusStats,  setFocusStats]  = useState(null);
    const [statsLoaded, setStatsLoaded] = useState(false);

    // Intro
    const [introSeen,  setIntroSeen]  = useState(false);
    const introInitRef = useRef(false);

    const [sessionError, setSessionError] = useState(null);
    const showError = (msg) => { setSessionError(msg); setTimeout(() => setSessionError(null), 4000); };
    // Guards against double-submit: a second click while an IPC round-trip is in
    // flight would otherwise spawn a duplicate focus session or end race.
    const startBusyRef = useRef(false);
    const endBusyRef   = useRef(false);
    const [starting, setStarting] = useState(false);

    const loadCfg = useCallback(async () => {
        try {
            const s = await window.electronAPI.getFocusSettings();
            if (s) {
                setDurMin(s.durationMin ?? 25);
                setStrict(s.strict ?? true);
                setPomoOn(s.pomodoro?.on ?? false);
                setWorkMin(s.pomodoro?.workMin ?? 25);
                setBreakMin(s.pomodoro?.breakMin ?? 5);
                setLbMin(s.pomodoro?.longBreakMin ?? 15);
                setApps(s.apps || []);
                setCats(s.categories || []);
            }
        } catch {}
    }, []);

    const loadState = useCallback(async () => {
        try {
            const [st, sx] = await Promise.all([
                window.electronAPI.getFocusState(),
                window.electronAPI.getFocusStats(),
            ]);
            setFocusStats(sx);
            if (st && st.active) {
                setActive(true);
                setPhase(st.phase);
                setEndsAt(st.endsAt);
                setCycle(st.cycle || 1);
                setSessionDur(st.durationSec || 0);
                setLeft(Math.max(0, Math.round((st.endsAt - Date.now()) / 1000)));
            } else {
                setActive(false);
            }
        } catch {
            // API not wired yet — statsLoaded still flips so intro can show
        } finally {
            setStatsLoaded(true);
        }
    }, []);

    const loadApps = useCallback(async () => {
        try {
            const [a, c] = await Promise.all([
                window.electronAPI.getFocusBlockableApps(),
                window.electronAPI.getFocusCategories(),
            ]);
            setAllApps(a || []);
            setAllCats(c || []);
        } catch {}
    }, []);

    useEffect(() => { loadCfg(); loadState(); loadApps(); }, [loadCfg, loadState, loadApps]);

    useEffect(() => {
        if (!active) return;
        const t = setInterval(() => {
            if (endsAt) setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
        }, 250);
        return () => clearInterval(t);
    }, [active, endsAt]);

    // Resync from the main process whenever the window regains focus/visibility.
    // Background tabs get their timers throttled and a system sleep freezes them
    // entirely, so on wake the locally-computed `left` can be stale and, worse,
    // `active` may still be true for a session that already ended while asleep.
    // The main process holds the authoritative clock — reconcile against it.
    useEffect(() => {
        if (!active) return;
        const resync = () => {
            if (document.visibilityState === 'visible') loadState();
        };
        document.addEventListener('visibilitychange', resync);
        window.addEventListener('focus', resync);
        return () => {
            document.removeEventListener('visibilitychange', resync);
            window.removeEventListener('focus', resync);
        };
    }, [active, loadState]);

    // When the local countdown crosses zero but we haven't yet heard from main,
    // proactively reconcile instead of sitting on a frozen 00:00. Fire once per
    // endsAt so a main process that keeps returning a past deadline can't spin us.
    const zeroReconciledRef = useRef(0);
    useEffect(() => {
        if (active && endsAt && left <= 0 && zeroReconciledRef.current !== endsAt) {
            zeroReconciledRef.current = endsAt;
            loadState();
        }
    }, [active, endsAt, left, loadState]);

    useEffect(() => {
        if (!window.electronAPI?.onFocusStateUpdate) return;
        return window.electronAPI.onFocusStateUpdate((st) => {
            if (!st || !st.active) { setActive(false); loadState(); return; }
            setActive(true);
            setPhase(st.phase);
            setEndsAt(st.endsAt);
            setCycle(st.cycle || 1);
            setSessionDur(st.durationSec || 0);
            setLeft(Math.max(0, Math.round((st.endsAt - Date.now()) / 1000)));
            loadState();
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    async function doStart() {
        if (startBusyRef.current) return;
        startBusyRef.current = true;
        setStarting(true);
        try {
            const r = await window.electronAPI.startFocus({
                durationMin: durMin,
                strict,
                pomodoro: pomoOn ? { on: true, workMin, breakMin, longBreakMin: lbMin } : { on: false },
                apps,
                categories: cats,
            });
            if (r && r.success && r.state) {
                setActive(true);
                setPhase(r.state.phase);
                setEndsAt(r.state.endsAt);
                setCycle(r.state.cycle || 1);
                setSessionDur(r.state.durationSec || durMin * 60);
                setLeft(Math.max(0, Math.round((r.state.endsAt - Date.now()) / 1000)));
                endAskRef.current = false;
                setEndAsk(false);
            }
        } catch { showError('Could not start focus session. Please try again.'); }
        finally { startBusyRef.current = false; setStarting(false); }
    }

    async function doEnd() {
        if (endBusyRef.current) return;
        endBusyRef.current = true;
        try {
            await window.electronAPI.endFocus(true);
            setActive(false);
            loadState();
        } catch { showError('Could not end session. Please try again.'); }
        finally { endBusyRef.current = false; }
    }

    const endAskRef = useRef(false);
    function askEnd()    { endAskRef.current = true;  setEndAsk(true); }
    function cancelEnd() { endAskRef.current = false; setEndAsk(false); }

    useEffect(() => {
        const t = setTimeout(() => {
            window.electronAPI.updateFocusSettings?.({
                durationMin: durMin, strict,
                pomodoro: { on: pomoOn, workMin, breakMin, longBreakMin: lbMin },
                apps, categories: cats,
            }).catch(() => {});
        }, 400);
        return () => clearTimeout(t);
    }, [durMin, strict, pomoOn, workMin, breakMin, lbMin, apps, cats]);

    // ── introApps: from usage data prop — always available, no IPC needed ──
    // Mirrors App Limits pattern: uses propsStats.apps directly
    const introApps = useMemo(() => {
        if (!stats?.apps?.length) return [];
        return [...stats.apps]
            .filter(a => !isDeskly(a.name) && (a.seconds || 0) > 0)
            .sort((a, b) => (b.seconds || 0) - (a.seconds || 0))
            .slice(0, 6);
    }, [stats?.apps]);

    // ── topBlockApps: for main-page chips — falls back to usage data ──
    const topBlockApps = useMemo(() => {
        const source = allApps.length > 0
            ? allApps
            : (stats?.apps || []).filter(a => !isDeskly(a.name));
        if (!source.length) return [];
        const usageByName = new Map((stats?.apps || []).map(a => [a.name, a.seconds || 0]));
        return [...source].sort((a, b) => (usageByName.get(b.name) || 0) - (usageByName.get(a.name) || 0));
    }, [allApps, stats?.apps]);

    const filteredApps = useMemo(() =>
        search
            ? topBlockApps.filter(a => (a.displayName || a.name).toLowerCase().includes(search.toLowerCase()))
            : topBlockApps,
    [topBlockApps, search]);

    const toggleApp = useCallback((name) => {
        setApps(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);
    }, []);

    const blockSummary = useMemo(() => {
        const names = [...apps];
        for (const cid of cats) {
            const cat = allCats.find(c => c.id === cid);
            if (cat) names.push(cat.name);
        }
        if (!names.length) return 'No apps selected';
        return names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
    }, [apps, cats, allCats]);

    // statsLoaded prevents flashing intro then hiding it once the IPC settles
    const isFirstTime = statsLoaded && !(focusStats?.recent?.length);
    const progressFrac = sessionDur > 0 ? Math.max(0, Math.min(1, 1 - left / sessionDur)) : 0;

    // Pre-select top 3 by usage on first visit (mirrors App Limits introInitRef pattern)
    useEffect(() => {
        if (introInitRef.current || !isFirstTime || introSeen || !introApps.length) return;
        introInitRef.current = true;
        setApps(introApps.slice(0, 3).map(a => a.name));
        setDurMin(25);
    }, [isFirstTime, introApps, introSeen]);

    // ── Picker modal ──────────────────────────────────────────────────────
    const pickerModal = picker && (
        <Modal onClose={() => setPicker(false)} maxWidth={440} title="Choose apps to block">
            <div className="dm-body fm-picker">
                <div className="fm-search">
                    <span className="material-symbols-rounded" aria-hidden="true">search</span>
                    <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps…" />
                </div>
                {allCats.length > 0 && (
                    <div className="fm-cat-chips">
                        {allCats.map(c => (
                            <button key={c.id} className={`fm-cat-chip${cats.includes(c.id) ? ' on' : ''}`}
                                onClick={() => setCats(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}>
                                <span className="fm-cat-swatch" style={{ background: c.color || '#607D8B' }} />
                                {c.name}
                            </button>
                        ))}
                    </div>
                )}
                <div className="fm-picker-list">
                    {filteredApps.map((a, i) => (
                        <button key={a.name} className={`fm-picker-row list-item-animated${apps.includes(a.name) ? ' on' : ''}`}
                            style={{ animationDelay: `${Math.min(i * 0.012, 0.1)}s` }}
                            onClick={() => toggleApp(a.name)}>
                            <AppIcon appName={a.name} size={28} />
                            <span className="fm-picker-name">{a.displayName || a.name}</span>
                            <span className={`fm-check${apps.includes(a.name) ? ' on' : ''}`}>
                                {apps.includes(a.name) && <span className="material-symbols-rounded" aria-hidden="true">check</span>}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    );

    // ── Right stats panel (main page) ─────────────────────────────────────
    const rightPanel = (
        <div className="fm-side">
            <div className="fm-side-today page-section">
                <span className="fm-side-today-ic material-symbols-rounded" aria-hidden="true">self_improvement</span>
                <div className="fm-side-today-val">{fmtTime(focusStats?.todaySec || 0)}</div>
                <div className="fm-side-today-lbl">focused today</div>
            </div>
            <div className="fm-side-streaks page-section">
                <div className="fm-streak-row">
                    <span className="material-symbols-rounded fm-streak-ic" aria-hidden="true">local_fire_department</span>
                    <div className="fm-streak-body">
                        <span className="fm-streak-val">{focusStats?.currentStreak || 0}<span className="fm-streak-unit"> days</span></span>
                        <span className="fm-streak-lbl">Current streak</span>
                    </div>
                </div>
                <div className="fm-streak-row">
                    <span className="material-symbols-rounded fm-streak-ic" aria-hidden="true">trophy</span>
                    <div className="fm-streak-body">
                        <span className="fm-streak-val">{focusStats?.longestStreak || 0}<span className="fm-streak-unit"> days</span></span>
                        <span className="fm-streak-lbl">Best streak</span>
                    </div>
                </div>
            </div>
            {focusStats?.recent?.length > 0 ? (
                <div className="fm-side-recent page-section">
                    <h3 className="fm-recent-title">Recent sessions</h3>
                    {focusStats.recent.slice(0, 5).map((s, i) => (
                        <div key={i} className="fm-recent-row">
                            <span className={`fm-recent-phase${s.completed ? ' done' : ' partial'}`}>
                                <span className="material-symbols-rounded" aria-hidden="true">{s.completed ? 'check_circle' : 'cancel'}</span>
                                {s.pomodoro ? 'Pomodoro' : 'Focus'}
                            </span>
                            <span className="fm-recent-time">{fmtTime(s.focusedSec)}</span>
                        </div>
                    ))}
                </div>
            ) : statsLoaded && (
                <div className="fm-side-empty page-section">
                    <span className="material-symbols-rounded" aria-hidden="true">timer</span>
                    <p>Your sessions will appear here.</p>
                </div>
            )}
        </div>
    );

    // ── INTRO — mirrors App Limits bulk-setup pattern ─────────────────────
    if (isFirstTime && !active && !introSeen) {
        const totalSec = introApps.reduce((s, a) => s + (a.seconds || 0), 0);
        const hasData  = totalSec > 0 && introApps.length > 0;

        return (
            <div className="fm-screen">
                <div className="page-header page-header-animated">
                    <h1 className="page-title">{t('focus.title')}</h1>
                    <p className="page-subtitle">{t('focus.subtitle')}</p>
                </div>

                {sessionError && (
                    <div role="alert" style={{ background: 'var(--error-container)', color: 'var(--error)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden="true">error</span>
                        {sessionError}
                    </div>
                )}

                <div className="fi-intro">
                    {/* Header row: title + tracked-today stat */}
                    <div className="fi-header">
                        <div className="fi-hero-text">
                            <h1 className="fi-title">
                                {hasData ? 'Block your top distractions' : 'Start your first focus session'}
                            </h1>
                            <p className="fi-sub">
                                {hasData
                                    ? `You've used ${introApps.length} app${introApps.length !== 1 ? 's' : ''} today — pick which ones to block while you focus.`
                                    : 'Choose apps to block and set a timer to stay on task.'}
                            </p>
                        </div>
                        {hasData && (
                            <div className="fi-hero-stat">
                                <span className="fi-hero-stat-val">{fmtTime(totalSec)}</span>
                                <span className="fi-hero-stat-lbl">tracked today</span>
                            </div>
                        )}
                    </div>

                    {/* App list */}
                    {introApps.length > 0 ? (
                        <div className="fi-list">
                            {introApps.map((a, i) => {
                                const on = apps.includes(a.name);
                                return (
                                    <div key={a.name}
                                        className={`fi-row list-item-animated${on ? ' fi-row-on' : ''}`}
                                        style={{ animationDelay: `${i * 0.05}s` }}>
                                        <AppIcon appName={a.name} size={34} />
                                        <div className="fi-row-info">
                                            <span className="fi-row-name">
                                                {(a.displayName || a.name).replace(/\.exe$/i, '')}
                                            </span>
                                            <span className="fi-row-usage">
                                                {a.seconds > 0 ? `${fmtTime(a.seconds)} today` : 'Not tracked yet'}
                                            </span>
                                        </div>
                                        <button
                                            className={`fi-row-toggle${on ? ' on' : ''}`}
                                            onClick={() => toggleApp(a.name)}
                                            aria-label={`${on ? 'Deselect' : 'Select'} ${a.name}`}>
                                            <span className="material-symbols-rounded" aria-hidden="true">
                                                {on ? 'check_circle' : 'radio_button_unchecked'}
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="fi-empty">
                            <span className="material-symbols-rounded" aria-hidden="true">computer</span>
                            <p>No app data yet. Use your device a bit and check back!</p>
                        </div>
                    )}

                    {/* Duration presets */}
                    <div className="fi-duration">
                        <span className="fi-section-label">Duration</span>
                        <div className="fm-presets">
                            {PRESETS.map(p => (
                                <button key={p.mins} className={`fm-preset${durMin === p.mins ? ' on' : ''}`}
                                    onClick={() => setDurMin(p.mins)}>{p.label}</button>
                            ))}
                        </div>
                    </div>

                    {/* CTA + skip */}
                    <div className="fi-actions">
                        <button className="fi-cta" onClick={doStart} disabled={starting}>
                            {apps.length === 0
                                ? `Start ${durMin}-min focus`
                                : `Start ${durMin}-min session`}
                            {apps.length > 0 && (
                                <span className="fi-cta-badge">
                                    blocking {apps.length} app{apps.length !== 1 ? 's' : ''}
                                </span>
                            )}
                            <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                        </button>
                        <button className="fi-skip" onClick={() => setIntroSeen(true)}>
                            Skip — show me all settings
                        </button>
                    </div>
                </div>

                {pickerModal}
            </div>
        );
    }

    // ── MAIN PAGE ─────────────────────────────────────────────────────────
    return (
        <div className="fm-screen">
            <div className="page-header page-header-animated">
                <h1 className="page-title">Focus</h1>
                <p className="page-subtitle">Block distractions and get in the zone</p>
            </div>

            {sessionError && (
                <div role="alert" style={{ background: 'var(--error-container)', color: 'var(--error)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden="true">error</span>
                    {sessionError}
                </div>
            )}

            <div className="fm-grid">
                {/* Left: config card or live timer */}
                <div className={`fm-panel page-section${active ? ' fm-panel-active' : ''}`}>
                    {active ? (
                        <div className="fm-active-body">
                            <div className="fm-live-phase">
                                {phase === 'focus' ? 'Focusing' : 'Break time'}
                                {pomoOn && <span className="fm-live-cycle">· cycle {cycle}</span>}
                            </div>
                            <div className="fm-live-timer">{fmtClock(left)}</div>
                            <div className="fm-live-progress-bar">
                                <div className="fm-live-progress-fill" style={{ width: `${progressFrac * 100}%` }} />
                            </div>
                            <div className="fm-live-sub">
                                {phase === 'focus'
                                    ? (pomoOn ? 'Work until the break' : "Stay on task — you've got this")
                                    : 'Relax — you earned it'}
                            </div>
                            {(apps.length > 0 || cats.length > 0) && (
                                <div className="fm-live-blocked">
                                    <span className="material-symbols-rounded" aria-hidden="true">lock</span>
                                    {blockSummary}
                                </div>
                            )}
                            <div className="fm-live-end">
                                {!endAsk ? (
                                    <button className="fm-btn fm-btn-ghost" onClick={askEnd}>
                                        End session early
                                    </button>
                                ) : (
                                    <div className="fm-end-confirm">
                                        <span>End this session?</span>
                                        <div className="fm-end-row">
                                            <button className="fm-btn fm-btn-ghost" onClick={cancelEnd}>Keep going</button>
                                            <button className="fm-btn fm-btn-danger" onClick={doEnd}>End now</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="fm-section">
                                <span className="fm-row-label">Duration</span>
                                <div className="fm-presets" role="radiogroup" aria-label="Duration">
                                    {PRESETS.map(p => (
                                        <button key={p.mins} className={`fm-preset${durMin === p.mins ? ' on' : ''}`}
                                            role="radio" aria-checked={durMin === p.mins}
                                            onClick={() => setDurMin(p.mins)}>{p.label}</button>
                                    ))}
                                </div>
                                <div className="fm-custom-wrap">
                                    <input className="fm-custom" type="number" min={1} max={CUSTOM_MAX}
                                        value={PRESETS.some(p => p.mins === durMin) ? '' : durMin}
                                        placeholder={t('focus.customDurationPlaceholder')}
                                        aria-label={t('focus.customDurationLabel')}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            if (raw === '') return;
                                            const v = parseInt(raw, 10);
                                            if (!isNaN(v)) setDurMin(Math.min(CUSTOM_MAX, Math.max(1, v)));
                                        }}
                                    />
                                    {!PRESETS.some(p => p.mins === durMin) && <span className="fm-custom-unit">min</span>}
                                </div>
                            </div>

                            <div className="fm-section">
                                <div className="fm-block-header">
                                    <span className="fm-row-label">Apps to block</span>
                                    {topBlockApps.length > 6 && (
                                        <button className="fm-block-more-link" onClick={() => { setPicker(true); setSearch(''); }}>
                                            See all
                                        </button>
                                    )}
                                </div>
                                {topBlockApps.length > 0 ? (
                                    <div className="fm-block-chips">
                                        {topBlockApps.slice(0, 6).map(a => {
                                            const on = apps.includes(a.name);
                                            return (
                                                <button key={a.name} className={`fm-block-chip${on ? ' on' : ''}`}
                                                    onClick={() => toggleApp(a.name)}>
                                                    <AppIcon appName={a.name} size={16} />
                                                    <span>{(a.displayName || a.name).replace(/\.exe$/i, '')}</span>
                                                    {on && <span className="material-symbols-rounded fm-chip-check" aria-hidden="true">check</span>}
                                                </button>
                                            );
                                        })}
                                        <button className="fm-block-chip fm-block-chip-add"
                                            onClick={() => { setPicker(true); setSearch(''); }}>
                                            <span className="material-symbols-rounded" aria-hidden="true">add</span>
                                            More
                                        </button>
                                    </div>
                                ) : (
                                    <button className="fm-block-btn" onClick={() => { setPicker(true); setSearch(''); }}>
                                        <span className="material-symbols-rounded" aria-hidden="true">block</span>
                                        Choose apps to block
                                    </button>
                                )}
                                {apps.length > 0 && (
                                    <div className="fm-block-summary">
                                        <span className="material-symbols-rounded" aria-hidden="true">lock</span>
                                        {blockSummary}
                                    </div>
                                )}
                            </div>

                            <div className="fm-section">
                                <span className="fm-row-label">Settings</span>
                                <div className="fm-settings-row">
                                    <div className="fm-setting-item">
                                        <div className="fm-setting-text">
                                            <span className="fm-toggle-label">Pomodoro</span>
                                            <span className="fm-toggle-desc">Work/break cycles</span>
                                        </div>
                                        <button
                                            role="switch"
                                            aria-checked={pomoOn}
                                            aria-label={t('focus.pomodoroMode')}
                                            className={`fm-switch${pomoOn ? ' on' : ''}`}
                                            onClick={() => setPomoOn(v => !v)}
                                        >
                                            <div className="fm-switch-knob" />
                                        </button>
                                    </div>
                                    <div className="fm-setting-item">
                                        <div className="fm-setting-text">
                                            <span className="fm-toggle-label">Strict mode</span>
                                            <span className="fm-toggle-desc">Force-close blocked apps</span>
                                        </div>
                                        <button
                                            role="switch"
                                            aria-checked={strict}
                                            aria-label="Strict mode"
                                            className={`fm-switch${strict ? ' on' : ''}`}
                                            onClick={() => setStrict(v => !v)}
                                        >
                                            <div className="fm-switch-knob" />
                                        </button>
                                    </div>
                                </div>
                                {pomoOn && (
                                    <div className="fm-pomo-cfg">
                                        {[
                                            { label: 'Work',       val: workMin,  set: setWorkMin,  min: 1, max: 120 },
                                            { label: 'Break',      val: breakMin, set: setBreakMin, min: 1, max: 60  },
                                            { label: 'Long break', val: lbMin,    set: setLbMin,    min: 1, max: 60  },
                                        ].map(f => (
                                            <div key={f.label} className="fm-field">
                                                <label>{f.label}</label>
                                                <div className="fm-field-row">
                                                    <input type="number" min={f.min} max={f.max} value={f.val}
                                                        onChange={e => f.set(Math.min(f.max, Math.max(f.min, +e.target.value || f.min)))} />
                                                    <span>min</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="fm-section fm-section-cta">
                                <button className="fm-cta-btn" onClick={doStart} disabled={starting}>
                                    <span className="material-symbols-rounded" aria-hidden="true">play_arrow</span>
                                    {apps.length > 0
                                        ? `Focus ${durMin} min — blocking ${apps.length} app${apps.length !== 1 ? 's' : ''}`
                                        : `Start ${durMin}-min focus`}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {rightPanel}
            </div>

            {pickerModal}
        </div>
    );
}
