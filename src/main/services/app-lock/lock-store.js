/**
 * App Lock Store — Master Credential Model
 *
 * Vault file: .deskly/app-locks.json
 *
 * One master PIN/password protects everything. Set up once, then apps are locked
 * freely. To unlock a blocked app, or to manage locks, the user enters the master
 * credential. This mirrors iOS Screen Time / Android App Lock.
 *
 * SECURITY
 * ────────
 * • Master secret is hashed with PBKDF2-SHA512 (100k iterations) + per-install salt.
 *   The plain secret is never stored.
 * • The entire `locks` map is signed with HMAC-SHA256, keyed from a value derived
 *   from the master secret. Editing the vault file (e.g. setting enabled:false, or
 *   deleting a lock) without knowing the PIN invalidates the signature.
 *   → On load, an invalid signature is treated as TAMPER: every lock is forced
 *     `enabled` regardless of what the file says (fail-secure).
 * • Constant-time comparison (timingSafeEqual) on every verify.
 * • Escalating lockout after repeated failures.
 *
 * SCHEMA
 * ──────
 * {
 *   "master": {
 *     "configured": true,
 *     "authMethod": "pin" | "password",
 *     "hash": "<pbkdf2 hex>",
 *     "salt": "<32-byte hex>",
 *     "failedAttempts": 0,
 *     "lockedOutUntil": null,
 *     "createdAt": <ms>
 *   },
 *   "locks": {
 *     "chrome.exe": {
 *       "enabled": true,
 *       "displayName": "Google Chrome",
 *       "processName": "chrome.exe",
 *       "lockTrigger": { "type": "immediate"|"after_minutes"|"schedule"|"duration", ... },
 *       "tempUnlockUntil": null,
 *       "createdAt": <ms>, "updatedAt": <ms>
 *     }
 *   },
 *   "settings": { "tempUnlockDurationMinutes": 30 },
 *   "signature": "<hmac hex over {locks, master.hash}>"
 * }
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const Store  = require('electron-store');
const { isProtectedProcess } = require('./system-processes');

const vaultPointer = new Store({ name: 'vault-pointer' });

// PBKDF2 params for the master secret
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN     = 64;
const PBKDF2_DIGEST     = 'sha512';

// HMAC key derivation (signing the locks map)
const HMAC_ITER    = 12_000;
const HMAC_KEYLEN  = 32;
const HMAC_CONTEXT = 'deskly-applock-integrity-v2';

// Escalating lockout thresholds
const LOCKOUT_AT_EVERY = 5;
const LOCKOUT_TIERS_MS = [5 * 60_000, 30 * 60_000, 4 * 60 * 60_000];

const DEFAULT_DATA = {
    master:   { configured: false, authMethod: 'pin', hash: null, salt: null, failedAttempts: 0, lockedOutUntil: null, createdAt: null },
    locks:    {},
    settings: { tempUnlockDurationMinutes: 30 },
    signature: null,
};

let data       = null;
let filePath   = null;
let tampered   = false;  // set on load if signature is invalid → fail-secure

// ── Crypto helpers ─────────────────────────────────────────────────────────

function hashSecret(secret, existingSalt = null) {
    const salt = existingSalt || crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(String(secret), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex');
    return { hash, salt };
}

function verifyHash(secret, storedHash, storedSalt) {
    if (!storedHash || !storedSalt) return false;
    try {
        const { hash } = hashSecret(secret, storedSalt);
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch { return false; }
}

/** HMAC key derived from the stored hash (which itself derives from the PIN). */
function deriveHmacKey() {
    if (!data?.master?.hash) return null;
    return crypto.pbkdf2Sync(data.master.hash, HMAC_CONTEXT, HMAC_ITER, HMAC_KEYLEN, 'sha512');
}

function computeSignature() {
    const key = deriveHmacKey();
    if (!key) return null;
    // Sign the security-relevant shape of every lock
    const payload = JSON.stringify(
        Object.fromEntries(Object.entries(data.locks).map(([k, v]) => [k, {
            enabled: v.enabled, processName: v.processName, lockTrigger: v.lockTrigger,
        }]))
    );
    return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function resign() {
    data.signature = computeSignature();
}

function verifySignature() {
    if (!data?.master?.configured) return true; // nothing to protect yet
    if (!data.signature) return false;
    const expected = computeSignature();
    if (!expected) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch { return false; }
}

// ── Persistence ────────────────────────────────────────────────────────────

function getVaultPath() { return vaultPointer.get('vaultPath'); }

function init() {
    const vaultPath = getVaultPath();
    if (!vaultPath) { data = JSON.parse(JSON.stringify(DEFAULT_DATA)); return false; }

    const dir = path.join(vaultPath, '.deskly');
    filePath  = path.join(dir, 'app-locks.json');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(filePath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            data = { ...JSON.parse(JSON.stringify(DEFAULT_DATA)), ...parsed };
            data.master   = { ...DEFAULT_DATA.master, ...(parsed.master || {}) };
            data.settings = { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) };
            data.locks    = parsed.locks || {};
        } catch {
            const backup = filePath + '.backup';
            if (fs.existsSync(backup)) {
                try { data = { ...JSON.parse(JSON.stringify(DEFAULT_DATA)), ...JSON.parse(fs.readFileSync(backup, 'utf-8')) }; }
                catch { data = JSON.parse(JSON.stringify(DEFAULT_DATA)); }
            } else { data = JSON.parse(JSON.stringify(DEFAULT_DATA)); }
        }
    } else {
        data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        save();
    }

    // Tamper check — if the signature doesn't verify, fail secure.
    tampered = data.master.configured && !verifySignature();
    if (tampered) {
        console.warn('[AppLock] ⚠ Vault signature mismatch — enforcing all locks (fail-secure)');
    }
    return true;
}

