/**
 * Deskly - Unified Color System
 * Use these constants for inline styles in JSX
 * CSS variables in colors.css should match these values
 */

// Primary brand color - Indigo
export const PRIMARY = '#818CF8';
export const PRIMARY_LIGHT = '#A5B4FC';
export const PRIMARY_DARK = '#6366F1';
export const PRIMARY_CONTAINER = 'rgba(129, 140, 248, 0.15)';

// Semantic colors
export const SUCCESS = '#22C55E';
export const SUCCESS_CONTAINER = 'rgba(34, 197, 94, 0.15)';

export const WARNING = '#FBBF24';
export const WARNING_CONTAINER = 'rgba(251, 191, 36, 0.15)';

export const ERROR = '#EF4444';
export const ERROR_CONTAINER = 'rgba(239, 68, 68, 0.15)';

export const INFO = '#3B82F6';
export const INFO_CONTAINER = 'rgba(59, 130, 246, 0.15)';

// Accent colors for variety (charts, categories, etc.)
export const ACCENT = {
    purple: '#A855F7',
    pink: '#EC4899',
    orange: '#F97316',
    teal: '#14B8A6',
    cyan: '#06B6D4',
    yellow: '#EAB308',
};

// Browser brand colors
export const BROWSER_COLORS = {
    // Mainstream
    brave: '#FB542B',
    chrome: '#4285F4',
    edge: '#0078D7',
    msedge: '#0078D7',
    firefox: '#FF7139',
    safari: '#006CFF',
    opera: '#FF1B2D',
    vivaldi: '#EF3939',
    // AI/Modern browsers
    comet: '#20B2AA',      // Perplexity's Comet - teal/turquoise
    arc: '#FF6B6B',        // Arc browser - coral
    sigmaos: '#7C3AED',    // SigmaOS - purple
    sidekick: '#10B981',   // Sidekick - emerald
    // Privacy-focused
    tor: '#7D4698',        // Tor - purple
    librewolf: '#00ACFF',  // LibreWolf - light blue
    waterfox: '#00AEF0',   // Waterfox - blue
    mullvad: '#294D4A',    // Mullvad - dark teal
    floorp: '#FF7043',     // Floorp - deep orange
    zen: '#6366F1',        // Zen browser - indigo
    // Regional
    whale: '#4CAF50',      // Naver Whale - green
    yandex: '#FF0000',     // Yandex - red
    samsung: '#1428A0',    // Samsung Internet - blue
    // Other
    maxthon: '#136FE2',    // Maxthon - blue  
    midori: '#4CAF50',     // Midori - green
    falkon: '#2196F3',     // Falkon - blue
    thorium: '#6D28D9',    // Thorium - purple
    cent: '#2563EB',       // Cent Browser - blue
    ghostbrowser: '#1F2937', // Ghost Browser - dark
    polypane: '#5046E5',   // Polypane - indigo
};

// Get browser color by process name
export function getBrowserColor(processName) {
    const lower = processName?.toLowerCase() || '';
    for (const [key, color] of Object.entries(BROWSER_COLORS)) {
        if (lower.includes(key)) return color;
    }
    return PRIMARY; // Default to primary if unknown
}

// Category preset colors (match index.css --cat-* variables)
export const CATEGORY_COLORS = {
    productivity: '#22C55E',
    social: '#EC4899',
    entertainment: '#F59E0B',
    browsing: '#38BDF8',
    gaming: '#A855F7',
    system: '#64748B',
    other: '#6B7280',
};

// App color palette for charts (deterministic based on name)
export const APP_COLORS = [
    '#F87171', '#FB923C', '#FACC15', '#4ADE80',
    '#2DD4BF', '#38BDF8', '#818CF8', '#C084FC', '#F472B6'
];

// Shared fallback palette for categories (used by CategoriesPage + ReportsPage
// so an uncolored category renders the same swatch on both screens)
export const CATEGORY_FALLBACK_PALETTE = [
    '#0D9488', '#34d399', '#f472b6', '#38bdf8', '#fbbf24', '#2DD4BF', '#f97316', '#fb7185'
];

// Single djb2-style string hash used everywhere a name needs to map
// deterministically to a palette entry, so the same name always produces
// the same color regardless of which screen/component looks it up.
export function hashString(str) {
    const s = String(str ?? '');
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
}

// Deterministically pick a color from any palette based on a name/id.
export function colorFromPalette(str, palette) {
    if (!palette || palette.length === 0) return PRIMARY;
    return palette[hashString(str) % palette.length];
}

export function getAppColor(appName) {
    // Null-safe: an unnamed process (null/undefined/non-string) must not throw and
    // white-screen every chart that calls this.
    return colorFromPalette(appName, APP_COLORS);
}

// Glass effect styles (for inline use)
export const GLASS = {
    background: 'rgba(30, 34, 48, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '32px',
};

// Icon container helper
export function iconContainerStyle(color, size = 48) {
    return {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${Math.round(size * 0.29)}px`,
        background: color + '26', // 15% opacity
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    };
}

// Default export for convenience
export default {
    PRIMARY,
    PRIMARY_LIGHT,
    PRIMARY_DARK,
    PRIMARY_CONTAINER,
    SUCCESS,
    SUCCESS_CONTAINER,
    WARNING,
    WARNING_CONTAINER,
    ERROR,
    ERROR_CONTAINER,
    INFO,
    INFO_CONTAINER,
    ACCENT,
    BROWSER_COLORS,
    CATEGORY_COLORS,
    CATEGORY_FALLBACK_PALETTE,
    APP_COLORS,
    getBrowserColor,
    getAppColor,
    hashString,
    colorFromPalette,
    iconContainerStyle,
    GLASS,
};

