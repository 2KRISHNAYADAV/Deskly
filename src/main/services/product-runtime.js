const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

const runtimeStore = new Store({ name: 'runtime-state' });
const featureFlagsStore = new Store({ name: 'feature-flags' });
const metricsStore = new Store({ name: 'operational-metrics' });

const DEFAULT_FLAGS = {
    'updates.enabled': false,
    'tracking.enabled': true,
    'vault.watcher.enabled': true,
    'telemetry.enabled': false,
    'diagnostics.verbose': false,
};

let appRef = null;
let logFilePath = null;

// ── Log write buffer ─────────────────────────────────────────────────────────
// appendFileSync on the main thread blocks IPC for ~1-2ms per call. With the
// tracker logging several lines/sec during active use that adds up to visible
// jank. Instead, collect lines and flush asynchronously every 2 seconds.
let logBuffer = [];
let logFlushTimer = null;

function flushLogBuffer() {
    if (!logFilePath || logBuffer.length === 0) return;
    const payload = logBuffer.join('');
    logBuffer = [];
    // fs.promises.appendFile is non-blocking; errors are silently swallowed
    // (same contract as the old appendFileSync catch block).
    fs.promises.appendFile(logFilePath, payload, 'utf8').catch(() => {});
}

function scheduleLogFlush() {
    if (logFlushTimer) return; // already scheduled
    logFlushTimer = setTimeout(() => {
        logFlushTimer = null;
        flushLogBuffer();
    }, 2000);
}
// ─────────────────────────────────────────────────────────────────────────────

let launchContext = {
    currentVersion: null,
    previousVersion: null,
    updatedFromVersion: null,
    resumedAfterUncleanShutdown: false,
    launchId: null,
};

function ensureFeatureFlagDefaults() {
    Object.entries(DEFAULT_FLAGS).forEach(([key, value]) => {
        if (typeof featureFlagsStore.get(key) === 'undefined') {
            featureFlagsStore.set(key, value);
        }
    });
}

function ensureLogFile() {
    if (!appRef) return null;
    const logDir = path.join(appRef.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const date = new Date().toISOString().slice(0, 10);
    logFilePath = path.join(logDir, `deskly-${date}.log`);
    return logFilePath;
}

function pruneOldLogs(retentionDays = 14) {
    if (!appRef) return;
    try {
        const logDir = path.join(appRef.getPath('userData'), 'logs');
        if (!fs.existsSync(logDir)) return;

        const now = Date.now();
        const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

        fs.readdirSync(logDir)
            .filter((file) => file.startsWith('deskly-') && file.endsWith('.log'))
            .forEach((file) => {
                const fullPath = path.join(logDir, file);
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs > maxAgeMs) {
                    fs.rmSync(fullPath, { force: true });
                }
            });
    } catch (_) {
        // Best-effort cleanup only.
    }
}

function normalizeError(error) {
    if (!error) return null;
    return {
        message: String(error.message || error),
        name: error.name || 'Error',
        stack: typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 8).join('\n') : null,
    };
}

function sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object') return undefined;

    const clone = {};
    for (const [key, value] of Object.entries(meta)) {
        if (value === undefined) continue;

        if (value instanceof Error) {
            clone[key] = normalizeError(value);
            continue;
        }

        if (typeof value === 'string' && value.length > 800) {
            clone[key] = `${value.slice(0, 800)}...`;
            continue;
        }

        clone[key] = value;
    }

    return clone;
}

function appendLog(level, event, meta = {}) {
    try {
        const filePath = ensureLogFile();
        if (!filePath) return;

        const payload = {
            ts: new Date().toISOString(),
            level,
            event,
            ...sanitizeMeta(meta),
        };

        logBuffer.push(`${JSON.stringify(payload)}\n`);
        scheduleLogFlush();
    } catch (_) {
        // Never throw from diagnostics.
    }
}

