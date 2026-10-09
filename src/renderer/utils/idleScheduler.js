/**
 * Safe idle callback scheduling helper
 */

export function runWhenBrowserIdle(task, timeout = 1000) {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        return window.requestIdleCallback(task, { timeout });
    }
    return setTimeout(task, 200);
}

export function cancelIdleTask(id) {
    if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(id);
    } else {
        clearTimeout(id);
    }
}
