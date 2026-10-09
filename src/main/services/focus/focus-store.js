/**
 * Focus Store
 *
 * Vault-persisted focus stats + session history + last-used settings.
 * File: .deskly/focus.json  (mirrors services/goals-streaks.js storage).
 *
 * Schema:
 * {
 *   stats: {
 *     byDate: { "2026-06-21": { focusedSec, sessions } },
 *     currentStreak, longestStreak, lastFocusDate
 *   },
 *   recent: [ { startedAt, plannedMin, focusedSec, completed, strict, pomodoro, blockedCount } ],
 *   settings: { durationMin, strict, pomodoro:{on,workMin,breakMin,longBreakMin}, apps:[], categories:[] }
 * }
 */

'use strict';

const path = require('path');

let vaultManager = null;
function vm() {
    if (!vaultManager) {
        try { vaultManager = require('../vault-manager'); } catch { /* not ready */ }
    }
    return vaultManager;
}

const DEFAULT_DATA = {
    stats: { byDate: {}, currentStreak: 0, longestStreak: 0, lastFocusDate: null },
    recent: [],
    settings: {
        durationMin: 50,
        strict: true,
        pomodoro: { on: false, workMin: 25, breakMin: 5, longBreakMin: 15 },
        apps: [],
        categories: [],
    },
};

// A day counts toward the focus streak once this much focus time is logged.
const STREAK_MIN_SECONDS = 60;
const RECENT_LIMIT = 20;

function filePath() {
    const v = vm();
    if (!v || !v.vaultExists()) return null;
    return path.join(v.getVaultPath(), '.deskly', 'focus.json');
}

function read() {
    const v = vm();
    const fp = filePath();
    if (!v || !fp) return clone(DEFAULT_DATA);
    const data = v.readJsonFile(fp, null);
    if (!data) return clone(DEFAULT_DATA);
    return {
        stats:    { ...DEFAULT_DATA.stats,    ...(data.stats || {}) },
        recent:   Array.isArray(data.recent) ? data.recent : [],
        settings: {
            ...DEFAULT_DATA.settings,
            ...(data.settings || {}),
            pomodoro: { ...DEFAULT_DATA.settings.pomodoro, ...((data.settings || {}).pomodoro || {}) },
        },
    };
}

function write(data) {
    const v = vm();
    const fp = filePath();
    if (!v || !fp) return false;
    return v.writeJsonFile(fp, data);
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function today() {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
}

function yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA');
}

// ── Public API ────────────────────────────────────────────────────────────────

function getStats() {
    const d = read();
    const t = today();
    const day = d.stats.byDate[t] || { focusedSec: 0, sessions: 0 };
    return {
        todaySec:      day.focusedSec || 0,
        sessionsToday: day.sessions || 0,
        currentStreak: d.stats.currentStreak || 0,
        longestStreak: d.stats.longestStreak || 0,
        recent:        d.recent.slice(0, RECENT_LIMIT),
    };
}

/**
 * Record a finished session and roll the focus streak.
 * @param {object} s { plannedMin, focusedSec, completed, strict, pomodoro, blockedCount }
 */
function recordSession(s) {
    const d = read();
    const t = today();
    const focusedSec = Math.max(0, Math.round(s.focusedSec || 0));

    // Per-day totals
    const day = d.stats.byDate[t] || { focusedSec: 0, sessions: 0 };
    day.focusedSec += focusedSec;
    day.sessions   += 1;
    d.stats.byDate[t] = day;

    // Streak: a day qualifies once it accrues enough focus time.
    if (day.focusedSec >= STREAK_MIN_SECONDS && d.stats.lastFocusDate !== t) {
        if (d.stats.lastFocusDate === yesterday()) {
            d.stats.currentStreak = (d.stats.currentStreak || 0) + 1;
        } else {
            d.stats.currentStreak = 1;
        }
        d.stats.lastFocusDate = t;
        d.stats.longestStreak = Math.max(d.stats.longestStreak || 0, d.stats.currentStreak);
    }

    // Recent history (most-recent first)
    d.recent.unshift({
        startedAt:    s.startedAt || Date.now(),
        plannedMin:   s.plannedMin || 0,
        focusedSec,
        completed:    !!s.completed,
        strict:       !!s.strict,
        pomodoro:     !!s.pomodoro,
        blockedCount: s.blockedCount || 0,
    });
    d.recent = d.recent.slice(0, RECENT_LIMIT);

    // Prune very old per-day entries (keep ~90 days)
    const keys = Object.keys(d.stats.byDate).sort();
    if (keys.length > 90) {
        for (const k of keys.slice(0, keys.length - 90)) delete d.stats.byDate[k];
    }

    write(d);
    return getStats();
}

function getSettings() {
    return read().settings;
}

function updateSettings(patch) {
    const d = read();
    d.settings = {
        ...d.settings,
        ...patch,
        pomodoro: { ...d.settings.pomodoro, ...(patch.pomodoro || {}) },
    };
    write(d);
    return d.settings;
}

module.exports = { getStats, recordSession, getSettings, updateSettings };
