/**
 * Focus Engine — session runtime + distraction enforcement.
 *
 * A focus session blocks a chosen set of apps for its duration. Two timer models:
 *   • Simple   — one focus block of `durationMin`, auto-completes at the end.
 *   • Pomodoro — work/break cycles (long break every 4th) until the user ends it.
 *
 * Enforcement (focus phase only, never during breaks):
 *   • strict  → kill the app + show the "Stay focused" overlay
 *   • !strict → show a dismissible nudge once (no kill); don't re-nag until reopened
 *
 * The engine ONLY runs timers/polls while a session is active → zero idle cost.
 * No watchdog: focus is voluntary; closing Deskly ends the session.
 */

'use strict';

const { exec } = require('child_process');
const { Notification } = require('electron');
const { isProtectedProcess } = require('../app-lock/system-processes');
const focusStore = require('./focus-store');

let overlayManager = null;
let onState        = null;     // () => void : push state to renderer

let active = null;             // see start()
let pollTimer = null, tickTimer = null, pollInFlight = false;
const POLL_MS = 1500;

// Apps we've already nudged this "open" (non-strict), cleared when they close.
let nudgedApps = new Set();

// ── Init ───────────────────────────────────────────────────────────────────────

function init(overlayMgr, onStateChange) {
    overlayManager = overlayMgr;
    onState = onStateChange;
}

// ── Process helpers (small, duplicated from app-lock to avoid coupling) ─────────

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
        exec(`taskkill /F /PID ${pid}`, { timeout: 2000, windowsHide: true }, () => resolve());
    });
}

// ── Block-set resolution ────────────────────────────────────────────────────────

/**
 * Resolve a config's chosen apps + categories into a Set of lowercased *.exe
 * process names, excluding protected system processes.
 * @param {string[]} apps        chosen app names (with or without .exe)
 * @param {string[]} categoryIds chosen category ids
 */
function resolveBlockSet(apps = [], categoryIds = []) {
    const set = new Set();
    const add = (name) => {
        if (!name) return;
        let p = String(name).toLowerCase();
        if (!p.endsWith('.exe')) p += '.exe';
        if (!isProtectedProcess(p)) set.add(p);
    };
    for (const a of apps) add(a);

    if (categoryIds.length) {
        try {
            const groups = require('../user-categories').getAppsByCategory();
            const wanted = new Set(categoryIds);
            for (const g of groups) {
                if (!wanted.has(g.id)) continue;
                for (const app of (g.apps || [])) add(app.name);
            }
        } catch { /* categories unavailable — apps-only block */ }
    }
    return set;
}

// ── Notifications ────────────────────────────────────────────────────────────────

function notify(title, body) {
    try {
        if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
    } catch { /* ignore */ }
}

// ── Session lifecycle ────────────────────────────────────────────────────────────

function phaseMinutes(phase, cycle, pomo) {
    if (phase === 'focus') return pomo.on ? pomo.workMin : active.durationMin;
    // break: long break every 4th completed work cycle
    return (cycle % 4 === 0) ? pomo.longBreakMin : pomo.breakMin;
}

function start(config = {}) {
    if (active) return { success: false, reason: 'already_active' };

    const pomo = {
        on:          !!config.pomodoro?.on,
        workMin:     clampMin(config.pomodoro?.workMin, 25),
        breakMin:    clampMin(config.pomodoro?.breakMin, 5),
        longBreakMin: clampMin(config.pomodoro?.longBreakMin, 15),
    };
    const durationMin = clampMin(config.durationMin, 50);
    const blockSet = resolveBlockSet(config.apps, config.categories);

    active = {
        phase:      'focus',
        strict:     !!config.strict,
        blockSet,
        pomo,
        cycle:      1,
        durationMin,
        focusedSec: 0,
        startedAt:  Date.now(),
        endsAt:     0,
        plannedMin: pomo.on ? pomo.workMin : durationMin,
    };
    active.endsAt = Date.now() + phaseMinutes('focus', 1, pomo) * 60_000;

    nudgedApps = new Set();
    // Persist the chosen config so the screen restores it next time.
    focusStore.updateSettings({
        durationMin, strict: active.strict, pomodoro: pomo,
        apps: config.apps || [], categories: config.categories || [],
    });

    startTimers();
    pushState();
    return { success: true, state: getState() };
}