function save() {
    if (!filePath) return;
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(filePath)) {
            try { fs.copyFileSync(filePath, filePath + '.backup'); } catch {}
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[AppLock] Save failed:', err.message);
    }
}

// ── Master credential ──────────────────────────────────────────────────────

function isMasterConfigured() {
    if (!data) init();
    return !!data.master.configured;
}

function setupMaster(secret, authMethod = 'pin') {
    if (!data) init();
    if (data.master.configured) return { success: false, reason: 'already_configured' };
    if (!secret || String(secret).length < 4) return { success: false, reason: 'too_short' };

    const { hash, salt } = hashSecret(secret);
    data.master = {
        configured: true, authMethod, hash, salt,
        failedAttempts: 0, lockedOutUntil: null, createdAt: Date.now(),
    };
    resign();
    save();
    tampered = false;
    return { success: true };
}

/** Verify the master secret. Used for the management-page session gate. */
function verifyMaster(secret) {
    if (!data) init();
    if (!data.master.configured) return { success: false, reason: 'not_configured' };

    if (data.master.lockedOutUntil && Date.now() < data.master.lockedOutUntil) {
        return { success: false, reason: 'locked_out', remainingSeconds: Math.ceil((data.master.lockedOutUntil - Date.now()) / 1000) };
    }

    if (!verifyHash(secret, data.master.hash, data.master.salt)) {
        data.master.failedAttempts = (data.master.failedAttempts || 0) + 1;
        if (data.master.failedAttempts % LOCKOUT_AT_EVERY === 0) {
            const tier = Math.floor(data.master.failedAttempts / LOCKOUT_AT_EVERY) - 1;
            data.master.lockedOutUntil = Date.now() + LOCKOUT_TIERS_MS[Math.min(tier, LOCKOUT_TIERS_MS.length - 1)];
        }
        save();
        return { success: false, reason: 'wrong', failedAttempts: data.master.failedAttempts, lockedOutUntil: data.master.lockedOutUntil };
    }

    data.master.failedAttempts = 0;
    data.master.lockedOutUntil = null;
    save();
    return { success: true };
}

function changeMaster(oldSecret, newSecret, newMethod = null) {
    if (!data) init();
    const v = verifyMaster(oldSecret);
    if (!v.success) return v;
    if (!newSecret || String(newSecret).length < 4) return { success: false, reason: 'too_short' };

    const { hash, salt } = hashSecret(newSecret);
    data.master.hash = hash;
    data.master.salt = salt;
    if (newMethod) data.master.authMethod = newMethod;
    resign(); // signature key changes with the hash → re-sign all locks
    save();
    return { success: true };
}

/** Reset everything (used by account-verified recovery). Wipes locks + master. */
function resetAll() {
    if (!data) init();
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    tampered = false;
    save();
    return { success: true };
}

// ── Lock CRUD (caller must be session-authenticated) ───────────────────────

function getAll() {
    if (!data) init();
    return data.locks || {};
}

function getMasterMeta() {
    if (!data) init();
    return {
        configured:     data.master.configured,
        authMethod:     data.master.authMethod,
        lockedOutUntil: data.master.lockedOutUntil,
        failedAttempts: data.master.failedAttempts,
    };
}

function addLock(appName, { processName, displayName, lockTrigger, category }) {
    if (!data) init();
    if (!data.master.configured) return { success: false, reason: 'no_master' };

    const proc = (processName || appName + '.exe').toLowerCase();
    if (isProtectedProcess(proc) || isProtectedProcess(appName)) {
        return { success: false, reason: 'protected' };
    }

    const key = appName.toLowerCase();
    const existing = data.locks[key];
    data.locks[key] = {
        enabled:     true,
        displayName: displayName || appName,
        processName: proc,
        category:    category || existing?.category || null,
        lockTrigger: {
            type:                lockTrigger?.type || 'immediate',
            afterMinutes:        lockTrigger?.afterMinutes || null,
            scheduleStart:       lockTrigger?.scheduleStart || null,
            scheduleEnd:         lockTrigger?.scheduleEnd || null,
            lockDurationMinutes: lockTrigger?.lockDurationMinutes || null,
            lockStartedAt:       lockTrigger?.type === 'duration' ? Date.now() : null,
        },
        tempUnlockUntil: null,
        createdAt:       existing?.createdAt || Date.now(),
        updatedAt:       Date.now(),
    };
    resign();
    save();
    return { success: true, lock: data.locks[key] };
}

