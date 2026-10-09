/**
 * Per-App Goals Service
 *
 * Tracks intentional usage targets per app:
 *   type: 'minimum' — spend at LEAST X minutes (e.g. reading app, exercise tracker)
 *   type: 'maximum' — spend at MOST X minutes (soft cap, advisory only — AppLimits enforces hard blocks)
 *
 * Stored in vault: <vault>/.deskly/app-goals.json
 * Schema: { goals: { [appName]: { targetMinutes, type, label, createdAt } }, version: 1 }
 */

const path = require('path');
const { getDailySummary, getToday } = require('../database/db');

let vaultManager = null;
function getVaultManager() {
    if (!vaultManager) {
        try { vaultManager = require('./vault-manager'); } catch {}
    }
    return vaultManager;
}

function getFilePath() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return null;
    return path.join(vm.getVaultPath(), '.deskly', 'app-goals.json');
}

function readStore() {
    const vm = getVaultManager();
    const fp = getFilePath();
    if (!vm || !fp) return { goals: {}, version: 1 };
    return vm.readJsonFile(fp, { goals: {}, version: 1 });
}

function writeStore(data) {
    const vm = getVaultManager();
    const fp = getFilePath();
    if (!vm || !fp) return false;
    return vm.writeJsonFile(fp, data);
}

// ── CRUD ──────────────────────────────────────────────────────────

function getAppGoals() {
    return readStore().goals;
}

function getAppGoal(appName) {
    return readStore().goals[appName] || null;
}

/**
 * @param {string} appName
 * @param {number} targetMinutes
 * @param {'minimum'|'maximum'} type
 * @param {string} [label]  — optional friendly label (e.g. "Kindle", "Exercise")
 */
function setAppGoal(appName, targetMinutes, type = 'minimum', label = '') {
    if (!appName || typeof targetMinutes !== 'number' || targetMinutes < 1) {
        throw new Error('Invalid goal parameters');
    }
    if (!['minimum', 'maximum'].includes(type)) {
        throw new Error('type must be "minimum" or "maximum"');
    }
    const store = readStore();
    store.goals[appName] = {
        targetMinutes: Math.round(targetMinutes),
        type,
        label: label || appName,
        createdAt: store.goals[appName]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    writeStore(store);
    return store.goals[appName];
}

function removeAppGoal(appName) {
    const store = readStore();
    delete store.goals[appName];
    writeStore(store);
}

// ── Progress ──────────────────────────────────────────────────────

/**
 * Returns today's progress for every configured goal.
 * Each entry: { appName, label, targetMinutes, type, currentMinutes, met, percentComplete }
 */
function getAppGoalsProgress(dateStr) {
    const date = dateStr || getToday();
    const goals = getAppGoals();
    if (!Object.keys(goals).length) return [];

    const dayData = getDailySummary(date);
    const aggregates = dayData?.aggregates || {};

    return Object.entries(goals).map(([appName, goal]) => {
        const appData = aggregates[appName];
        const currentSeconds = appData?.totalSeconds || 0;
        const currentMinutes = Math.floor(currentSeconds / 60);
        const { targetMinutes, type, label } = goal;
        const percent = Math.min(200, Math.round((currentMinutes / targetMinutes) * 100));

        let met = false;
        if (type === 'minimum') met = currentMinutes >= targetMinutes;
        if (type === 'maximum') met = currentMinutes <= targetMinutes;

        return {
            appName,
            label,
            targetMinutes,
            type,
            currentMinutes,
            currentSeconds,
            met,
            percentComplete: percent,
        };
    });
}

/**
 * Returns a composite daily score (0–100) combining:
 *   - Global screen time goal adherence (50%)
 *   - Per-app goals met ratio (50%)
 * Used by the streak system (F4) to decide if a day is "healthy".
 */
function getDailyScore(dateStr, globalGoalHours = 8) {
    const progress = getAppGoalsProgress(dateStr);
    const date = dateStr || getToday();
    const dayData = getDailySummary(date);

    // Global screen time component
    const aggregates = dayData?.aggregates || {};
    let totalSeconds = 0;
    for (const [k, v] of Object.entries(aggregates)) {
        if (!v || typeof v !== 'object') continue;
        totalSeconds += v.totalSeconds || 0;
    }
    const goalSeconds = globalGoalHours * 3600;
    const globalScore = totalSeconds <= goalSeconds
        ? 50
        : Math.max(0, 50 - Math.round((totalSeconds - goalSeconds) / 3600 * 10));

    // Per-app goals component
    const appScore = progress.length === 0
        ? 50
        : Math.round((progress.filter(p => p.met).length / progress.length) * 50);

    return Math.min(100, globalScore + appScore);
}

module.exports = {
    getAppGoals,
    getAppGoal,
    setAppGoal,
    removeAppGoal,
    getAppGoalsProgress,
    getDailyScore,
};
