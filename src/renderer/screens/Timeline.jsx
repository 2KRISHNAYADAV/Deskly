import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { SafeAPI } from '../utils/safeApi';
import { formatDuration } from '../utils/formatDuration';
import { sanitizeText, sanitizeTitle } from '../utils/sanitizeText';
import AppIcon from '../components/AppIcon';
import { getDateLocale } from '../i18n';
import './Timeline.css';

// ─── Category helpers ─────────────────────────────────────────────────────────

const CAT_COLORS = {
    'Productivity':   '#22C55E',
    'Development':    '#22C55E',
    'Work':           '#22C55E',
    'Social Media':   '#EC4899',
    'Social':         '#EC4899',
    'Entertainment':  '#F59E0B',
    'Gaming':         '#A855F7',
    'Browsing':       '#38BDF8',
    'Education':      '#60A5FA',
    'Communication':  '#34D399',
    'Design':         '#F97316',
    'Finance':        '#FBBF24',
    'Health':         '#2DD4BF',
    'Utilities':      '#94A3B8',
    'Uncategorized':  '#64748B',
};

function normalizeCat(raw) {
    if (!raw) return 'Uncategorized';
    return raw.replace(/-\d{8,}$/, '').trim();
}

function catDisplay(raw) {
    if (!raw) return 'Uncategorized';
    return normalizeCat(raw)
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ') || 'Uncategorized';
}

