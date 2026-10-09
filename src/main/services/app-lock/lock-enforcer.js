/**
 * App Lock Enforcer
 *
 * Polls running Windows processes every POLL_INTERVAL_MS. When a locked app is
 * found running AND its trigger says it should be enforced right now:
 *   1. Kills the process (taskkill /F /PID) — UNLESS it is a protected system
 *      process (defense-in-depth safety net; addLock already blocks these).
 *   2. Shows the lock-screen overlay asking for the master PIN.
 *
 * USAGE DATA (for "after_minutes" triggers)
 * ─────────────────────────────────────────
 * main.js sets a usageProvider() that returns today's usage map. We refresh it
 * at most every USAGE_REFRESH_MS so per-poll cost stays low.
 *
 * IF DESKLY IS KILLED
 * ───────────────────
 * Enforcement stops. Deskly is a startup app, so it relaunches at login and the
 * enforcer re-reads locks from the vault and resumes. The kill→relaunch window
 * is the one unavoidable gap.
 */

'use strict';

const { exec } = require('child_process');
const { shell } = require('electron');
const lockStore = require('./lock-store');
const { isProtectedProcess } = require('./system-processes');

let overlayManager = null;
let usageProvider  = null;     // () => Promise<{processName: seconds}>
let statusNotifier = null;     // () => void  — tells main to push status to renderer
let pollTimer      = null;
let pollInFlight   = false;
let isActive       = false;

let usageCache     = {};
let lastUsageFetch = 0;

// Remembers the executable path of each locked app the last time we saw it
// running, so we can RELAUNCH it after the user authenticates.
const launchPaths = new Map();  // appKey(lowercase) → 'C:\\...\\app.exe'

// Tracks, per temp-unlocked app, whether we've actually seen its process running
// since the unlock. When a "seen-running" app disappears, the user closed it →
// we clear the temp unlock so the NEXT launch re-locks. This is what makes
// "always locked" mean "every open requires the PIN".
const unlockSessions = new Map(); // appKey → { seen: bool }

// 1.5s base interval. Fast enough to catch a launched app before it's usable,
// but half the process-spawn churn of 750ms — which matters because tasklist
// enumerates EVERY process and was contending with the activity tracker's
// foreground poll, freezing screen-time tracking while locks were active.
const POLL_INTERVAL_MS = 1500;
const USAGE_REFRESH_MS = 10_000;

// ── Lifecycle ───────────────────────────────────────────────────────────────

function init(overlayMgr) {
    overlayManager = overlayMgr;
    lockStore.init();
}

/** main.js wires this so we can evaluate "after_minutes" triggers. */
function setUsageProvider(fn) { usageProvider = fn; }

/** main.js wires this so the renderer's status chips update on auto re-lock. */
function setStatusNotifier(fn) { statusNotifier = fn; }

/**
 * Called by main right after a successful unlock at the lock screen. Starts a
 * session so we can detect when the user later closes the app and re-lock it.
 */
function onUnlocked(appName) {
    unlockSessions.set(String(appName || '').toLowerCase(), { seen: false });
}

function start() {
    if (isActive) return;
    isActive = true;
    schedulePoll();
    console.log('[AppLock] Enforcer started');
}

function stop() {
    isActive = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    console.log('[AppLock] Enforcer stopped');
}

// ── Process enumeration ───────────────────────────────────────────────────────

/**
 * Query ONLY the given process names with targeted tasklist filters, instead of
 * enumerating every process on the machine. `tasklist /FI "IMAGENAME eq x.exe"`
 * is dramatically cheaper than a full `tasklist`, which is what was contending
 * with the activity tracker and freezing screen-time tracking.
 *
 * @param {string[]} names  lowercased process names WITH .exe (e.g. "chrome.exe")
 * @returns {Promise<Map<string, number[]>>}  name → [pid, ...]
 */
