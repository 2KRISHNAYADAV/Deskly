/**
 * Insights Service
 *
 * Analyses the last 35 days of vault data to surface 3 high-signal
 * observations about the user's screen-time patterns.
 *
 * All computation is rule-based (no external AI) — fast, private, offline.
 */

const { getDailySummary, getAppDisplayName } = require('../database/db');

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(s) {
    if (!s || s <= 0) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

function fmtHour(h) {
    if (h === 0) return '12am';
    if (h < 12) return `${h}am`;
    if (h === 12) return '12pm';
    return `${h - 12}pm`;
}

function dateStrDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA');
}

function weekdayName(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
}

function currentMonthName() {
    return new Date().toLocaleDateString('en-US', { month: 'long' });
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function appTotals(summary) {
    const agg = summary.aggregates || {};
    return Object.entries(agg).map(([appName, d]) => ({
        appName,
        seconds: d.totalSeconds || 0,
        category: d.category || 'Uncategorized',
    }));
}

function dayTotal(summary) {
    return appTotals(summary).reduce((a, x) => a + x.seconds, 0);
}

const PRODUCTIVE_APPS = [
    'code', 'antigravity', 'cursor', 'figma', 'notion', 'obsidian',
    'word', 'excel', 'powerpoint', 'xcode', 'androidstudio', 'intellij',
    'webstorm', 'pycharm', 'rider', 'clion', 'sketch', 'affinity',
];
const PRODUCTIVE_CATS = ['Productivity', 'Development', 'Design', 'Work', 'Education'];
const LEISURE_CATS    = ['Entertainment', 'Social Media', 'Gaming', 'Social'];

function isProductiveApp(appName, category) {
    const n = (appName || '').toLowerCase();
    return PRODUCTIVE_APPS.some(p => n.includes(p)) || PRODUCTIVE_CATS.includes(category);
}

// ─── Insight: top-app change vs 4-week baseline ──────────────────────────────

function insightAppChange(thisWeekApps, baselineApps) {
    let best = null, bestDiff = 0;

    const allApps = new Set([...Object.keys(thisWeekApps), ...Object.keys(baselineApps)]);
    for (const appName of allApps) {
        const tw  = thisWeekApps[appName]  || 0;
        const bl  = baselineApps[appName]  || 0;
        if (bl < 600)  continue; // no meaningful baseline
        if (tw < 900 && bl < 900) continue; // both tiny

        const diff = tw - bl;
        const pct  = Math.abs(diff) / bl;
        if (pct < 0.20 || Math.abs(diff) < 1200) continue;
        if (Math.abs(diff) <= bestDiff) continue;

        bestDiff = Math.abs(diff);
        best = { appName, tw, bl, diff, pct };
    }
    if (!best) return null;

    const name = getAppDisplayName(best.appName);
    const up   = best.diff > 0;
    const pct  = Math.round(best.pct * 100);
    const abs  = Math.abs(best.diff);
    const prod = isProductiveApp(best.appName, '');
    const good = (up && prod) || (!up && !prod);

    return {
        type:       'app-change',
        icon:       up ? 'trending_up' : 'trending_down',
        title:      `${fmt(abs)} ${up ? 'more' : 'less'} on ${name}`,
        body:       `${pct}% ${up ? 'above' : 'below'} your 4-week average — ${
            good
                ? (up ? 'you\'re putting in the time.' : 'pulling back well.')
                : (up ? 'worth keeping an eye on.' : 'a good sign this week.')
        }`,
        metric:     `${pct}% ${up ? '↑' : '↓'}`,
        isPositive: good,
    };
}

// ─── Insight: peak productive hours ──────────────────────────────────────────

function insightPeakHours(sessions) {
    const hourSec = new Array(24).fill(0);

    for (const s of sessions) {
        if (!s.startTime) continue;
        if (!isProductiveApp(s.appName, s.category)) continue;
        const h = new Date(s.startTime).getHours();
        hourSec[h] += s.duration || 0;
    }

    // Find best 2-hour window (6am–10pm)
    let bestH = -1, bestSec = 0;
    for (let h = 6; h < 22; h++) {
        const w = (hourSec[h] || 0) + (hourSec[h + 1] || 0);
        if (w > bestSec) { bestSec = w; bestH = h; }
    }

    if (bestSec < 600 || bestH < 0) return null;

    return {
        type:       'peak-hours',
        icon:       'schedule',
        title:      `Peak focus: ${fmtHour(bestH)}–${fmtHour(bestH + 2)}`,
        body:       `This window consistently holds your deepest work sessions. Protect it from distractions and meetings.`,
        metric:     fmt(bestSec) + ' avg',
        isPositive: true,
    };
}

// ─── Insight: category shift ──────────────────────────────────────────────────

function insightCategoryShift(thisWeekCats, baselineCats) {
    let best = null, bestDiff = 0;

    const allCats = new Set([...Object.keys(thisWeekCats), ...Object.keys(baselineCats)]);
    for (const cat of allCats) {
        if (cat === 'Uncategorized') continue;
        const tw = thisWeekCats[cat] || 0;
        const bl = baselineCats[cat] || 0;
        if (bl < 1200) continue;

        const diff = tw - bl;
        const pct  = Math.abs(diff) / bl;
        if (pct < 0.25 || Math.abs(diff) < 1800) continue;
        if (Math.abs(diff) <= bestDiff) continue;

        bestDiff = Math.abs(diff);
        best = { cat, tw, bl, diff, pct };
    }
    if (!best) return null;

    const up     = best.diff > 0;
    const pct    = Math.round(best.pct * 100);
    const abs    = Math.abs(best.diff);
    const leisure = LEISURE_CATS.some(c => best.cat.toLowerCase().includes(c.toLowerCase()));
    const good   = leisure ? !up : up;

    return {
        type:       'category-shift',
        icon:       good ? 'check_circle' : 'info',
        title:      `${best.cat} ${up ? 'up' : 'down'} ${pct}% this week`,
        body:       `${fmt(abs)} ${up ? 'more' : 'less'} than your usual weekly amount in this category.`,
        metric:     `${fmt(abs)} ${up ? '↑' : '↓'}`,
        isPositive: good,
    };
}

// ─── Insight: best (lightest) day this week ───────────────────────────────────

function insightBestDay(weekDays) {
    const today = dateStrDaysAgo(0);
    let bestDate = null, bestSec = Infinity;

    for (const { date, summary } of weekDays) {
        if (date === today) continue;
        const total = dayTotal(summary);
        if (total < 300) continue;
        if (total < bestSec) { bestSec = total; bestDate = date; }
    }
    if (!bestDate) return null;

    return {
        type:       'best-day',
        icon:       'star',
        title:      `${weekdayName(bestDate)} was your lightest day`,
        body:       `Only ${fmt(bestSec)} of screen time — your best this week. What made that day different?`,
        metric:     fmt(bestSec),
        isPositive: true,
    };
}

// ─── Insight: monthly projection for top app ──────────────────────────────────

function insightProjection(thisWeekApps) {
    const sorted = Object.entries(thisWeekApps).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;

    const [topApp, topSec] = sorted[0];
    if (topSec < 3600) return null;

    const dailyAvg  = topSec / 7;
    const projected = Math.round(dailyAvg * 30);
    if (projected < 7200) return null;

    const name = getAppDisplayName(topApp);

    return {
        type:       'projection',
        icon:       'calendar_month',
        title:      `On pace for ${fmt(projected)} on ${name} in ${currentMonthName()}`,
        body:       `At your current rate of ${fmt(Math.round(dailyAvg))} per day — something to be aware of.`,
        metric:     fmt(projected),
        isPositive: false,
    };
}

// ─── Insight: fragmentation (app switches) ────────────────────────────────────

function insightFragmentation(weekDays) {
    const today = dateStrDaysAgo(0);

    // Count sessions per day
    const countsByDate = {};
    for (const { date, summary } of weekDays) {
        countsByDate[date] = (summary.sessions || []).length;
    }

    const todayCount = countsByDate[today] || 0;
    if (todayCount < 25) return null;

    const otherDays = Object.entries(countsByDate).filter(([d]) => d !== today);
    if (!otherDays.length) return null;

    const avg  = otherDays.reduce((a, [, c]) => a + c, 0) / otherDays.length;
    const diff = todayCount - avg;
    if (diff < 12) return null;

    return {
        type:       'fragmentation',
        icon:       'device_hub',
        title:      `${todayCount} app switches today`,
        body:       `About ${Math.round(diff)} more than your daily average. Fewer switches usually means deeper focus.`,
        metric:     `+${Math.round(diff)} vs avg`,
        isPositive: false,
    };
}

// ─── Main export ──────────────────────────────────────────────────────────────

function getWeeklyInsights() {
    try {
        // Load 35 days
        const days = [];
        for (let i = 0; i < 35; i++) {
            const date    = dateStrDaysAgo(i);
            const summary = getDailySummary(date);
            days.push({ date, summary });
        }

        const thisWeekDays  = days.slice(0, 7);
        const baselineDays  = days.slice(7, 35); // 28 days

        // Per-app totals this week
        const thisWeekApps = {};
        const thisWeekCats = {};
        for (const { summary } of thisWeekDays) {
            for (const { appName, seconds, category } of appTotals(summary)) {
                thisWeekApps[appName] = (thisWeekApps[appName] || 0) + seconds;
                thisWeekCats[category] = (thisWeekCats[category] || 0) + seconds;
            }
        }

        // Baseline normalized to one week
        const baselineApps = {};
        const baselineCats = {};
        for (const { summary } of baselineDays) {
            for (const { appName, seconds, category } of appTotals(summary)) {
                baselineApps[appName] = (baselineApps[appName] || 0) + seconds;
                baselineCats[category] = (baselineCats[category] || 0) + seconds;
            }
        }
        for (const k in baselineApps) baselineApps[k] = (baselineApps[k] / 28) * 7;
        for (const k in baselineCats) baselineCats[k] = (baselineCats[k] / 28) * 7;

        // All sessions this week (for time-of-day analysis)
        const allSessions = thisWeekDays.flatMap(({ summary }) => summary.sessions || []);

        const hasData = thisWeekDays.some(d => dayTotal(d.summary) > 0);

        // Generate and rank — peak-hours and app-change go first (most personal)
        const candidates = [
            insightPeakHours(allSessions),
            insightAppChange(thisWeekApps, baselineApps),
            insightCategoryShift(thisWeekCats, baselineCats),
            insightBestDay(thisWeekDays),
            insightFragmentation(thisWeekDays),
            insightProjection(thisWeekApps),
        ].filter(Boolean);

        return {
            insights:     candidates.slice(0, 3),
            generatedAt:  new Date().toISOString(),
            hasData,
        };
    } catch (err) {
        console.error('[Insights] Generation failed:', err);
        return { insights: [], generatedAt: new Date().toISOString(), hasData: false };
    }
}

module.exports = { getWeeklyInsights };
