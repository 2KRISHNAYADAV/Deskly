/**
 * App Icon Service - Windows Shell API Method
 * 
 * Extracts icons using PowerShell script that handles:
 * - Win32 apps (traditional .exe)
 * - UWP/Microsoft Store apps
 * - PWAs (Chrome/Edge web apps)
 * - Known app path lookups
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const iconStore = new Store({ name: 'app-icons-cache' });

function resolveIconExtractorScriptPath() {
    const candidates = [
        // Packaged build (copied via build.extraFiles)
        path.join(process.resourcesPath || '', 'scripts', 'icon-extractor.ps1'),
        // Dev build (run from source tree)
        path.join(__dirname, '..', 'scripts', 'icon-extractor.ps1')
    ];

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

const SCRIPT_PATH = resolveIconExtractorScriptPath();

// ── In-process icon cache ────────────────────────────────────────────────
// Each entry is a base64-encoded PNG (~5-40 KB each).  We cap at 100
// entries (~1-2 MB worst case) using a simple insertion-order Map so the
// oldest, least-recently-seen entries are evicted when the cap is reached.
const ICON_CACHE_MAX = 100;
const iconCacheMap = new Map(Object.entries(iconStore.get('icons', {})));

// Helpers to treat the Map as an LRU cache
function cacheGet(key) {
    if (!iconCacheMap.has(key)) return undefined;
    // Move to tail (most-recently-used) by delete+re-set
    const val = iconCacheMap.get(key);
    iconCacheMap.delete(key);
    iconCacheMap.set(key, val);
    return val;
}
function cacheSet(key, value) {
    if (iconCacheMap.has(key)) iconCacheMap.delete(key); // refresh position
    iconCacheMap.set(key, value);
    // Evict oldest if over cap
    if (iconCacheMap.size > ICON_CACHE_MAX) {
        const oldest = iconCacheMap.keys().next().value;
        iconCacheMap.delete(oldest);
    }
}
// Legacy-compat shim: code that wrote to iconCache[key] now goes through cacheSet
const iconCache = new Proxy({}, {
    get(_, key) { return cacheGet(String(key)); },
    set(_, key, val) { cacheSet(String(key), val); return true; },
    deleteProperty(_, key) { iconCacheMap.delete(String(key)); return true; },
    has(_, key) { return iconCacheMap.has(String(key)); },
    ownKeys() { return [...iconCacheMap.keys()]; },
    getOwnPropertyDescriptor(_, key) {
        if (iconCacheMap.has(String(key))) return { configurable: true, enumerable: true, value: cacheGet(String(key)) };
        return undefined;
    },
});

// Track failed extractions to avoid repeated attempts
let failedExtractions = new Set(iconStore.get('failed', []));

// ── Debounced disk persistence ────────────────────────────────────────────
// Writing the full icon cache on every extraction wastes I/O.
// We batch all writes within a 2-second window instead.
let iconStoreFlushTimer = null;
let failedStoreFlushTimer = null;

function scheduleIconStoreSave() {
    if (iconStoreFlushTimer) clearTimeout(iconStoreFlushTimer);
    iconStoreFlushTimer = setTimeout(() => {
        iconStore.set('icons', Object.fromEntries(iconCacheMap));
        iconStoreFlushTimer = null;
    }, 2000);
}

function saveFailedCache() {
    if (failedStoreFlushTimer) clearTimeout(failedStoreFlushTimer);
    failedStoreFlushTimer = setTimeout(() => {
        iconStore.set('failed', Array.from(failedExtractions));
        failedStoreFlushTimer = null;
    }, 2000);
}

// System keys that should never have icons extracted
const SYSTEM_KEYS = ['sessions', 'aggregates', 'unlockcount', 'totalseconds'];

/**
 * Extract icon for an app using Windows Shell APIs
 */