function getMatchingProcesses(names) {
    if (!names.length) return Promise.resolve(new Map());
    const filters = names.map(n => `/FI "IMAGENAME eq ${n}"`).join(' ');
    return new Promise((resolve) => {
        exec(`tasklist ${filters} /FO CSV /NH`, { timeout: 3000, windowsHide: true }, (err, stdout) => {
            const map = new Map();
            if (err || !stdout) { resolve(map); return; }
            for (const line of stdout.trim().split('\n')) {
                const cols = line.split('","');
                if (cols.length < 2) continue;
                const name = cols[0].replace(/^"/, '').toLowerCase().trim();
                const pid  = parseInt(cols[1], 10);
                if (!name || Number.isNaN(pid)) continue;
                if (!map.has(name)) map.set(name, []);
                map.get(name).push(pid);
            }
            resolve(map);
        });
    });
}

function killPid(pid) {
    return new Promise((resolve) => {
        exec(`taskkill /F /PID ${pid}`, { timeout: 2000, windowsHide: true }, (err) => {
            if (err) console.warn(`[AppLock] kill ${pid} failed:`, err.message);
            resolve(!err);
        });
    });
}

/**
 * Resolve a PID's full executable path so we can relaunch the app after the
 * user authenticates. PowerShell is always present and (Get-Process).Path is
 * reliable across Windows versions. Only called the instant before a kill —
 * never on the hot poll path — so its ~200ms cost is irrelevant.
 */
function getExePath(pid) {
    return new Promise((resolve) => {
        const cmd = `powershell -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path"`;
        exec(cmd, { timeout: 4000, windowsHide: true }, (err, stdout) => {
            if (err || !stdout) { resolve(null); return; }
            const p = stdout.trim();
            resolve(p && p.length > 3 ? p : null);
        });
    });
}

/**
 * Relaunch a previously-killed locked app after successful authentication.
 * Returns true if a launch was attempted.
 */
function relaunchApp(appName) {
    const key  = String(appName || '').toLowerCase();
    const path = launchPaths.get(key);
    if (!path) return false;
    shell.openPath(path).then((errMsg) => {
        if (errMsg) console.warn(`[AppLock] relaunch ${key} failed:`, errMsg);
    });
    return true;
}

// ── Usage cache ───────────────────────────────────────────────────────────────

async function refreshUsageIfStale() {
    if (!usageProvider) return;
    const now = Date.now();
    if (now - lastUsageFetch < USAGE_REFRESH_MS) return;
    lastUsageFetch = now;
    try {
        const map = await usageProvider();
        if (map && typeof map === 'object') usageCache = map;
    } catch { /* keep last cache */ }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

function schedulePoll() {
    if (!isActive) return;
    pollTimer = setTimeout(runPoll, POLL_INTERVAL_MS);
}

async function runPoll() {
    if (!isActive) return;
    if (pollInFlight) { schedulePoll(); return; }
    pollInFlight = true;
    try {
        await refreshUsageIfStale();
        await checkLockedApps();
    } catch (err) {
        console.error('[AppLock] poll error:', err.message);
    } finally {
        pollInFlight = false;
        schedulePoll();
    }
}

async function checkLockedApps() {
    const locks = lockStore.getAll();
    if (!Object.keys(locks).length) { unlockSessions.clear(); return; }

    // Only query the specific locked process names — not every process running.
    const lockedProcNames = Object.entries(locks)
        .map(([key, lock]) => (lock.processName || key + '.exe').toLowerCase())
        .filter(p => !isProtectedProcess(p));
    const runningMap = await getMatchingProcesses(lockedProcNames);

    for (const [key, lock] of Object.entries(locks)) {
        const proc = (lock.processName || key + '.exe').toLowerCase();

        // SAFETY NET: never act on a protected process, even if one slipped in.
        if (isProtectedProcess(proc)) {
            console.warn(`[AppLock] Refusing to enforce protected process: ${proc}`);
            continue;
        }

        const pids      = runningMap.get(proc);
        const isRunning = !!(pids && pids.length);

        // ── Re-lock-on-close ────────────────────────────────────────────────
        // While a temp unlock is active, watch the process. Once we've seen it
        // running and it then disappears, the user closed it → clear the unlock
        // so the next launch is locked again.
        if (lock.tempUnlockUntil && Date.now() < lock.tempUnlockUntil) {
            const sess = unlockSessions.get(key) || { seen: false };
            if (isRunning) {
                sess.seen = true;
                unlockSessions.set(key, sess);
            } else if (sess.seen) {
                lockStore.clearTempUnlock(key);
                unlockSessions.delete(key);
                launchPaths.delete(key);
                if (statusNotifier) statusNotifier();
            }
            continue; // never kill while temp-unlocked
        }
        // Temp unlock expired by time — drop any stale session.
        unlockSessions.delete(key);

        if (!isRunning) continue;

        const usageKey = key.replace(/\.exe$/i, '');
        const seconds  = usageCache[usageKey] ?? usageCache[key] ?? 0;
        if (!lockStore.isLockActive(lock, seconds)) continue;

        console.log(`[AppLock] Blocking ${lock.displayName} (pids: ${pids.join(',')})`);

        // Capture the exe path BEFORE killing so we can relaunch on unlock.
        const exePath = await getExePath(pids[0]);
        if (exePath) launchPaths.set(key, exePath);

        await Promise.all(pids.map(killPid));

        if (overlayManager) {
            overlayManager.show({
                appName:     key,
                displayName: lock.displayName,
                processName: proc,
            });
        }
    }
}

// ── Queries ───────────────────────────────────────────────────────────────────

function hasActiveLocks() {
    const locks = lockStore.getAll();
    return Object.values(locks).some(l => l.enabled);
}

function getStatus() {
    return lockStore.getStatus(usageCache);
}

module.exports = {
    init,
    setUsageProvider,
    setStatusNotifier,
    onUnlocked,
    start,
    stop,
    hasActiveLocks,
    getStatus,
    relaunchApp,
};
