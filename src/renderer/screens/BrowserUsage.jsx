import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import WebsiteIcon from '../components/WebsiteIcon';
import AppIcon from '../components/AppIcon';
import { BrowserSkeleton } from '../components/SkeletonScreens';
import Pagination from '../components/ui/Pagination';
import { SafeAPI } from '../utils/safeApi';
import { formatDuration } from '../utils/formatDuration';
import { sanitizeText } from '../utils/sanitizeText';
import './BrowserUsage.css';
import catGif from '../../../assets/Cat.gif';

const SITES_PER_PAGE = 15;

// Browser brand colors — used for pills and bars when drilled into one browser
const BROWSER_COLORS = {
    brave:   '#FB542B',
    chrome:  '#4285F4',
    edge:    '#0078D7',
    msedge:  '#0078D7',
    firefox: '#FF7139',
    safari:  '#006CFF',
    opera:   '#FF1B2D',
    vivaldi: '#EF3939',
};

// Our 4-color palette for "All Browsers" mode (rank-based)
const RANK_COLORS = ['#1D4ED8', '#34d399', '#f472b6', '#fbbf24', '#a78bfa'];
const rankColor = (i) => RANK_COLORS[i % RANK_COLORS.length];

function getBrowserColor(name) {
    const lower = (name || '').toLowerCase();
    for (const [key, color] of Object.entries(BROWSER_COLORS)) {
        if (lower.includes(key)) return color;
    }
    return '#1D4ED8';
}

// ── Browser Lock Gate ─────────────────────────────────────────────────────────
function BrowserLockScreen({ onUnlock }) {
    const { t } = useTranslation();
    const [password, setPassword]       = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError]             = useState('');
    const [loading, setLoading]         = useState(false);
    const [shake, setShake]             = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 200);
        return () => clearTimeout(timer);
    }, []);

    const handleUnlock = async (e) => {
        e.preventDefault();
        if (!password || loading) return;
        setLoading(true);
        setError('');
        const result = await SafeAPI.verifyBrowserLock(password);
        setLoading(false);
        if (result?.success) {
            onUnlock();
        } else {
            setError('Incorrect password. Please try again.');
            setShake(true);
            setTimeout(() => setShake(false), 500);
            setPassword('');
            inputRef.current?.focus();
        }
    };

    return (
        <div className="br-lock">
            <div className="br-lock-art page-enter">
                <img src={catGif} alt="Animated cat" className="br-lock-gif" />
            </div>

            <h2 className="br-lock-title page-enter" style={{ animationDelay: '0.05s' }}>
                {t('browser.locked')}
            </h2>
            <p className="br-lock-sub page-enter" style={{ animationDelay: '0.10s' }}>
                {t('browser.lockedDesc')}
            </p>

            <form
                onSubmit={handleUnlock}
                className={`br-lock-form${shake ? ' shake' : ' page-enter'}`}
                style={shake ? undefined : { animationDelay: '0.15s' }}
            >
                <div className="br-lock-input-wrap">
                    <input
                        ref={inputRef}
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
                        placeholder="Enter password"
                        autoComplete="current-password"
                        className={`br-lock-input${error ? ' error' : ''}`}
                    />
                    <button
                        type="button"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword(p => !p)}
                        className="br-lock-eye"
                    >
                        <span className="material-symbols-rounded" aria-hidden="true">
                            {showPassword ? 'visibility_off' : 'visibility'}
                        </span>
                    </button>
                </div>

                {error && (
                    <p className="br-lock-error" role="alert">
                        <span className="material-symbols-rounded" aria-hidden="true">error</span>
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={!password || loading}
                    className="br-lock-btn"
                >
                    <span className="material-symbols-rounded" aria-hidden="true">
                        {loading ? 'progress_activity' : 'lock_open'}
                    </span>
                    {loading ? 'Unlocking…' : 'Unlock'}
                </button>
            </form>

            <p className="br-lock-hint page-enter" style={{ animationDelay: '0.20s' }}>
                Forgot your password? Remove it in{' '}
                <span style={{ color: 'var(--on-surface-variant)' }}>Settings → Privacy</span>.
            </p>

            <style>{`
                @keyframes lock-shake {
                    0%   { transform: translateX(0);    }
                    15%  { transform: translateX(-7px); }
                    30%  { transform: translateX(7px);  }
                    45%  { transform: translateX(-5px); }
                    60%  { transform: translateX(5px);  }
                    75%  { transform: translateX(-3px); }
                    90%  { transform: translateX(3px);  }
                    100% { transform: translateX(0);    }
                }
                .br-lock-form.shake { animation: lock-shake 0.45s ease; }
            `}</style>
        </div>
    );
}

