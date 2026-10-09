/**
 * Safe localStorage wrapper - localStorage can throw (private/incognito quota,
 * disabled storage, corrupted profile), so every call is wrapped to degrade
 * gracefully instead of crashing the caller.
 */

export function safeGetItem(key, fallback = null) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

export function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

export function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}