function incrementMetric(name, incrementBy = 1) {
    const key = String(name || '').trim();
    if (!key) return;
    const current = Number(metricsStore.get(key, 0));
    metricsStore.set(key, current + incrementBy);
}

function initialize(app) {
    appRef = app;
    ensureFeatureFlagDefaults();
    ensureLogFile();
    pruneOldLogs();

    const previousLaunch = runtimeStore.get('lastLaunch', null);
    const currentVersion = app.getVersion();
    const launchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    launchContext = {
        currentVersion,
        previousVersion: previousLaunch?.version || null,
        updatedFromVersion: previousLaunch?.version && previousLaunch.version !== currentVersion
            ? previousLaunch.version
            : null,
        resumedAfterUncleanShutdown: previousLaunch?.state === 'started',
        launchId,
    };

    runtimeStore.set('lastLaunch', {
        launchId,
        version: currentVersion,
        startedAt: new Date().toISOString(),
        state: 'started',
    });

    appendLog('info', 'app.launch.started', {
        launchId,
        currentVersion,
        previousVersion: launchContext.previousVersion,
        resumedAfterUncleanShutdown: launchContext.resumedAfterUncleanShutdown,
    });

    if (launchContext.resumedAfterUncleanShutdown) {
        incrementMetric('crash.recoveredLaunches');
    }

    return launchContext;
}

function markLaunchReady(extra = {}) {
    const current = runtimeStore.get('lastLaunch', {});
    runtimeStore.set('lastLaunch', {
        ...current,
        state: 'ready',
        readyAt: new Date().toISOString(),
        ...extra,
    });

    appendLog('info', 'app.launch.ready', {
        launchId: launchContext.launchId,
        ...extra,
    });
}

function markCrash(eventName, error) {
    const current = runtimeStore.get('lastLaunch', {});
    runtimeStore.set('lastLaunch', {
        ...current,
        state: 'crashed',
        crashedAt: new Date().toISOString(),
        crashEvent: eventName,
        crashMessage: String(error?.message || error || 'unknown'),
    });

    incrementMetric('crash.total');
    appendLog('error', eventName, { error: normalizeError(error), launchId: launchContext.launchId });
}

function markCleanShutdown() {
    const current = runtimeStore.get('lastLaunch', {});
    runtimeStore.set('lastLaunch', {
        ...current,
        state: 'clean-shutdown',
        endedAt: new Date().toISOString(),
    });

    appendLog('info', 'app.shutdown.clean', { launchId: launchContext.launchId });
}

function getLaunchContext() {
    return { ...launchContext };
}

function getFlag(flagName, fallback = undefined) {
    if (typeof featureFlagsStore.get(flagName) === 'undefined') {
        return typeof fallback === 'undefined' ? DEFAULT_FLAGS[flagName] : fallback;
    }
    return featureFlagsStore.get(flagName);
}

function setFlag(flagName, value) {
    featureFlagsStore.set(flagName, Boolean(value));
    appendLog('info', 'feature-flag.updated', { flagName, value: Boolean(value) });
    return Boolean(value);
}

function getAllFlags() {
    const flags = {};
    Object.keys(DEFAULT_FLAGS).forEach((key) => {
        flags[key] = getFlag(key, DEFAULT_FLAGS[key]);
    });
    return flags;
}

function getDiagnosticsSummary() {
    return {
        launchContext: getLaunchContext(),
        lastLaunch: runtimeStore.get('lastLaunch', null),
        featureFlags: getAllFlags(),
        metrics: metricsStore.store,
        logFilePath,
    };
}

module.exports = {
    initialize,
    markLaunchReady,
    markCrash,
    markCleanShutdown,
    getLaunchContext,
    appendLog,
    flushLogBuffer,   // call on app 'will-quit' to drain the buffer before exit
    incrementMetric,
    getFlag,
    setFlag,
    getAllFlags,
    getDiagnosticsSummary,
};