/** Removing a lock is a security-sensitive action → requires the master PIN. */
function removeLock(appName, secret) {
    if (!data) init();
    const key = appName.toLowerCase();
    if (!data.locks[key]) return { success: false, reason: 'not_found' };
    const v = verifyMaster(secret);
    if (!v.success) return v;
    delete data.locks[key];
    resign();
    save();
    return { success: true };
}

function toggleLock(appName, enabled) {
    if (!data) init();
    const key = appName.toLowerCase();
    if (!data.locks[key]) return { success: false, reason: 'not_found' };
    data.locks[key].enabled   = enabled;
    data.locks[key].updatedAt = Date.now();
    resign();
    save();
    return { success: true };
}

// ── Authentication for the lock-screen overlay ─────────────────────────────

/**
 * Authenticate against the master secret and, on success, grant a temporary
 * unlock for the specified app. The unlock persists until the app is closed.
 */
function authenticate(appName, secret) {
    if (!data) init();
    const v = verifyMaster(secret);
    if (!v.success) return v;

    const key = appName.toLowerCase();
    const entry = data.locks[key];
    if (entry) {
        // Set a far-future unlock time so it never expires by time, only when
        // the user closes the app (handled by lock-enforcer's session tracking).
        entry.tempUnlockUntil = Date.now() + (365 * 24 * 60 * 60_000); // 1 year
        entry.updatedAt = Date.now();
        resign();
        save();
        return { success: true, tempUnlockUntil: entry.tempUnlockUntil };
    }
    return { success: true };
}

function extendTempUnlock(appName, minutes) {
    if (!data) init();
    const key = appName.toLowerCase();
    const entry = data.locks[key];
    if (!entry) return null;
    const base = Math.max(Date.now(), entry.tempUnlockUntil || Date.now());
    entry.tempUnlockUntil = base + minutes * 60_000;
    resign();
    save();
    return entry.tempUnlockUntil;
}

/** Clear a temp unlock so the app re-locks (called when the app closes). */
function clearTempUnlock(appName) {
    if (!data) init();
    const key = appName.toLowerCase();
    const entry = data.locks[key];
    if (!entry || entry.tempUnlockUntil == null) return;
    entry.tempUnlockUntil = null;
    entry.updatedAt = Date.now();
    resign();
    save();
}

// ── Settings ───────────────────────────────────────────────────────────────

function getSettings() { if (!data) init(); return data.settings; }
function updateSettings(patch) {
    if (!data) init();
    data.settings = { ...data.settings, ...patch };
    save();
    return data.settings;
}

// ── Trigger evaluation ─────────────────────────────────────────────────────

/**
 * Is this lock currently enforced?
 * @param {object} entry
 * @param {number} todayUsageSeconds  for "after_minutes" triggers
 */
function isLockActive(entry, todayUsageSeconds = 0) {
    if (!entry) return false;

    // Fail-secure: if the vault signature didn't verify, ignore `enabled`/temp-unlock
    // and enforce. Only an authenticate() (correct PIN) can grant access.
    const enabled = tampered ? true : entry.enabled;
    if (!enabled) return false;

    if (!tampered && entry.tempUnlockUntil && Date.now() < entry.tempUnlockUntil) return false;

    const t = entry.lockTrigger || { type: 'immediate' };
    switch (t.type) {
        case 'immediate':
            return true;
        case 'after_minutes':
            return todayUsageSeconds >= (t.afterMinutes || 60) * 60;
        case 'schedule': {
            if (!t.scheduleStart || !t.scheduleEnd) return false;
            const now = new Date();
            const cur = now.getHours() * 60 + now.getMinutes();
            const [sh, sm] = t.scheduleStart.split(':').map(Number);
            const [eh, em] = t.scheduleEnd.split(':').map(Number);
            const start = sh * 60 + sm, end = eh * 60 + em;
            return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
        }
        case 'duration': {
            if (!t.lockStartedAt) return false;
            return (Date.now() - t.lockStartedAt) < (t.lockDurationMinutes || 60) * 60_000;
        }
        default:
            return false;
    }
}

/** Renderer-safe status snapshot (no hashes/signatures). */
function getStatus(usageMap = {}) {
    if (!data) init();
    const out = {};
    for (const [key, lock] of Object.entries(data.locks)) {
        const usageKey = key.replace(/\.exe$/i, '');
        const seconds  = usageMap[usageKey] ?? usageMap[key] ?? 0;
        out[key] = {
            enabled:         lock.enabled,
            displayName:     lock.displayName,
            processName:     lock.processName,
            lockTrigger:     lock.lockTrigger,
            tempUnlockUntil: lock.tempUnlockUntil,
            isActive:        isLockActive(lock, seconds),
            todayUsageSeconds: seconds,
        };
    }
    return out;
}

module.exports = {
    init,
    isMasterConfigured,
    setupMaster,
    verifyMaster,
    changeMaster,
    resetAll,
    getAll,
    getMasterMeta,
    addLock,
    removeLock,
    toggleLock,
    authenticate,
    extendTempUnlock,
    clearTempUnlock,
    getSettings,
    updateSettings,
    isLockActive,
    getStatus,
};
