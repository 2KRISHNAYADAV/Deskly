import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration, formatHoursDecimal } from '../utils/formatDuration';
import AppIcon from '../components/AppIcon';
import { SafeAPI } from '../utils/safeApi';
import { hashString, CATEGORY_FALLBACK_PALETTE } from '../utils/colors';
import { getDateLocale } from '../i18n';
import './ReportsPage.css';

const PERIODS = [
    { id: 'week',  label: 'Week'     },
    { id: 'month', label: 'Month'    },
    { id: 'year',  label: 'Year'     },
    { id: 'all',   label: 'All Time' },
];

function catColor(name) {
    return CATEGORY_FALLBACK_PALETTE[hashString(name) % CATEGORY_FALLBACK_PALETTE.length];
}

const RANK_COLORS  = ['#1D4ED8', '#34d399', '#f472b6', '#fbbf24', '#a78bfa'];
const MEDAL_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];
const rankColor    = (i) => i < 3 ? MEDAL_COLORS[i] : RANK_COLORS[i % RANK_COLORS.length];

const PERIOD_MIN_DAYS = { week: 0, month: 14, year: 60, all: 0 };

// SVG coordinate system for area chart
const SVG_W  = 1000;
const SVG_H  = 190;
const PAD_X  = 20;
const PAD_Y  = 16;

// ── Score → colour ────────────────────────────────────────────────
function scoreColor(score) {
    if (score === 0) return 'var(--surface-container)';
    if (score < 30)  return '#7f1d1d44';
    if (score < 55)  return '#92400e66';
    if (score < 75)  return '#14532d66';
    return '#15803d99';
}

function scoreBorder(score) {
    if (score === 0) return 'transparent';
    if (score < 30)  return '#ef4444';
    if (score < 55)  return '#f59e0b';
    if (score < 75)  return '#22C55E';
    return '#16a34a';
}