function startTimers() {
    stopTimers();
    tickTimer = setInterval(onTick, 1000);
    schedulePoll();
}

function stopTimers() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function onTick() {
    if (!active) return;
    if (active.phase === 'focus') active.focusedSec += 1;

    const left = active.endsAt - Date.now();
    if (left > 0) return;

    // Phase boundary
    if (active.phase === 'focus') {
        if (active.pomo.on) {
            // → break: lift blocking, hide overlay
            active.phase = 'break';
            active.endsAt = Date.now() + phaseMinutes('break', active.cycle, active.pomo) * 60_000;
            overlayManager?.hide();
            nudgedApps = new Set();
            notify('Break time', `Nice work — take a ${phaseMinutes('break', active.cycle, active.pomo)} min break.`);
            pushState();
        } else {
            end(false); // simple block finished → complete
        }
    } else {
        // break → next focus cycle
        active.cycle += 1;
        active.phase = 'focus';
        active.endsAt = Date.now() + phaseMinutes('focus', active.cycle, active.pomo) * 60_000;
        notify('Back to focus', 'Break over — locking back in.');
        pushState();
    }
}

// ── Enforcement poll ──────────────────────────────────────────────────────────

function schedulePoll() {
    if (!active) return;
    pollTimer = setTimeout(runPoll, POLL_MS);
}

async function runPoll() {
    if (!active) return;
    if (pollInFlight || active.phase !== 'focus' || active.blockSet.size === 0) {
        schedulePoll();
        return;
    }
    pollInFlight = true;
    try {
        const running = await getMatchingProcesses([...active.blockSet]);
        const stillOpen = new Set();

        for (const [name, pids] of running) {
            if (isProtectedProcess(name)) continue; // safety net
            stillOpen.add(name);
            if (active.strict) {
                await Promise.all(pids.map(killPid));
                showOverlay();
            } else if (!nudgedApps.has(name)) {
                nudgedApps.add(name);
                showOverlay();
            }
        }
        // Forget nudges for apps that have closed, so reopening nudges again.
        for (const n of [...nudgedApps]) if (!stillOpen.has(n)) nudgedApps.delete(n);
    } catch { /* ignore */ }
    finally { pollInFlight = false; schedulePoll(); }
}

function showOverlay() {
    if (!overlayManager || !active) return;
    overlayManager.show({
        mode:        active.strict ? 'strict' : 'nudge',
        endsAt:      active.endsAt,
        phase:       active.phase,
        blockedCount: active.blockSet.size,
    });
}

// ── End / state ───────────────────────────────────────────────────────────────

function end(early) {
    if (!active) return { success: false };
    const snapshot = active;
    stopTimers();
    overlayManager?.hide();
    nudgedApps = new Set();
    active = null;

    const stats = focusStore.recordSession({
        startedAt:   snapshot.startedAt,
        plannedMin:  snapshot.plannedMin,
        focusedSec:  snapshot.focusedSec,
        completed:   !early,
        strict:      snapshot.strict,
        pomodoro:    snapshot.pomo.on,
        blockedCount: snapshot.blockSet.size,
    });

    const mins = Math.round(snapshot.focusedSec / 60);
    notify(early ? 'Session ended' : 'Focus complete', `${mins} min focused. Streak: ${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}.`);
    pushState();
    return { success: true, stats };
}

function getState() {
    if (!active) return { active: false };
    return {
        active:       true,
        phase:        active.phase,
        endsAt:       active.endsAt,
        secondsLeft:  Math.max(0, Math.round((active.endsAt - Date.now()) / 1000)),
        cycle:        active.cycle,
        strict:       active.strict,
        pomodoro:     active.pomo.on,
        focusedSec:   active.focusedSec,
        blockedCount: active.blockSet.size,
    };
}

function isActive() { return !!active; }

function pushState() { try { onState?.(); } catch { /* ignore */ } }

function clampMin(v, def) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 600 ? Math.round(n) : def;
}

module.exports = { init, start, end, getState, isActive };
