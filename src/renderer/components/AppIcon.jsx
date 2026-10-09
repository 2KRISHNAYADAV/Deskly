import React, { useState, useEffect } from 'react';
import { sanitizeText } from '../utils/sanitizeText';
import { hashString } from '../utils/colors';
import './AppIcon.css';

// Module-level caches — survive component unmount/remount and page navigation
const iconCache = new Map();   // cacheKey → iconData object
const inFlightMap = new Map(); // cacheKey → Promise<iconData> (deduplicates concurrent fetches)

// Normalize app name to a consistent cache key (strip .exe, lowercase)
function normalizeKey(appName) {
    if (typeof appName !== 'string' || !appName) return '';
    return appName.toLowerCase().replace(/\.exe$/i, '');
}

/**
 * AppIcon Component
 *
 * Design goals:
 * 1. Zero loading flash for already-cached icons (synchronous render from Map)
 * 2. Deduplication — if N components request the same app simultaneously,
 *    only ONE IPC call is made; all waiters share the same Promise.
 * 3. Graceful fallback to a deterministic letter/color avatar on any failure.
 */
// React.memo: AppIcon appears in lists of up to 20. Without memo, every stats
// push from App.jsx (every 3s) re-renders all 20 even when appName/size unchanged.
// Cache key + size are both stable across stat pushes, so memo hits 100%.
const AppIcon = React.memo(function AppIcon({
    appName,
    size = 40,
    className = '',
    showTooltip = false
}) {
    const cacheKey = normalizeKey(appName);
    // Untrusted process name — sanitize before it reaches title/alt attributes.
    const safeName = sanitizeText(appName);

    // Minimal state: just a counter to trigger re-render after the cache is populated.
    // Actual icon data is read synchronously from the module-level Map each render —
    // this means a cache hit never shows a loading shimmer, even after prop changes.
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        if (!cacheKey) {
            // No app name — populate cache with fallback so next render shows it immediately
            iconCache.set(cacheKey, getFallbackIcon(appName));
            forceUpdate(n => n + 1);
            return;
        }

        // Already in cache — nothing to do, render reads it synchronously
        if (iconCache.has(cacheKey)) return;

        let mounted = true;

        // Deduplicate: if another instance is already fetching this key, share its Promise
        if (!inFlightMap.has(cacheKey)) {
            const promise = (async () => {
                if (!window.electronAPI?.getAppIcon) {
                    return getFallbackIcon(appName);
                }
                try {
                    const result = await window.electronAPI.getAppIcon(appName);
                    return result || getFallbackIcon(appName);
                } catch {
                    return getFallbackIcon(appName);
                }
            })();
            inFlightMap.set(cacheKey, promise);
            // Clean up the in-flight entry once the promise settles
            promise.finally(() => inFlightMap.delete(cacheKey));
        }

        inFlightMap.get(cacheKey).then(result => {
            iconCache.set(cacheKey, result);
            if (mounted) forceUpdate(n => n + 1);
        });

        return () => { mounted = false; };
    }, [cacheKey]); // re-runs only when the app name changes

    // Synchronous read — O(1) Map lookup, zero async latency for cached icons
    const iconData = iconCache.get(cacheKey) ?? null;

    const containerStyle = {
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
    };

    // Loading state (only shown for brand-new, never-seen apps)
    if (!iconData) {
        return (
            <div
                className={`app-icon app-icon-loading ${className}`}
                style={containerStyle}
                title={showTooltip ? safeName : undefined}
            />
        );
    }

    // Native Windows icon
    if (iconData.type === 'native' && iconData.dataUri) {
        return (
            <div
                className={`app-icon app-icon-native ${className}`}
                style={containerStyle}
                title={showTooltip ? safeName : undefined}
            >
                <img
                    src={iconData.dataUri}
                    alt={safeName}
                    className="app-icon-img"
                    onError={() => {
                        // Replace with fallback if the data URI is somehow corrupt
                        const fallback = getFallbackIcon(appName);
                        iconCache.set(cacheKey, fallback);
                        forceUpdate(n => n + 1);
                    }}
                />
            </div>
        );
    }

    // Letter fallback
    return (
        <div
            className={`app-icon app-icon-letter ${className}`}
            style={{
                ...containerStyle,
                background: iconData.color || '#6b7280',
                fontSize: size * 0.4,
            }}
            title={showTooltip ? safeName : undefined}
        >
            {iconData.letter || '?'}
        </div>
    );
}); // end React.memo

export default AppIcon;

/**
 * Get fallback letter icon (client-side)
 * Deterministic: the same appName always produces the same letter + color.
 */
function getFallbackIcon(appName) {
    const name = typeof appName === 'string' ? appName : '';
    const letter = name ? name.charAt(0).toUpperCase() : '?';
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
        '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
        '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
    ];
    const colorIndex = name ? hashString(name) % colors.length : 0;

    return {
        type: 'letter',
        letter,
        color: colors[colorIndex]
    };
}
