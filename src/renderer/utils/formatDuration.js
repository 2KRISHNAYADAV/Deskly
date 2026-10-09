/**
 * Single source of truth for human-readable durations across Deskly.
 *
 * Rules (consistent everywhere):
 *   0 seconds        → "0m"
 *   1–59 seconds     → "< 1m"
 *   whole minutes    → "45m"
 *   hours + minutes  → "1h 9m"
 *   exact hours      → "2h"   (trailing " 0m" is collapsed)
 */
export function formatDuration(seconds) {
    // Guard non-finite / invalid input (NaN, Infinity, strings, null) so a corrupt
    // duration renders as "0m" rather than "Infinityh" or "NaNm".
    const n = Number(seconds);
    const s = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    if (s === 0) return '0m';
    if (s < 60) return '< 1m';

    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);

    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

/** Same formatting, but the input is in minutes (used by App Limits). */
export function formatMinutes(minutes) {
    const n = Number(minutes);
    return formatDuration((Number.isFinite(n) ? n : 0) * 60);
}

/** Decimal hours, e.g. "1.5" — used by Reports for axis/summary labels. */
export function formatHoursDecimal(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return '0';
    return (n / 3600).toFixed(1);
}
