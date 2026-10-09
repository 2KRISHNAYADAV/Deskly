const { getDailySummary, getAppCategory, getAppDisplayName, getToday } = require('../database/db');
const { getUnifiedTodayStats, getUnifiedWeeklyStats, getUnifiedAppUsage, getBrowserBreakdown: getUnifiedBrowserBreakdown } = require('../services/unified-stats');

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    // Use local date string (YYYY-MM-DD)
    return date.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

// Helper to normalize the dataset (handle legacy vs new structure)
function getUsageData(summary) {
    if (!summary) return {};
    // If we have an aggregates object (New Session Architecture), use it.
    // Otherwise fallback to the summary root (Old Counter Architecture).
    return summary.aggregates || summary;
}

/**
 * Get today's stats - NOW USES UNIFIED SERVICE
 * This ensures Dashboard, AppUsage, and all other screens get the same data
 */
async function getTodayStats() {
    // Use the unified stats service for consistent data across all screens
    return getUnifiedTodayStats();
}


/**
 * Get weekly stats - NOW USES UNIFIED SERVICE
 */
async function getWeeklyStats() {
    return getUnifiedWeeklyStats();
}


/**
 * Get app usage - NOW USES UNIFIED SERVICE
 */
async function getAppUsage(options = {}) {
    return getUnifiedAppUsage(options);
}

/**
 * Get browser breakdown - websites grouped by their parent browser
 * This ensures website time is always in sync with browser app time
 */
async function getBrowserBreakdown() {
    return getUnifiedBrowserBreakdown();
}


module.exports = {
    getTodayStats,
    getWeeklyStats,
    getAppUsage,
    getBrowserBreakdown,
    formatDuration,
};