// ── Main ──────────────────────────────────────────────────────────────────────
function BrowserUsage() {
    const { t } = useTranslation();
    const [breakdown, setBreakdown] = useState({
        totalBrowserTime: 0,
        totalWebsiteTime: 0,
        browsers: [],
        allWebsites: [],
        browserCount: 0,
        websiteCount: 0,
        syncPercentage: 100,
    });
    const [loading, setLoading]             = useState(true);
    const [loadError, setLoadError]         = useState(null);
    const [selectedBrowser, setSelectedBrowser] = useState('all');
    const [sortBy, setSortBy]               = useState('time');
    const [search, setSearch]               = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const searchDebounceRef = useRef(null);
    const [page, setPage]                   = useState(1);
    const listTopRef = useRef(null);
    const hasLoadedRef = useRef(false);
    const mountedRef = useRef(true);
    const reqIdRef   = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Lock state
    const [lockEnabled, setLockEnabled]   = useState(false);
    const [lockChecked, setLockChecked]   = useState(false);
    const [sessionUnlocked, setSessionUnlocked] = useState(false);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const res = await SafeAPI.getBrowserLockStatus();
                if (mounted) setLockEnabled(res?.enabled ?? false);
            } finally {
                if (mounted) setLockChecked(true);
            }
        })();
        return () => { mounted = false; };
    }, []);

    // Guarantee the shape every render below relies on (breakdown.browsers.length,
    // .allWebsites.map, arithmetic on totals) survives a malformed/empty IPC reply.
    const normalizeBreakdown = (d) => {
        const safe = d && typeof d === 'object' ? d : {};
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        return {
            totalBrowserTime: num(safe.totalBrowserTime),
            totalWebsiteTime: num(safe.totalWebsiteTime),
            browsers:    Array.isArray(safe.browsers) ? safe.browsers : [],
            allWebsites: Array.isArray(safe.allWebsites) ? safe.allWebsites : [],
            browserCount: num(safe.browserCount),
            websiteCount: num(safe.websiteCount),
            syncPercentage: num(safe.syncPercentage),
        };
    };

    const loadData = useCallback(async ({ silent = false } = {}) => {
        const reqId = ++reqIdRef.current;
        if (!silent && !hasLoadedRef.current) setLoading(true);
        try {
            const data = await SafeAPI.getBrowserBreakdown();
            // Drop stale responses (a newer request superseded this one) and any
            // response that arrives after unmount.
            if (!mountedRef.current || reqId !== reqIdRef.current) return;
            setBreakdown(normalizeBreakdown(data));
            setLoadError(null);
            hasLoadedRef.current = true;
        } catch (e) {
            console.error('Failed to load browser breakdown:', e);
            if (!mountedRef.current || reqId !== reqIdRef.current) return;
            if (!silent) setLoadError('Could not load browser data. Please try again.');
        } finally {
            if (mountedRef.current && reqId === reqIdRef.current && (!silent || !hasLoadedRef.current)) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!lockChecked) return;
        if (lockEnabled && !sessionUnlocked) return;
        loadData();
        const id = setInterval(() => {
            if (document.visibilityState === 'visible') loadData({ silent: true });
        }, 30_000);
        return () => clearInterval(id);
    }, [lockChecked, lockEnabled, sessionUnlocked, loadData]);

    useEffect(() => {
        return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
    }, []);

    // Filtered + sorted site list
    const filteredSites = useMemo(() => {
        let sites = selectedBrowser === 'all'
            ? (breakdown.allWebsites || [])
            : (breakdown.browsers.find(b => b.processName === selectedBrowser)?.websites || []);

        sites = sites.filter(s => s && !s.isOther);

        if (debouncedSearch.trim()) {
            const q = debouncedSearch.toLowerCase();
            sites = sites.filter(s => String(s.name ?? '').toLowerCase().includes(q));
        }

        if (sortBy === 'name') return [...sites].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
        return [...sites].sort((a, b) => (Number(b.seconds) || 0) - (Number(a.seconds) || 0));
    }, [breakdown, selectedBrowser, debouncedSearch, sortBy]);

    const viewStats = useMemo(() => {
        if (selectedBrowser === 'all') {
            return { totalTime: breakdown.totalBrowserTime, siteCount: filteredSites.length, label: 'All Browsers' };
        }
        const browser = breakdown.browsers.find(b => b.processName === selectedBrowser);
        return { totalTime: browser?.totalSeconds || 0, siteCount: filteredSites.length, label: browser?.displayName || selectedBrowser };
    }, [breakdown, selectedBrowser, filteredSites]);

    // Bar color: brand color when drilled into one browser, palette when "all"
    const activeBrowserColor = useMemo(() => {
        if (selectedBrowser === 'all') return null;
        return getBrowserColor(selectedBrowser);
    }, [selectedBrowser]);

    const siteColor = (idx) => activeBrowserColor || rankColor(idx);

    useEffect(() => { setPage(1); }, [selectedBrowser, debouncedSearch, sortBy]);

    const totalPages   = Math.max(1, Math.ceil(filteredSites.length / SITES_PER_PAGE));
    const safePage     = Math.min(page, totalPages);
    const visibleSites = useMemo(
        () => filteredSites.slice((safePage - 1) * SITES_PER_PAGE, safePage * SITES_PER_PAGE),
        [filteredSites, safePage]
    );

    const goToPage = (p) => {
        setPage(p);
        requestAnimationFrame(() => listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    const pct = (sec) => viewStats.totalTime > 0 ? Math.round((sec / viewStats.totalTime) * 100) : 0;
    const maxSec = filteredSites[0]?.seconds || 1;

    // ── Guard screens ─────────────────────────────────────────────────────────
    if (!lockChecked) return (
        <div className="loading-state-animated" style={{ minHeight: 400 }}>
            <div className="loading-spinner-smooth" />
        </div>
    );

    if (lockEnabled && !sessionUnlocked) return (
        <div className="browser-usage-screen">
            <BrowserLockScreen onUnlock={() => setSessionUnlocked(true)} />
        </div>
    );

    if (loading) return <BrowserSkeleton />;

    return (
        <div className="browser-usage-screen">

            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="page-header page-header-animated">
                <h1 className="page-title">{t('browser.title')}</h1>
                <p className="page-subtitle">{t('browser.subtitle')}</p>
            </div>

            {loadError && (
                <div role="alert" style={{ background: 'var(--error-container)', color: 'var(--error)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden="true">error</span>
                    <span style={{ flex: 1 }}>{loadError}</span>
                    <button onClick={() => loadData()} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '4px', color: 'var(--error)', fontSize: '12px', padding: '3px 8px', cursor: 'pointer' }}>
                        Retry
                    </button>
                </div>
            )}

            {/* ── Stats ───────────────────────────────────────────────── */}
            <div key={`stats-${selectedBrowser}`} className="br-stats page-section">
                {/* 01 — Total Time (hero) */}
                <div className="br-stat br-stat--hero">
                    <span className="br-stat-ordinal">01</span>
                    <div className="br-stat-body">
                        <span className="br-stat-value br-stat-value--hero">{formatDuration(viewStats.totalTime)}</span>
                        <span className="br-stat-divider" aria-hidden="true" />
                        <span className="br-stat-label">{viewStats.label}<i className="br-stat-label-em"> · today</i></span>
                    </div>
                </div>

                {/* 02 — Browsers Used (count + brand dots) */}
                <div className="br-stat">
                    <span className="br-stat-ordinal">02</span>
                    <div className="br-stat-body">
                        <span className="br-stat-value">{breakdown.browserCount}</span>
                        <span className="br-stat-brand-dots" aria-hidden="true">
                            {(breakdown.browsers || []).slice(0, 6).map((b, i) => (
                                <span
                                    key={b.processName}
                                    className="br-stat-brand-dot"
                                    style={{
                                        background: getBrowserColor(b.processName),
                                        animationDelay: `${i * 0.06}s`,
                                    }}
                                    title={b.displayName}
                                />
                            ))}
                        </span>
                        <span className="br-stat-divider" aria-hidden="true" />
                        <span className="br-stat-label">Browser{breakdown.browserCount !== 1 ? 's' : ''} Used</span>
                    </div>
                </div>

                {/* 03 — Sites Visited (count + sub-meta) */}
                <div className="br-stat">
                    <span className="br-stat-ordinal">03</span>
                    <div className="br-stat-body">
                        <span className="br-stat-value br-stat-value--app">{viewStats.siteCount}</span>
                        {viewStats.totalTime > 0 && (
                            <span className="br-stat-subline">
                                <span className="br-stat-submeta">unique domains</span>
                            </span>
                        )}
                        <span className="br-stat-divider" aria-hidden="true" />
                        <span className="br-stat-label">Site{viewStats.siteCount !== 1 ? 's' : ''} Visited</span>
                    </div>
                </div>

                {/* 04 — Sites Tracked (ring) */}
                <div className="br-stat br-stat--ring">
                    <span className="br-stat-ordinal">04</span>
                    <div className="br-stat-body">
                        <div className="br-stat-ring-wrap">
                            <svg className="br-stat-ring" viewBox="0 0 36 36" aria-hidden="true">
                                <circle className="br-stat-ring-track" cx="18" cy="18" r="15.915" />
                                <circle
                                    className="br-stat-ring-fill"
                                    cx="18" cy="18" r="15.915"
                                    style={{
                                        strokeDashoffset:
                                            99.97 -
                                            99.97 *
                                                (breakdown.totalBrowserTime > 0
                                                    ? Math.min(
                                                          Math.max(
                                                              (breakdown.totalWebsiteTime / breakdown.totalBrowserTime) * 100,
                                                              0
                                                          ),
                                                          100
                                                      ) / 100
                                                    : 0),
                                    }}
                                />
                            </svg>
                            <span className="br-stat-value br-stat-value--ring">
                                {breakdown.totalBrowserTime > 0
                                    ? Math.round((breakdown.totalWebsiteTime / breakdown.totalBrowserTime) * 100)
                                    : 0}
                                <span className="br-stat-pct-mark">%</span>
                            </span>
                        </div>
                        <span className="br-stat-divider" aria-hidden="true" />
                        <span className="br-stat-label">Sites Tracked</span>
                    </div>
                </div>
            </div>

            {/* ── Browser selector ────────────────────────────────────── */}
            {breakdown.browsers.length > 0 && (() => {
                const tabIds = ['all', ...breakdown.browsers.map(b => b.processName)];
                const focusTab = (id) => document.getElementById(`br-tab-${id}`)?.focus();
                const onTabKeyDown = (e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
                    e.preventDefault();
                    const curIdx = tabIds.indexOf(selectedBrowser);
                    let nextIdx = curIdx;
                    if (e.key === 'ArrowRight') nextIdx = (curIdx + 1) % tabIds.length;
                    else if (e.key === 'ArrowLeft') nextIdx = (curIdx - 1 + tabIds.length) % tabIds.length;
                    else if (e.key === 'Home') nextIdx = 0;
                    else if (e.key === 'End') nextIdx = tabIds.length - 1;
                    const nextId = tabIds[nextIdx];
                    setSelectedBrowser(nextId);
                    focusTab(nextId);
                };
                return (
                    <div className="br-tabs page-section" role="tablist" aria-label="Browser selector">
                        <button
                            id="br-tab-all"
                            role="tab"
                            aria-selected={selectedBrowser === 'all'}
                            aria-controls="br-panel"
                            tabIndex={selectedBrowser === 'all' ? 0 : -1}
                            className={`br-tab${selectedBrowser === 'all' ? ' active' : ''}`}
                            onClick={() => setSelectedBrowser('all')}
                            onKeyDown={onTabKeyDown}
                        >
                            <span className="material-symbols-rounded br-tab-icon" aria-hidden="true" style={{ fontSize: 16 }}>
                                public
                            </span>
                            All
                            <span className="br-tab-time">{formatDuration(breakdown.totalBrowserTime)}</span>
                        </button>

                        {breakdown.browsers.map(browser => {
                            const bColor = getBrowserColor(browser.processName);
                            const isActive = selectedBrowser === browser.processName;
                            return (
                                <button
                                    key={browser.processName}
                                    id={`br-tab-${browser.processName}`}
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-controls="br-panel"
                                    tabIndex={isActive ? 0 : -1}
                                    className={`br-tab${isActive ? ' active' : ''}`}
                                    style={{ '--br-color': bColor }}
                                    onClick={() => setSelectedBrowser(browser.processName)}
                                    onKeyDown={onTabKeyDown}
                                >
                                    <span
                                        className="br-tab-dot"
                                        style={{ background: bColor }}
                                        aria-hidden="true"
                                    />
                                    <AppIcon appName={browser.processName} size={15} />
                                    {browser.displayName}
                                    <span className="br-tab-time">{browser.formatted}</span>
                                </button>
                            );
                        })}
                    </div>
                );
            })()}

            {/* ── Controls ────────────────────────────────────────────── */}
            <div ref={listTopRef} className="br-controls page-section" style={{ scrollMarginTop: '12px' }}>
                <div className="br-search-wrap">
                    <span className="material-symbols-rounded br-search-icon" aria-hidden="true">search</span>
                    <input
                        className="br-search"
                        type="text"
                        placeholder={t('browser.searchPlaceholder')}
                        value={search}
                        onChange={e => {
                            const val = e.target.value;
                            setSearch(val);
                            clearTimeout(searchDebounceRef.current);
                            searchDebounceRef.current = setTimeout(() => setDebouncedSearch(val), 200);
                        }}
                        aria-label="Search websites"
                    />
                    {search && (
                        <button className="br-search-clear" onClick={() => { setSearch(''); setDebouncedSearch(''); }} aria-label="Clear search">
                            <span className="material-symbols-rounded" aria-hidden="true">close</span>
                        </button>
                    )}
                </div>

                <div className="br-sort-pills">
                    {[{ v: 'time', label: t('common.byTime') }, { v: 'name', label: t('common.alphabetical') }].map(({ v, label }) => (
                        <button
                            key={v}
                            className={`br-sort-pill${sortBy === v ? ' active' : ''}`}
                            onClick={() => setSortBy(v)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Site list ───────────────────────────────────────────── */}
            {filteredSites.length === 0 ? (
                <div className="empty-state-unified">
                    <span className="material-symbols-rounded empty-state-icon" aria-hidden="true">
                        {search ? 'search_off' : 'language'}
                    </span>
                    <span className="empty-state-title">
                        {search ? t('browser.noSearchResults') : t('browser.noSites')}
                    </span>
                    <span className="empty-state-desc">
                        {search
                            ? `No results matching "${search}"`
                            : t('browser.noSitesDesc')}
                    </span>
                </div>
            ) : (
                <div
                    key={`${selectedBrowser}-${sortBy}-${debouncedSearch}`}
                    id="br-panel"
                    role="tabpanel"
                    aria-labelledby={`br-tab-${selectedBrowser}`}
                    className="br-list page-section"
                >
                    {visibleSites.map((site, idx) => {
                        const globalIdx = (safePage - 1) * SITES_PER_PAGE + idx;
                        const color  = siteColor(globalIdx);
                        const barW   = (site.seconds / maxSec) * 100;
                        const sitePct = pct(site.seconds);
                        return (
                            <div
                                key={`${site.id ?? site.name}-${idx}`}
                                className="br-list-row list-item-animated"
                                style={{ animationDelay: `${Math.min(idx * 0.010, 0.10)}s` }}
                            >
                                {/* Rank */}
                                <span className="br-list-rank" style={{ color }}>{globalIdx + 1}</span>

                                {/* Site icon */}
                                <WebsiteIcon siteName={site.name} size={30} />

                                {/* Name + meta */}
                                <div className="br-list-info">
                                    <span className={`br-list-name${site.isNewTab ? ' muted' : ''}`}>
                                        {sanitizeText(site.name)}
                                    </span>
                                    <div className="br-list-meta">
                                        {selectedBrowser === 'all' && site.browser && (
                                            <span className="br-list-meta-item">
                                                <AppIcon appName={site.browser} size={11} />
                                                {site.browser.replace('.exe', '')}
                                            </span>
                                        )}
                                        {site.isNewTab && (
                                            <span className="br-list-meta-item">
                                                <span className="material-symbols-rounded" style={{ fontSize: 13 }} aria-hidden="true">tab</span>
                                                New Tab
                                            </span>
                                        )}
                                        {site.isPrivate && (
                                            <span className="br-list-meta-item private">
                                                <span className="material-symbols-rounded" style={{ fontSize: 13 }} aria-hidden="true">visibility_off</span>
                                                Private
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Bar */}
                                <div className="br-list-bar-wrap">
                                    <div
                                        className="br-list-bar-fill"
                                        style={{
                                            width: `${barW}%`,
                                            background: color,
                                            animationDelay: `${Math.min(idx * 0.016, 0.25)}s`,
                                        }}
                                    />
                                </div>

                                {/* Time */}
                                <span className="br-list-time">{formatDuration(site.seconds)}</span>

                                {/* Percentage */}
                                <span className="br-list-pct" style={{ color }}>
                                    {sitePct > 0 ? `${sitePct}%` : '<1%'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Pagination ───────────────────────────────────────────── */}
            <Pagination page={safePage} totalPages={totalPages} onChange={goToPage} />
        </div>
    );
}

export default BrowserUsage;