function catColor(raw) {
    if (!raw) return '#64748B';
    if (CAT_COLORS[raw]) return CAT_COLORS[raw];
    const display = catDisplay(raw);
    if (CAT_COLORS[display]) return CAT_COLORS[display];
    const lower = display.toLowerCase();
    for (const [key, color] of Object.entries(CAT_COLORS)) {
        if (lower.includes(key.toLowerCase())) return color;
    }
    return '#64748B';
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

const DAY_START_H = 6;
const DAY_SPAN_S  = 18 * 3600; // 6am → midnight

// Parse an ISO timestamp to epoch seconds. Returns NaN for malformed input so
// callers can filter it out rather than propagating an Invalid Date.
function toEpoch(iso) {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t / 1000 : NaN;
}
function localDateStr(d) { return d.toLocaleDateString('en-CA'); }

function shiftDate(dateStr, delta) {
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return localDateStr(new Date()); // fall back to today
    d.setDate(d.getDate() + delta);
    return localDateStr(d);
}

function isToday(dateStr) { return dateStr === localDateStr(new Date()); }

function prettyDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return String(dateStr ?? '');
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (localDateStr(d) === localDateStr(today))     return 'Today';
    if (localDateStr(d) === localDateStr(yesterday)) return 'Yesterday';
    return d.toLocaleDateString(getDateLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(getDateLocale(), { hour: 'numeric', minute: '2-digit' });
}

function formatEpochTime(epochSec) {
    const ms = Number(epochSec) * 1000;
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleTimeString(getDateLocale(), { hour: 'numeric', minute: '2-digit' });
}

// ─── View-range auto-zoom ─────────────────────────────────────────────────────
// Keeps the blocks readable by zooming to the active data window.
// A 1-min session in an 18-hr view is sub-pixel; in a 45-min view it's ~2% = ~12px.

const PADDING_S  = 12 * 60;  // 12 min padding on each side
const MIN_SPAN_S = 45 * 60;  // minimum view window

function computeViewRange(sessions, dayStartEpoch) {
    if (!sessions.length) {
        return { viewStart: dayStartEpoch, viewSpan: DAY_SPAN_S };
    }

    const times = sessions
        .flatMap(s => [toEpoch(s.startTime), toEpoch(s.endTime)])
        .filter(Number.isFinite);
    // Every session had unparseable timestamps — fall back to the full day view
    // rather than deriving Infinity/NaN from an empty Math.min/max.
    if (!times.length) {
        return { viewStart: dayStartEpoch, viewSpan: DAY_SPAN_S };
    }
    const first = Math.min(...times);
    const last  = Math.max(...times);

    let vs = first - PADDING_S;
    let ve = last  + PADDING_S;

    if (ve - vs < MIN_SPAN_S) {
        const mid = (vs + ve) / 2;
        vs = mid - MIN_SPAN_S / 2;
        ve = mid + MIN_SPAN_S / 2;
    }

    vs = Math.floor(vs / 300) * 300; // snap to 5-min
    ve = Math.ceil(ve  / 300) * 300;
    vs = Math.max(vs, dayStartEpoch);
    ve = Math.min(ve, dayStartEpoch + DAY_SPAN_S);

    return { viewStart: vs, viewSpan: ve - vs };
}

function posFor(isoOrEpoch, viewStart, viewSpan) {
    const ep = typeof isoOrEpoch === 'number' ? isoOrEpoch : toEpoch(isoOrEpoch);
    if (!Number.isFinite(ep) || !Number.isFinite(viewSpan) || viewSpan <= 0) return 0;
    return Math.max(0, Math.min(1, (ep - viewStart) / viewSpan));
}

// ─── Hour ruler ───────────────────────────────────────────────────────────────

function tickInterval(spanS) {
    if (spanS <=  2700) return  5 * 60;
    if (spanS <=  5400) return 10 * 60;
    if (spanS <= 10800) return 15 * 60;
    if (spanS <= 21600) return 30 * 60;
    if (spanS <= 43200) return  1 * 3600;
    return 2 * 3600;
}

function fmtTick(epochSec) {
    const d = new Date(epochSec * 1000);
    const h = d.getHours();
    const m = d.getMinutes();
    if (m === 0) {
        if (h === 0)  return '12am';
        if (h < 12)  return `${h}am`;
        if (h === 12) return '12pm';
        return `${h - 12}pm`;
    }
    const base   = h === 0 ? '12' : h <= 12 ? `${h}` : `${h - 12}`;
    const suffix = h < 12 ? 'am' : 'pm';
    return `${base}:${String(m).padStart(2, '0')}`;
}

function HourRuler({ viewStart, viewSpan }) {
    const interval = tickInterval(viewSpan);
    const first    = Math.ceil(viewStart / interval) * interval;
    const ticks    = [];
    for (let t = first; t <= viewStart + viewSpan; t += interval) ticks.push(t);

    return (
        <div className="tl-ruler">
            {ticks.map(t => (
                <div key={t} className="tl-ruler-mark"
                    style={{ left: `${posFor(t, viewStart, viewSpan) * 100}%` }}>
                    <span className="tl-ruler-label">{fmtTick(t)}</span>
                </div>
            ))}
        </div>
    );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
// Rendered via createPortal into document.body so it ALWAYS escapes any
// ancestor CSS transform / filter / will-change stacking context. This is why
// `position:fixed` was landing in the wrong place — entrance animations on
// parent containers create a new containing block for fixed elements.
// Portal + cursor coords = the tooltip is always next to the cursor.

function SessionTooltip({ session, x, y }) {
    const ref  = useRef(null);
    const [pos, setPos] = useState(null);

    useEffect(() => {
        if (!ref.current) return;
        const w  = ref.current.offsetWidth  || 220;
        const h  = ref.current.offsetHeight || 130;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        let left = x - w / 2;
        let top  = y - h - 14;

        left = Math.max(10, Math.min(left, vw - w - 10));
        if (top < 10) top = y + 16;
        if (top + h > vh - 10) top = y - h - 14;

        setPos({ left, top });
    }, [x, y]);

    const content = (
        <div ref={ref} className="tl-tooltip"
            style={{
                position: 'fixed',
                zIndex:   99999,
                left:     pos?.left ?? -9999,
                top:      pos?.top  ?? -9999,
                opacity:  pos ? 1 : 0,
            }}>
            <div className="tl-tip-header">
                <AppIcon appName={session.appName} size={22} />
                <span className="tl-tip-name">{sanitizeText(session.displayName || session.appName)}</span>
            </div>
            <div className="tl-tip-row">
                <span className="material-symbols-rounded" aria-hidden="true">schedule</span>
                {formatTime(session.startTime)} – {formatTime(session.endTime)}
            </div>
            <div className="tl-tip-row">
                <span className="material-symbols-rounded" aria-hidden="true">timer</span>
                {formatDuration(session.duration)}
            </div>
            <div className="tl-tip-row">
                <span className="tl-tip-dot" style={{ background: catColor(session.category) }} />
                {catDisplay(session.category)}
            </div>
            {session.windowTitle && (
                <div className="tl-tip-subtitle">
                    {sanitizeTitle(session.windowTitle, 72)}
                </div>
            )}
        </div>
    );

    // Portal into body — bypasses every stacking context in the component tree
    return createPortal(content, document.body);
}

// ─── Gantt timeline ───────────────────────────────────────────────────────────
//
// Edge cases handled:
//  · Sub-minute sessions  → auto-zoom ensures min 45-min view, blocks stay ≥5px
//  · 15+ apps             → show top 10 by default, expand button for the rest
//  · Sessions near edges  → posFor() clamps 0–1, blocks appear at track edge
//  · No sessions today    → empty state
//  · Sessions over 4hr    → wide blocks, zoom covers the range naturally
//  · Single session       → MIN_SPAN_S=45min guarantees visible context
//  · Tomorrow / future    → same logic, likely empty state

const MAX_LANES_DEFAULT = 10;

function TimelineView({ sessions, dayStartEpoch }) {
    const [hover,    setHover]    = useState(null); // { session, x, y }
    const [expanded, setExpanded] = useState(false);

    const { viewStart, viewSpan } = useMemo(
        () => computeViewRange(sessions, dayStartEpoch),
        [sessions, dayStartEpoch]
    );

    const gridLines = useMemo(() => {
        const iv    = tickInterval(viewSpan);
        const first = Math.ceil(viewStart / iv) * iv;
        const lines = [];
        for (let t = first; t <= viewStart + viewSpan; t += iv) {
            lines.push(posFor(t, viewStart, viewSpan) * 100);
        }
        return lines;
    }, [viewStart, viewSpan]);

    const allLanes = useMemo(() => {
        const map = {};
        for (const s of sessions) {
            const k = s.displayName || s.appName || 'Unknown';
            if (!map[k]) map[k] = { name: k, appName: s.appName, sessions: [], total: 0 };
            map[k].sessions.push(s);
            map[k].total += s.duration;
        }
        return Object.values(map).sort((a, b) => b.total - a.total);
    }, [sessions]);

    const lanes       = expanded ? allLanes : allLanes.slice(0, MAX_LANES_DEFAULT);
    const hiddenCount = allLanes.length - MAX_LANES_DEFAULT;

    // Tooltip: cursor-position based (clientX/clientY from mouse events)
    const onEnter = useCallback((e, s) =>
        setHover({ session: s, x: e.clientX, y: e.clientY }), []);
    const onMove  = useCallback((e) =>
        setHover(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null), []);
    const onLeave = useCallback(() => setHover(null), []);

    const nowFrac = posFor(new Date().toISOString(), viewStart, viewSpan);
    const showNow = nowFrac > 0 && nowFrac < 1;

    const isFullDay = viewSpan >= DAY_SPAN_S * 0.95;
    const zoomLabel = isFullDay
        ? null
        : `${formatEpochTime(viewStart)} – ${formatEpochTime(viewStart + viewSpan)}`;

    if (!sessions.length) {
        return (
            <div className="tl-empty-state">
                <span className="material-symbols-rounded" aria-hidden="true">bedtime</span>
                <span>No activity recorded for this day</span>
            </div>
        );
    }

    const blockStyle = (s, bg) => {
        const l = posFor(s.startTime, viewStart, viewSpan);
        const r = posFor(s.endTime,   viewStart, viewSpan);
        return { left: `${l * 100}%`, width: `${Math.max(r - l, 0.003) * 100}%`, background: bg };
    };

    return (
        <div className="tl-gantt">
            {zoomLabel && (
                <div className="tl-zoom-pill">
                    <span className="material-symbols-rounded" aria-hidden="true">center_focus_weak</span>
                    {zoomLabel}
                </div>
            )}

            {/* Ruler */}
            <div className="tl-gantt-head">
                <div className="tl-gantt-lcol" />
                <div className="tl-gantt-rcol">
                    <HourRuler viewStart={viewStart} viewSpan={viewSpan} />
                </div>
            </div>

            {/* Overview bar */}
            <div className="tl-gantt-row">
                <div className="tl-gantt-lcol">
                    <span className="tl-lane-tag">Overview</span>
                </div>
                <div className="tl-overview-track">
                    {gridLines.map(pct => (
                        <div key={pct} className="tl-gridline" style={{ left: `${pct}%` }} />
                    ))}
                    {sessions.map((s, i) => (
                        <button key={s.id || i} className="tl-overview-block"
                            style={blockStyle(s, catColor(s.category))}
                            aria-label={`${s.displayName || s.appName || 'App'}, ${formatTime(s.startTime)} – ${formatTime(s.endTime)}, ${formatDuration(s.duration)}`}
                            onMouseEnter={e => onEnter(e, s)}
                            onMouseMove={onMove}
                            onMouseLeave={onLeave}
                        />
                    ))}
                    {showNow && <div className="tl-now-line" style={{ left: `${nowFrac * 100}%` }} />}
                </div>
            </div>

            <div className="tl-gantt-sep" />

            {/* Per-app lanes */}
            {lanes.map(lane => (
                <div key={lane.name} className="tl-gantt-row">
                    <div className="tl-gantt-lcol">
                        <AppIcon appName={lane.appName} size={16} />
                        <span className="tl-lane-name">{sanitizeText(lane.name)}</span>
                    </div>
                    <div className="tl-lane-track">
                        {gridLines.map(pct => (
                            <div key={pct} className="tl-gridline" style={{ left: `${pct}%` }} />
                        ))}
                        {lane.sessions.map((s, i) => (
                            <button key={s.id || i} className="tl-lane-block"
                                style={blockStyle(s, catColor(s.category))}
                                aria-label={`${s.displayName || s.appName || lane.name}, ${formatTime(s.startTime)} – ${formatTime(s.endTime)}, ${formatDuration(s.duration)}`}
                                onMouseEnter={e => onEnter(e, s)}
                                onMouseMove={onMove}
                                onMouseLeave={onLeave}
                            />
                        ))}
                    </div>
                </div>
            ))}

            {/* Show more / collapse */}
            {allLanes.length > MAX_LANES_DEFAULT && (
                <div className="tl-gantt-row">
                    <div className="tl-gantt-lcol" />
                    <button className="tl-show-more" onClick={() => setExpanded(e => !e)}>
                        <span className="material-symbols-rounded" aria-hidden="true">
                            {expanded ? 'expand_less' : 'expand_more'}
                        </span>
                        {expanded
                            ? 'Show less'
                            : `Show ${hiddenCount} more app${hiddenCount !== 1 ? 's' : ''}`}
                    </button>
                </div>
            )}

            {hover && (
                <SessionTooltip session={hover.session} x={hover.x} y={hover.y} />
            )}
        </div>
    );
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function SummaryRow({ totalSeconds, switchCount, sessions }) {
    const longest = sessions.reduce((b, s) => s.duration > (b?.duration ?? 0) ? s : b, null);
    const topRaw  = (() => {
        const t = {};
        for (const s of sessions) t[s.category] = (t[s.category] || 0) + s.duration;
        return Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    })();

    const chips = [
        { icon: 'timer',         value: formatDuration(totalSeconds) || '—', label: 'Screen time' },
        { icon: 'trending_flat', value: longest ? formatDuration(longest.duration) : '—', label: 'Longest session' },
        { icon: 'device_hub',    value: switchCount > 0 ? `${switchCount}` : '—', label: 'App switches' },
        { icon: 'label',         value: topRaw ? catDisplay(topRaw) : '—', label: 'Top category',
          color: topRaw ? catColor(topRaw) : undefined },
    ];

    return (
        <div className="tl-summary">
            {chips.map(({ icon, value, label, color }) => (
                <div className="tl-summary-chip" key={label}>
                    <span className="material-symbols-rounded tl-summary-icon"
                        style={color ? { color } : undefined} aria-hidden="true">{icon}</span>
                    <div className="tl-summary-text">
                        <span className="tl-summary-value">{value}</span>
                        <span className="tl-summary-label">{label}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Category breakdown ───────────────────────────────────────────────────────

function CategoryLegend({ sessions }) {
    const tally = {};
    for (const s of sessions) {
        const name  = catDisplay(s.category);
        const color = catColor(s.category);
        if (!tally[name]) tally[name] = { seconds: 0, color };
        tally[name].seconds += s.duration;
    }
    const total  = Object.values(tally).reduce((a, v) => a + v.seconds, 0);
    const sorted = Object.entries(tally).sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 8);
    if (!sorted.length) return null;

    return (
        <div className="tl-legend">
            {sorted.map(([name, { seconds, color }]) => {
                const pct = total > 0 ? (seconds / total) * 100 : 0;
                return (
                    <div key={name} className="tl-legend-item">
                        <div className="tl-legend-dot" style={{ background: color }} />
                        <span className="tl-legend-name">{name}</span>
                        <div className="tl-legend-bar-wrap">
                            <div className="tl-legend-bar"
                                style={{ width: `${Math.max(pct, 2)}%`, background: color + 'bb' }} />
                        </div>
                        <span className="tl-legend-pct">{Math.round(pct)}%</span>
                        <span className="tl-legend-time">{formatDuration(seconds)}</span>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function Timeline() {
    const { t } = useTranslation();
    const [date,    setDate]    = useState(localDateStr(new Date()));
    const [data,    setData]    = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const reqIdRef = useRef(0);

    const loadTimeline = useCallback((forDate) => {
        const reqId = ++reqIdRef.current;
        setLoading(true);
        setData(null);
        setLoadError(null);
        SafeAPI.getTimeline(forDate)
            .then(d => {
                if (reqId !== reqIdRef.current) return; // a newer date switch superseded this
                setData(d);
            })
            .catch(e => {
                if (reqId !== reqIdRef.current) return;
                console.error('Timeline load failed:', e);
                // Distinguish load failure from a genuinely empty day — otherwise a fetch
                // error renders as "No activity recorded", which is a lie.
                setLoadError('Could not load your timeline. Please try again.');
            })
            .finally(() => {
                if (reqId === reqIdRef.current) setLoading(false);
            });
    }, []);

    useEffect(() => { loadTimeline(date); }, [date, loadTimeline]);

    const goBack    = () => setDate(d => shiftDate(d, -1));
    const goForward = () => setDate(d => shiftDate(d, +1));

    const dayStartEpoch = (() => {
        const t = new Date(
            `${date}T${String(DAY_START_H).padStart(2, '0')}:00:00`
        ).getTime();
        // Guard against a corrupt `date` string yielding NaN, which would poison
        // every downstream position/zoom calculation.
        if (Number.isFinite(t)) return t / 1000;
        const fallback = new Date();
        fallback.setHours(DAY_START_H, 0, 0, 0);
        return fallback.getTime() / 1000;
    })();

    return (
        <div className="tl-screen">
            <div className="page-header page-header-animated">
                <div className="tl-header-row">
                    <div>
                        <h1 className="page-title">{t('timeline.title')}</h1>
                        <p className="page-subtitle">{t('timeline.subtitle')}</p>
                    </div>
                    <div className="tl-nav">
                        <button className="tl-nav-btn" onClick={goBack} aria-label={t('timeline.prevDay')}>
                            <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
                        </button>
                        {isToday(date) ? (
                            <div className="tl-date-pill">
                                <span className="tl-date-text">{prettyDate(date)}</span>
                            </div>
                        ) : (
                            <button className="tl-date-pill"
                                onClick={() => setDate(localDateStr(new Date()))}
                                aria-label={t('timeline.goToToday')}>
                                <span className="tl-date-text">{prettyDate(date)}</span>
                                <span className="tl-today-hint">{t('timeline.backToToday')}</span>
                            </button>
                        )}
                        <button className="tl-nav-btn" onClick={goForward}
                            disabled={isToday(date)} aria-label={t('timeline.nextDay')}>
                            <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="tl-loading page-section">
                    <div className="loading-spinner-smooth" />
                </div>
            ) : loadError ? (
                <div role="alert" className="page-section" style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '14px', padding: '48px 24px', textAlign: 'center',
                    background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: '12px',
                }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 40, color: 'var(--on-surface-muted)' }} aria-hidden="true">cloud_off</span>
                    <p style={{ color: 'var(--on-surface)', fontSize: '15px', fontWeight: 600, margin: 0 }}>{loadError}</p>
                    <button className="tl-nav-btn" style={{ width: 'auto', padding: '8px 20px' }} onClick={() => loadTimeline(date)}>{t('common.retry')}</button>
                </div>
            ) : (
                <>
                    {data && (
                        <div className="page-section">
                            <SummaryRow
                                totalSeconds={data.totalSeconds}
                                switchCount={data.switchCount}
                                sessions={data.sessions}
                            />
                        </div>
                    )}

                    <div className="page-section">
                        <TimelineView
                            sessions={data?.sessions || []}
                            dayStartEpoch={dayStartEpoch}
                        />
                    </div>

                    {data?.sessions?.length > 0 && (
                        <div className="page-section">
                            <div className="tl-section-label">Categories</div>
                            <CategoryLegend sessions={data.sessions} />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
