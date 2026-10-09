import React, { useState, useEffect } from 'react';
import { sanitizeText } from '../utils/sanitizeText';
import { hashString } from '../utils/colors';
import './AppIcon.css';

// Module-level error cache — prevents re-requesting favicons that already 404'd this session.
// Keyed by NORMALIZED domain (not the raw siteName) so "Reddit.com" and "reddit.com"
// share one entry. Intentionally NOT persisted: if the user was offline, domains
// clear on restart.
const faviconErrorCache = new Set();

// ── Privacy gate ──────────────────────────────────────────────────────────────
// Deskly is privacy-first. Fetching a favicon from a third party (Google's favicon
// API) would disclose every domain the user visits — IP, referrer, timing — to that
// third party. That directly contradicts the product promise, so remote favicons are
// OFF by default and must be explicitly enabled by the user in Settings → Privacy.
// The preference is read synchronously from localStorage so this component stays pure
// and render-synchronous (favicons appear in long, fast-scrolling lists).
export function remoteFaviconsAllowed() {
    try {
        return localStorage.getItem('deskly_remoteFavicons') === 'true';
    } catch {
        return false; // storage blocked → fail closed (private)
    }
}

// Normalize a raw site name to a canonical domain label used as the single key for
// the favicon URL AND the error cache, so casing/whitespace never fragments dedup.
function normalizeDomain(name) {
    if (!name) return '';
    return name.toLowerCase().trim().split('/')[0].split('?')[0];
}

/**
 * WebsiteIcon Component
 * Displays website favicons with a shimmer loading state and a deterministic
 * letter/color fallback for invalid, failed, or privacy-suppressed domains.
 */
export default function WebsiteIcon({
    siteName,
    size = 40,
    className = ''
}) {
    const domainKey = normalizeDomain(siteName);
    const [imgError, setImgError] = useState(() => faviconErrorCache.has(domainKey));
    const [imgLoaded, setImgLoaded] = useState(false);

    // Reset per-item load state when the site changes — otherwise a recycled
    // component instance (list re-order / virtualization) inherits the previous
    // site's imgLoaded/imgError and flashes the wrong favicon.
    useEffect(() => {
        setImgError(faviconErrorCache.has(domainKey));
        setImgLoaded(false);
    }, [domainKey]);

    const handleImgError = () => {
        if (domainKey) faviconErrorCache.add(domainKey);
        setImgError(true);
    };

    const handleImgLoad = () => {
        setImgLoaded(true);
    };

    // Check if name is a valid domain (not a sentence or title)
    const isValidDomain = (name) => {
        if (!name) return false;
        const clean = name.toLowerCase().trim();

        // Must have a dot, be reasonably short, and not have spaces
        if (!clean.includes('.') || clean.includes(' ') || clean.length > 100) {
            return false;
        }

        // Structural check: label(.label)+ with a 2+ char final TLD. This replaces the
        // old hand-maintained TLD allowlist, which silently hid favicons for valid but
        // unlisted TLDs (.gov.uk, .eu, new gTLDs, …).
        return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(clean);
    };

    // Get short name for fallback (first 2 letters of domain)
    const getShortName = (name) => {
        if (!name) return '?';
        const cleanName = name.toLowerCase().trim();

        if (isValidDomain(cleanName)) {
            const parts = cleanName.split('.');
            return parts[0].substring(0, 2).toUpperCase();
        }

        const alphaOnly = cleanName.replace(/[^a-z]/g, '');
        return (alphaOnly.substring(0, 2) || cleanName.substring(0, 2)).toUpperCase();
    };

    // Build a safe favicon URL — only when the user has opted in AND the domain is valid.
    const getFaviconUrl = (name) => {
        if (!remoteFaviconsAllowed()) return null; // privacy gate — default OFF
        if (!name) return null;
        const cleanName = name.toLowerCase().trim();

        if (!isValidDomain(cleanName)) return null;

        const domainOnly = normalizeDomain(cleanName);
        // sz=128 gives 2× resolution so favicons stay crisp at 36–40px display size
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainOnly)}&sz=128`;
    };

    // Deterministic color based on name hash
    const getColor = (name) => {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
            '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
            '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
            '#FF8C42', '#06D6A0', '#7B68EE', '#E17055'
        ];
        if (!name) return colors[0];
        return colors[hashString(name) % colors.length];
    };

    const containerStyle = {
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
    };

    const faviconUrl = getFaviconUrl(siteName);
    // Tooltip text is untrusted (a page-supplied name) — strip bidi/zero-width so a
    // hostile title can't spoof what the hover reveals.
    const safeTitle = sanitizeText(siteName) || undefined;

    // Shared rounded-square container style — matches AppIcon's visual language
    const iconContainerStyle = {
        ...containerStyle,
        borderRadius: size <= 20 ? 5 : 10,
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    };

    // Show favicon for valid domains — with shimmer while the network image loads
    if (faviconUrl && !imgError) {
        return (
            <div
                className={`app-icon${!imgLoaded ? ' app-icon-loading' : ''} ${className}`}
                style={iconContainerStyle}
                title={safeTitle}
            >
                <img
                    src={faviconUrl}
                    alt=""
                    aria-hidden="true"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    style={{
                        width: '62%',
                        height: '62%',
                        objectFit: 'contain',
                        opacity: imgLoaded ? 1 : 0,
                        transition: 'opacity 0.15s ease',
                        imageRendering: 'auto',
                    }}
                    onError={handleImgError}
                    onLoad={handleImgLoad}
                />
            </div>
        );
    }

    // Letter fallback for non-domains, failed favicons, or privacy-suppressed remote icons
    const shortName = getShortName(siteName);

    return (
        <div
            className={`app-icon app-icon-letter ${className}`}
            style={{
                ...containerStyle,
                background: getColor(siteName),
                fontSize: size * 0.35,
                borderRadius: size <= 20 ? 5 : 10,
            }}
            title={safeTitle}
        >
            <span aria-hidden="true">{shortName}</span>
        </div>
    );
}