function extractIcon(appName) {
    return new Promise((resolve) => {
        if (!appName) {
            resolve(null);
            return;
        }

        const cleanName = appName.toLowerCase().replace(/\.exe$/i, '');

        // Skip system/internal keys
        if (SYSTEM_KEYS.includes(cleanName)) {
            resolve(null);
            return;
        }

        // Check cache first
        if (iconCache[cleanName]) {
            resolve(iconCache[cleanName]);
            return;
        }

        // Skip if we've already failed for this app (avoid repeated slow lookups)
        if (failedExtractions.has(cleanName)) {
            resolve(null);
            return;
        }

        if (!SCRIPT_PATH) {
            console.log('⚠️ Icon extractor script not found, falling back to letter icons');
            failedExtractions.add(cleanName);
            saveFailedCache();
            resolve(null);
            return;
        }

        execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, '-AppName', cleanName],
            { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
            (error, stdout, stderr) => {
            if (error) {
                console.log(`⚠️ Icon extraction failed for ${cleanName}:`, error.message);
                failedExtractions.add(cleanName);
                saveFailedCache();
                resolve(null);
                return;
            }

            const result = stdout.trim();

            if (result && result.startsWith('data:image')) {
                // Success - cache it
                cacheSet(cleanName, result);
                scheduleIconStoreSave(); // batched write
                console.log(`✅ Extracted icon for: ${cleanName}`);
                resolve(result);
            } else {
                console.log(`⚠️ No icon found for: ${cleanName}`);
                failedExtractions.add(cleanName);
                saveFailedCache();
                resolve(null);
            }
            }
        );
    });
}

/**
 * Save failed extractions to disk (debounced — defined above near failedExtractions)
 */
// saveFailedCache is defined above with the debounce logic

/**
 * Get icon for an app (cached or extract)
 */
async function getAppIcon(appName) {
    if (!appName) {
        return getFallbackIcon(appName);
    }

    const cleanName = appName.toLowerCase().replace(/\.exe$/i, '');

    // Check cache
    if (iconCache[cleanName]) {
        return {
            type: 'native',
            dataUri: iconCache[cleanName]
        };
    }

    // Try to extract
    const dataUri = await extractIcon(cleanName);

    if (dataUri) {
        return {
            type: 'native',
            dataUri
        };
    }

    // Fallback
    return getFallbackIcon(appName);
}

/**
 * Get fallback letter icon
 */
function getFallbackIcon(appName) {
    const letter = appName ? appName.charAt(0).toUpperCase() : '?';
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
        '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
        '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
    ];
    const colorIndex = appName
        ? appName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
        : 0;

    return {
        type: 'letter',
        letter,
        color: colors[colorIndex]
    };
}

/**
 * Get all cached icons
 */
function getCachedIcons() {
    return iconCache;
}

/**
 * Clear icon cache
 */
function clearIconCache() {
    if (iconStoreFlushTimer) { clearTimeout(iconStoreFlushTimer); iconStoreFlushTimer = null; }
    if (failedStoreFlushTimer) { clearTimeout(failedStoreFlushTimer); failedStoreFlushTimer = null; }
    iconCacheMap.clear();
    failedExtractions = new Set();
    iconStore.set('icons', {});
    iconStore.set('failed', []);
    console.log('🗑️ Icon cache cleared (including failed extractions)');
}

/**
 * Retry extraction for a specific app (clears from failed list)
 */
function retryIconExtraction(appName) {
    const cleanName = appName.toLowerCase().replace(/\.exe$/i, '');
    failedExtractions.delete(cleanName);
    iconCacheMap.delete(cleanName);
    saveFailedCache();
    scheduleIconStoreSave();
    return extractIcon(appName);
}

/**
 * Get extraction statistics
 */
function getIconStats() {
    return {
        cached: iconCacheMap.size,
        failed: failedExtractions.size,
        cachedApps: [...iconCacheMap.keys()],
        failedApps: Array.from(failedExtractions)
    };
}

/**
 * Pre-extract icons for multiple apps using bounded concurrency.
 * Up to 4 extractions run in parallel to speed up initial load
 * without hammering PowerShell with too many simultaneous processes.
 */
async function preExtractIcons(appNames) {
    const results = {};
    const CONCURRENCY = 4;
    const queue = [...appNames];

    async function worker() {
        while (queue.length > 0) {
            const name = queue.shift();
            if (name) results[name] = await getAppIcon(name);
        }
    }

    const workers = Array.from(
        { length: Math.min(CONCURRENCY, appNames.length) },
        worker
    );
    await Promise.all(workers);

    return results;
}

module.exports = {
    getAppIcon,
    extractIcon,
    getCachedIcons,
    clearIconCache,
    preExtractIcons,
    getFallbackIcon,
    retryIconExtraction,
    getIconStats
};
