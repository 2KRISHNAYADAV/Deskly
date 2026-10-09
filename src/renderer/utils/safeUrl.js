// ── URL / remote-resource safety helpers ─────────────────────────────────────
// The renderer must treat every URL as untrusted — whether it came from IPC, auth
// payloads, update metadata, or tracked data. A bare string handed to the OS shell
// (shell.openExternal) or into an <img src> is a real attack surface in Electron.

// Schemes we will ever hand to the OS. Anything else (file:, javascript:, data:,
// custom app schemes) is rejected.
const SAFE_EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:']);

// Hosts we trust to load a remote avatar/profile image from. Keep this tight — these
// are the identity providers Deskly actually uses.
const TRUSTED_IMAGE_HOSTS = [
    'lh3.googleusercontent.com',
    'lh4.googleusercontent.com',
    'lh5.googleusercontent.com',
    'lh6.googleusercontent.com',
    'avatars.githubusercontent.com',
    'secure.gravatar.com',
    'www.gravatar.com',
];

function parse(url) {
    try {
        return new URL(String(url));
    } catch {
        return null;
    }
}

// Returns the URL string if it is safe to open in the OS browser, else null.
export function safeExternalUrl(url) {
    const u = parse(url);
    if (!u) return null;
    if (!SAFE_EXTERNAL_SCHEMES.has(u.protocol)) return null;
    return u.href;
}

// Returns the URL string if it is a trusted remote image, else null.
// Only https on an allow-listed host is accepted.
export function safeImageUrl(url) {
    const u = parse(url);
    if (!u) return null;
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    const ok = TRUSTED_IMAGE_HOSTS.some(h => host === h || host.endsWith('.' + h));
    return ok ? u.href : null;
}

// Open an external URL through the Electron bridge, but only if it passes validation.
// Returns true if the open was dispatched, false if the URL was rejected.
export function openExternalSafe(url) {
    const safe = safeExternalUrl(url);
    if (!safe) {
        console.warn('Blocked attempt to open unsafe external URL:', url);
        return false;
    }
    try {
        window.electronAPI?.openExternal?.(safe);
        return true;
    } catch (e) {
        console.error('Failed to open external URL:', e);
        return false;
    }
}