// ── Streak Heatmap ────────────────────────────────────────────────
function StreakHeatmap() {
    const [calendar, setCalendar]   = useState([]);
    const [streakData, setStreakData] = useState(null);
    const [tooltip, setTooltip]     = useState(null); // { day, x, y }

    useEffect(() => {
        Promise.all([
            SafeAPI.getGoalsCalendar(30),
            SafeAPI.getStreak(),
        ]).then(([cal, streak]) => {
            setCalendar(Array.isArray(cal) ? cal : []);
            if (streak) setStreakData(streak);
        });
    }, []);

    if (!calendar.length) return null;

    const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Pad start so grid aligns to correct weekday
    const firstDate = new Date(calendar[0].date + 'T12:00:00');
    const startDow  = firstDate.getDay(); // 0=Sun
    const padded    = [...Array(startDow).fill(null), ...calendar];

    const totalRows = Math.ceil(padded.length / 7);

    return (
        <div className="rp-heatmap">
            <div className="rp-heatmap-header">
                <div>
                    <h3 className="rp-heatmap-title">30-Day Score Heatmap</h3>
                    <p className="rp-heatmap-sub">Daily wellness score (screen time goal + app goals)</p>
                </div>
                {streakData && (
                    <div className="rp-streak-pill">
                        <span className="material-symbols-rounded" aria-hidden="true">local_fire_department</span>
                        <span className="rp-streak-pill-num">{streakData.currentStreak}</span>
                        <span className="rp-streak-pill-label">day streak</span>
                    </div>
                )}
            </div>

            <div className="rp-heatmap-dow">
                {DAYS_OF_WEEK.map(d => <span key={d} className="rp-heatmap-dow-label">{d}</span>)}
            </div>

            <div className="rp-heatmap-grid" style={{ gridTemplateRows: `repeat(${totalRows}, 1fr)` }}>
                {padded.map((day, i) => {
                    if (!day) return <div key={`pad-${i}`} className="rp-heatmap-cell rp-heatmap-cell--empty" aria-hidden="true" />;
                    const isToday = day.date === new Date().toLocaleDateString('en-CA');
                    const dateLabel = new Date(day.date + 'T12:00:00').toLocaleDateString(getDateLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
                    const timeLabel = day.totalSeconds > 0 ? formatDuration(day.totalSeconds) + ' screen time' : 'No data';
                    return (
                        <div
                            key={day.date}
                            className={`rp-heatmap-cell${isToday ? ' rp-heatmap-cell--today' : ''}`}
                            style={{ background: scoreColor(day.score), borderColor: scoreBorder(day.score) }}
                            tabIndex="0"
                            role="gridcell"
                            aria-label={`${dateLabel}: score ${day.score}/100, ${timeLabel}`}
                            onMouseEnter={e => setTooltip({ day, x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setTooltip(null)}
                            onFocus={e => setTooltip({ day, x: e.target.getBoundingClientRect().left, y: e.target.getBoundingClientRect().top })}
                            onBlur={() => setTooltip(null)}
                        >
                            {day.score >= 75 && <span className="rp-heatmap-cell-star" aria-hidden="true">★</span>}
                        </div>
                    );
                })}
            </div>

            <div className="rp-heatmap-legend">
                {[
                    { score: 0,  label: 'No data' },
                    { score: 25, label: 'Struggling' },
                    { score: 50, label: 'Fair' },
                    { score: 70, label: 'Good' },
                    { score: 90, label: 'Excellent' },
                ].map(({ score, label }) => (
                    <div key={label} className="rp-heatmap-legend-item">
                        <div className="rp-heatmap-legend-swatch" style={{ background: scoreColor(score), borderColor: scoreBorder(score) }} />
                        <span>{label}</span>
                    </div>
                ))}
            </div>

            {tooltip && (
                <div className="rp-heatmap-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
                    <div className="rp-heatmap-tooltip-date">
                        {new Date(tooltip.day.date + 'T12:00:00').toLocaleDateString(getDateLocale(), { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="rp-heatmap-tooltip-score">Score: <strong>{tooltip.day.score}</strong>/100</div>
                    <div className="rp-heatmap-tooltip-time">{formatDuration(tooltip.day.totalSeconds) || 'No data'} screen time</div>
                </div>
            )}
        </div>
    );
}

function ReportsPage() {
    const { t } = useTranslation();
    const [period,         setPeriod]         = useState('week');
    const [loading,        setLoading]        = useState(true);
    const [transitioning,  setTransitioning]  = useState(false);
    const [data,           setData]           = useState(null);
    const [error,          setError]          = useState(null);
    const [hoveredBar,     setHoveredBar]     = useState(null);
    const [maxDaysTracked, setMaxDaysTracked] = useState(0);

    const requestIdRef  = useRef(0);
    const chartWrapRef  = useRef(null);

    const loadData = useRef(async (selectedPeriod) => {
        const reqId = ++requestIdRef.current;
        setError(null);
        if (!data) setLoading(true);
        else        setTransitioning(true);
        try {
            const stats = await window.electronAPI.getReportStats(selectedPeriod);
            if (reqId !== requestIdRef.current) return;
            setData(stats);
            setHoveredBar(null);
            const days = stats?.summary?.daysWithData || 0;
            setMaxDaysTracked(prev => Math.max(prev, days));
        } catch (err) {
            if (reqId !== requestIdRef.current) return;
            setError(err.message);
        } finally {
            if (reqId === requestIdRef.current) {
                setLoading(false);
                setTransitioning(false);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }).current;

    const isPeriodAvailable = (pid) => maxDaysTracked >= (PERIOD_MIN_DAYS[pid] ?? 0);

    useEffect(() => { loadData(period); }, [period, loadData]);

    const chartData = useMemo(() => {
        if (!data) return [];
        if (period === 'week')  return data.dailyTotals || [];
        if (period === 'month') return data.dailyTotals?.slice(-30) || [];
        return data.monthlyTotals || data.weeklyTotals || [];
    }, [data, period]);

    const maxChartValue = useMemo(() =>
        chartData.length > 0 ? Math.max(...chartData.map(d => d.seconds || 0), 1) : 1,
    [chartData]);

    // SVG area chart: compute plotted points
    const chartPoints = useMemo(() => {
        if (!chartData.length) return [];
        const n = chartData.length;
        return chartData.map((item, i) => ({
            x: n <= 1
                ? SVG_W / 2
                : PAD_X + (i / (n - 1)) * (SVG_W - 2 * PAD_X),
            y: PAD_Y + (1 - (item.seconds / maxChartValue)) * (SVG_H - 2 * PAD_Y),
            seconds: item.seconds,
            label: item.label || item.dayName || item.date?.slice(-2) || '',
        }));
    }, [chartData, maxChartValue]);

    // SVG smooth cubic bezier path + closed fill path
    const { pathD, fillD } = useMemo(() => {
        if (chartPoints.length === 0) return { pathD: '', fillD: '' };
        if (chartPoints.length === 1) {
            const pt = chartPoints[0];
            return {
                pathD: `M ${pt.x},${pt.y}`,
                fillD: `M ${pt.x - 4},${SVG_H} L ${pt.x},${pt.y} L ${pt.x + 4},${SVG_H} Z`,
            };
        }
        let d = '';
        chartPoints.forEach((pt, i) => {
            if (i === 0) {
                d = `M ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
            } else {
                const prev = chartPoints[i - 1];
                const cpx  = ((prev.x + pt.x) / 2).toFixed(1);
                d += ` C ${cpx},${prev.y.toFixed(1)} ${cpx},${pt.y.toFixed(1)} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
            }
        });
        const last  = chartPoints[chartPoints.length - 1];
        const first = chartPoints[0];
        return {
            pathD: d,
            fillD: `${d} L ${last.x.toFixed(1)},${SVG_H} L ${first.x.toFixed(1)},${SVG_H} Z`,
        };
    }, [chartPoints]);

    const todayDowIdx = new Date().getDay();

    // Hover: find nearest x-axis point
    const handleChartMove = (e) => {
        if (!chartWrapRef.current || !chartPoints.length) return;
        const rect  = chartWrapRef.current.getBoundingClientRect();
        const relX  = (e.clientX - rect.left) / rect.width;
        let closest = 0, minDist = Infinity;
        chartPoints.forEach((pt, i) => {
            const dist = Math.abs(relX - pt.x / SVG_W);
            if (dist < minDist) { minDist = dist; closest = i; }
        });
        setHoveredBar(closest);
    };

    if (loading && !data) return (
        <div className="rp">
            <div className="loading-state-animated" style={{ minHeight: 400 }}>
                <div className="loading-spinner-smooth" />
                <p className="loading-text-animated">Loading report…</p>
            </div>
        </div>
    );

    if (error && !data) return (
        <div className="rp">
            <div className="error-state-animated" style={{ minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <span className="material-symbols-rounded error-icon-animated" aria-hidden="true">error</span>
                <h3 style={{ color: 'var(--on-surface)', margin: 0 }}>Could not load report</h3>
                <p style={{ color: 'var(--on-surface-muted)', margin: 0 }}>{error}</p>
                <button onClick={() => loadData(period)} className="rp-retry">Retry</button>
            </div>
        </div>
    );

    const chartSub = period === 'week'  ? 'Last 7 days'
                   : period === 'month' ? 'This month'
                   : period === 'year'  ? 'Past 12 months'
                   : 'All time';

    const dotR = chartPoints.length > 18 ? 2.5 : 4;

    // Only show every Nth x-axis label on dense charts to prevent overflow
    const labelStep = chartPoints.length > 24 ? 4
                    : chartPoints.length > 15 ? 3
                    : chartPoints.length > 9  ? 2
                    : 1;

    return (
        <div className="rp" style={{ position: 'relative' }}>

            {transitioning && <div className="rp-transition-overlay" />}

            {/* ── Header + period selector ──────────────────────────── */}
            <div className="rp-header page-header page-header-animated">
                <div>
                    <h1 className="page-title">{t('reports.title')}</h1>
                    {data?.dateRange && (
                        <p className="page-subtitle">
                            {data.dateRange.startFormatted} — {data.dateRange.endFormatted}
                        </p>
                    )}
                </div>
                <div className="rp-period-group">
                    {PERIODS.map(p => {
                        const available = isPeriodAvailable(p.id);
                        return (
                            <button
                                key={p.id}
                                className={`rp-period-btn${period === p.id ? ' active' : ''}${!available ? ' locked' : ''}`}
                                onClick={() => available && setPeriod(p.id)}
                                disabled={!available}
                                title={!available ? `Need ${PERIOD_MIN_DAYS[p.id]} days of data to unlock ${p.label} view` : undefined}
                                aria-pressed={period === p.id}
                            >
                                {p.id === 'week' ? t('reports.week') : p.id === 'month' ? t('reports.month') : p.id === 'year' ? t('reports.year') : t('reports.allTime')}
                                {!available && (
                                    <span className="rp-period-lock material-symbols-rounded" aria-hidden="true">lock</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Stats — editorial ordinal style ──────────────────── */}
            <div key={`stats-${period}-${data?.dateRange?.startFormatted}`} className="rp-stats page-section">
                <div className="rp-stat">
                    <span className="rp-stat-ordinal">01</span>
                    <div className="rp-stat-body">
                        <span className="rp-stat-value">{formatHoursDecimal(data?.summary?.totalSeconds)}h</span>
                        <span className="rp-stat-divider" aria-hidden="true" />
                        <span className="rp-stat-label">Screen Time</span>
                    </div>
                </div>
                <div className="rp-stat">
                    <span className="rp-stat-ordinal">02</span>
                    <div className="rp-stat-body">
                        <span className="rp-stat-value">{formatDuration(data?.summary?.avgPerDay)}</span>
                        <span className="rp-stat-divider" aria-hidden="true" />
                        <span className="rp-stat-label">Daily Average</span>
                    </div>
                </div>
                <div className="rp-stat">
                    <span className="rp-stat-ordinal">03</span>
                    <div className="rp-stat-body">
                        <span className="rp-stat-value rp-stat-value--name">{data?.topApp?.displayName || '—'}</span>
                        {data?.topApp?.seconds > 0 && (
                            <span className="rp-stat-context">{formatDuration(data.topApp.seconds)}</span>
                        )}
                        <span className="rp-stat-divider" aria-hidden="true" />
                        <span className="rp-stat-label">Most Used App</span>
                    </div>
                </div>
                <div className="rp-stat">
                    <span className="rp-stat-ordinal">04</span>
                    <div className="rp-stat-body">
                        <span className="rp-stat-value rp-stat-value--name">{data?.insights?.bestDay?.dayName || '—'}</span>
                        {data?.insights?.bestDay?.seconds > 0 && (
                            <span className="rp-stat-context">{formatDuration(data.insights.bestDay.seconds)}</span>
                        )}
                        <span className="rp-stat-divider" aria-hidden="true" />
                        <span className="rp-stat-label">Peak Day</span>
                    </div>
                </div>
            </div>

            {/* ── Activity timeline — SVG area chart ───────────────── */}
            <section key={`chart-${period}-${chartData.length}`} className="rp-chart-card page-section">
                <div className="rp-card-head">
                    <h2 className="rp-section-title">Activity Timeline</h2>
                    <span className="rp-section-sub">{chartSub}</span>
                </div>

                {chartData.length > 0 ? (
                    <div
                        className="rp-chart-svg-wrap"
                        ref={chartWrapRef}
                        onMouseMove={handleChartMove}
                        onMouseLeave={() => setHoveredBar(null)}
                    >
                        {/* SVG area */}
                        <div className="rp-area-container">
                            <svg
                                key={`svg-${period}-${chartData.length}`}
                                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                                className="rp-area-svg"
                                preserveAspectRatio="none"
                                aria-hidden="true"
                            >
                                <defs>
                                    <linearGradient id="rp-area-grad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.42" />
                                        <stop offset="85%"  stopColor="var(--accent)" stopOpacity="0.04" />
                                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                                    </linearGradient>
                                </defs>

                                {/* Horizontal gridlines at 25 / 50 / 75 % */}
                                {[0.25, 0.5, 0.75].map(frac => {
                                    const gy = (PAD_Y + frac * (SVG_H - 2 * PAD_Y)).toFixed(1);
                                    return (
                                        <line key={frac}
                                            x1={0}     y1={gy}
                                            x2={SVG_W} y2={gy}
                                            stroke="rgba(255,255,255,0.05)"
                                            strokeWidth="1"
                                        />
                                    );
                                })}

                                {/* Hover hairline */}
                                {hoveredBar !== null && chartPoints[hoveredBar] && (
                                    <line
                                        x1={chartPoints[hoveredBar].x.toFixed(1)} y1={0}
                                        x2={chartPoints[hoveredBar].x.toFixed(1)} y2={SVG_H}
                                        stroke="rgba(255,255,255,0.18)"
                                        strokeWidth="1"
                                        strokeDasharray="4 4"
                                    />
                                )}

                                {/* Area fill */}
                                {fillD && <path d={fillD} fill="url(#rp-area-grad)" />}

                                {/* Line */}
                                {pathD && (
                                    <path
                                        d={pathD}
                                        fill="none"
                                        stroke="var(--accent)"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                )}

                                {/* Dots */}
                                {chartPoints.map((pt, i) => (
                                    <circle
                                        key={i}
                                        cx={pt.x.toFixed(1)}
                                        cy={pt.y.toFixed(1)}
                                        r={hoveredBar === i ? dotR + 1.5 : dotR}
                                        fill={hoveredBar === i
                                            ? '#ffffff'
                                            : pt.seconds > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.12)'}
                                        stroke={hoveredBar === i ? 'var(--accent)' : 'rgba(255,255,255,0.25)'}
                                        strokeWidth="1.5"
                                    />
                                ))}
                            </svg>

                            {/* Tooltip — positioned in SVG coordinate space */}
                            {hoveredBar !== null && chartPoints[hoveredBar]?.seconds > 0 && (
                                <div
                                    className="rp-chart-tooltip"
                                    style={{
                                        left: `${Math.max(4, Math.min(96, (chartPoints[hoveredBar].x / SVG_W) * 100))}%`,
                                        top:  `${Math.max(0, (chartPoints[hoveredBar].y / SVG_H) * 100)}%`,
                                    }}
                                >
                                    {formatDuration(chartPoints[hoveredBar].seconds)}
                                </div>
                            )}
                        </div>

                        {/* X-axis labels */}
                        <div className="rp-chart-xlabels">
                            {chartPoints.map((pt, i) => (
                                <span
                                    key={i}
                                    className={`rp-chart-xlabel${pt.seconds === 0 ? ' muted' : ''}${hoveredBar === i ? ' active' : ''}`}
                                    style={i % labelStep !== 0 ? { visibility: 'hidden' } : undefined}
                                >
                                    {pt.label}
                                </span>
                            ))}
                        </div>

                        {/* Screen-reader alternative — the SVG above is aria-hidden and
                            colour-only, so expose the same data as a real table that
                            assistive tech can navigate row by row. */}
                        <table className="sr-only">
                            <caption>{`Activity timeline — ${chartSub}. Screen time per period.`}</caption>
                            <thead>
                                <tr><th scope="col">Period</th><th scope="col">Screen time</th></tr>
                            </thead>
                            <tbody>
                                {chartPoints.map((pt, i) => (
                                    <tr key={i}>
                                        <th scope="row">{pt.label}</th>
                                        <td>{pt.seconds > 0 ? formatDuration(pt.seconds) : 'No activity'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="rp-empty">
                        <span className="material-symbols-rounded" aria-hidden="true">bar_chart</span>
                        No data for this period
                    </div>
                )}
            </section>

            {/* ── Top Apps — full width ─────────────────────────────── */}
            <section key={`apps-${period}-${data?.topApp?.name}`} className="rp-apps-card page-section">
                <div className="rp-card-head">
                    <h2 className="rp-section-title">Top Apps</h2>
                    <span className="rp-section-sub">{data?.topApps?.length || 0} apps recorded</span>
                </div>
                <div className="rp-apps-list">
                    {(data?.topApps || []).slice(0, 8).map((app, idx) => {
                        const color = rankColor(idx);
                        return (
                            <div
                                key={app.name || idx}
                                className="rp-app-row list-item-animated"
                                style={{ animationDelay: `${idx * 0.015}s` }}
                            >
                                <span className="rp-app-rank" style={{ color }}>{idx + 1}</span>
                                <AppIcon appName={app.name || app.displayName} size={32} />
                                <div className="rp-app-info">
                                    <span className="rp-app-name">{app.displayName || app.name}</span>
                                    <div className="rp-app-bar-track">
                                        <div
                                            className="rp-app-bar-fill"
                                            style={{ width: `${app.percentage || 0}%`, background: color, animationDelay: `${0.04 + idx * 0.02}s` }}
                                        />
                                    </div>
                                </div>
                                <div className="rp-app-meta">
                                    <span className="rp-app-time">{app.formatted}</span>
                                    <span className="rp-app-pct" style={{ color }}>{app.percentage}%</span>
                                </div>
                            </div>
                        );
                    })}
                    {(!data?.topApps || data.topApps.length === 0) && (
                        <div className="rp-empty">
                            <span className="material-symbols-rounded" aria-hidden="true">apps</span>
                            No app data for this period
                        </div>
                    )}
                </div>
            </section>

            {/* ── Categories + Weekday ─────────────────────────────── */}
            <div key={`bottom-${period}`} className="rp-bottom-row page-section">

                {/* Categories */}
                <section className="rp-panel">
                    <div className="rp-card-head">
                        <h2 className="rp-section-title">Categories</h2>
                        <span className="rp-section-sub">Time distribution</span>
                    </div>
                    <div className="rp-cats-list">
                        {(data?.categories || []).slice(0, 8).map((cat, idx) => {
                            const color = catColor(cat.category);
                            return (
                                <div
                                    key={cat.category || idx}
                                    className="rp-cat-row list-item-animated"
                                    style={{ animationDelay: `${idx * 0.015}s` }}
                                >
                                    <div className="rp-cat-swatch" style={{ background: color }} />
                                    <div className="rp-cat-info">
                                        <div className="rp-cat-hrow">
                                            <span className="rp-cat-name">{cat.category}</span>
                                            <span className="rp-cat-time">{cat.formatted}</span>
                                        </div>
                                        <div className="rp-cat-bar-track">
                                            <div
                                                className="rp-cat-bar-fill"
                                                style={{ width: `${Math.min(cat.percentage, 100)}%`, background: color, animationDelay: `${0.05 + idx * 0.03}s` }}
                                            />
                                        </div>
                                    </div>
                                    <span className="rp-cat-pct" style={{ color }}>{cat.percentage}%</span>
                                </div>
                            );
                        })}
                        {(!data?.categories || data.categories.length === 0) && (
                            <div className="rp-empty">
                                <span className="material-symbols-rounded" aria-hidden="true">label</span>
                                No category data
                            </div>
                        )}
                    </div>
                </section>

                {/* Weekday pattern — capsule bars */}
                {data?.insights?.weekdayAvgs ? (
                    <section className="rp-panel">
                        <div className="rp-card-head">
                            <h2 className="rp-section-title">Daily Pattern</h2>
                            <span className="rp-section-sub">Avg per day of week</span>
                        </div>
                        <div className="rp-weekday-grid">
                            {(() => {
                                const entries = Object.entries(data.insights.weekdayAvgs);
                                const maxAvg  = Math.max(...entries.map(([, v]) => v), 1);
                                const DOW_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
                                return entries.map(([day, avg], idx) => {
                                    const pct     = Math.max((avg / maxAvg) * 100, avg > 0 ? 5 : 0);
                                    const isToday = DOW_MAP[day] === todayDowIdx;
                                    return (
                                        <div key={day} className={`rp-wd-chip${isToday ? ' today' : ''}`}>
                                            <span className="rp-wd-time">
                                                {avg > 0 ? formatDuration(avg) : ''}
                                            </span>
                                            <div className="rp-wd-bar-wrap">
                                                <div
                                                    className="rp-wd-capsule"
                                                    style={{ height: `${pct}%`, animationDelay: `${idx * 0.045}s` }}
                                                />
                                            </div>
                                            <span className="rp-wd-label">{day}</span>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </section>
                ) : (
                    <section className="rp-panel">
                        <div className="rp-empty" style={{ height: '100%', minHeight: 120 }}>
                            Not enough data for patterns
                        </div>
                    </section>
                )}
            </div>

            {/* Streak heatmap — always shown below the report grid */}
            <StreakHeatmap />
        </div>
    );
}

export default ReportsPage;
