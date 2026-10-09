/**
 * Data Consistency Validator for Deskly
 * 
 * Run this to verify that tracking data is consistent.
 * Usage: 
 *   node src/main/utils/validate-tracking.js              # Validate today
 *   node src/main/utils/validate-tracking.js 2026-01-24   # Validate specific date
 *   node src/main/utils/validate-tracking.js --week       # Validate last 7 days
 */

const fs = require('fs');
const path = require('path');

const VAULT_PATH = 'C:\\Hitesh_Codebase\\DW VAULT\\Deskly';

function getToday() {
    return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
}

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function validateData(date = getToday()) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('       Deskly - DATA CONSISTENCY CHECK');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`📅 Checking date: ${date}\n`);

    const month = date.substring(0, 7);
    const appDataPath = path.join(VAULT_PATH, 'data', `${month}.json`);
    const websiteDataPath = path.join(VAULT_PATH, 'data', 'websites', `${month}.json`);

    let errors = [];
    let warnings = [];

    // Load app data
    let appData = {};
    if (fs.existsSync(appDataPath)) {
        try {
            appData = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
        } catch (e) {
            errors.push(`❌ Failed to parse app data: ${e.message}`);
        }
    } else {
        warnings.push(`⚠️  App data file not found: ${appDataPath}`);
    }

    // Load website data
    let websiteData = {};
    if (fs.existsSync(websiteDataPath)) {
        try {
            websiteData = JSON.parse(fs.readFileSync(websiteDataPath, 'utf8'));
        } catch (e) {
            errors.push(`❌ Failed to parse website data: ${e.message}`);
        }
    } else {
        warnings.push(`⚠️  Website data file not found: ${websiteDataPath}`);
    }

    const dayAppData = appData[date] || {};
    const dayWebsiteData = websiteData[date] || {};
    const aggregates = dayAppData.aggregates || {};
    const byBrowser = dayWebsiteData.byBrowser || {};

    // Known browsers
    const browsers = [
        'chrome', 'brave', 'firefox', 'edge', 'opera', 'safari', 'arc', 'vivaldi',
        'comet', 'tor', 'waterfox', 'librewolf', 'floorp', 'zen', 'whale', 'yandex',
        'sidekick', 'sigmaos', 'maxthon', 'midori', 'falkon', 'chromium', 'msedge'
    ];

    console.log('📊 APP AGGREGATES:');
    console.log('─────────────────────────────────────────');
    let totalAppTime = 0;
    for (const [app, data] of Object.entries(aggregates)) {
        const seconds = data.totalSeconds || 0;
        totalAppTime += seconds;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        console.log(`  ${app.padEnd(20)} ${minutes}m ${secs}s (${seconds}s)`);
    }
    console.log(`─────────────────────────────────────────`);
    console.log(`  TOTAL: ${Math.floor(totalAppTime / 60)}m ${totalAppTime % 60}s\n`);

    console.log('🌐 BROWSER vs WEBSITE SYNC CHECK:');
    console.log('─────────────────────────────────────────');

    for (const browser of browsers) {
        const browserAppTime = aggregates[browser]?.totalSeconds || 0;
        const browserWebsiteTime = byBrowser[browser.charAt(0).toUpperCase() + browser.slice(1)] || 0;

        if (browserAppTime > 0 || browserWebsiteTime > 0) {
            const diff = Math.abs(browserAppTime - browserWebsiteTime);
            const syncStatus = diff <= 2 ? '✅' : diff <= 5 ? '⚠️' : '❌';
            
            console.log(`  ${browser.charAt(0).toUpperCase() + browser.slice(1)}:`);
            console.log(`    App time:     ${browserAppTime}s`);
            console.log(`    Website time: ${browserWebsiteTime}s`);
            console.log(`    Difference:   ${diff}s ${syncStatus}`);
            console.log();

            if (diff > 5) {
                errors.push(`❌ ${browser}: Browser/Website sync mismatch! App=${browserAppTime}s, Websites=${browserWebsiteTime}s (diff=${diff}s)`);
            } else if (diff > 2) {
                warnings.push(`⚠️  ${browser}: Minor sync difference of ${diff}s`);
            }
        }
    }

    // Check website totals
    const websiteTotalSeconds = dayWebsiteData.totalSeconds || 0;
    let calculatedTotal = 0;
    for (const browserTime of Object.values(byBrowser)) {
        calculatedTotal += browserTime;
    }

    if (websiteTotalSeconds !== calculatedTotal) {
        errors.push(`❌ Website totalSeconds (${websiteTotalSeconds}) doesn't match sum of byBrowser (${calculatedTotal})`);
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                      VALIDATION RESULT');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (warnings.length > 0) {
        console.log('⚠️  WARNINGS:');
        warnings.forEach(w => console.log(`  ${w}`));
        console.log();
    }

    if (errors.length > 0) {
        console.log('❌ ERRORS:');
        errors.forEach(e => console.log(`  ${e}`));
        console.log('\n🔴 DATA INCONSISTENCY DETECTED!');
        console.log('   Check .github/TRACKING_ARCHITECTURE.md for debugging help.\n');
        return false;
    }

    console.log('✅ All checks passed! Data is consistent.\n');
    return true;
}

function validateWeeklyData() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('       Deskly - WEEKLY DATA VALIDATION');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const days = [];
    let weeklyTotal = 0;
    let allPassed = true;
    const weeklyCategories = {};
    
    console.log('📅 Validating last 7 days:\n');
    console.log('─────────────────────────────────────────');
    
    for (let i = 6; i >= 0; i--) {
        const date = getDateDaysAgo(i);
        const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
        const month = date.substring(0, 7);
        const appDataPath = path.join(VAULT_PATH, 'data', `${month}.json`);
        
        let daySeconds = 0;
        let hasData = false;
        
        if (fs.existsSync(appDataPath)) {
            try {
                const appData = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
                const dayData = appData[date];
                
                if (dayData && dayData.aggregates) {
                    hasData = true;
                    for (const [app, data] of Object.entries(dayData.aggregates)) {
                        const seconds = data.totalSeconds || 0;
                        daySeconds += seconds;
                        
                        // Aggregate categories
                        const cat = data.category || 'Uncategorized';
                        weeklyCategories[cat] = (weeklyCategories[cat] || 0) + seconds;
                    }
                }
            } catch (e) {
                // Ignore parse errors for weekly validation
            }
        }
        
        weeklyTotal += daySeconds;
        const hours = (daySeconds / 3600).toFixed(1);
        const status = hasData ? '✅' : '⚠️';
        
        days.push({ date, dayName, seconds: daySeconds, hasData });
        console.log(`  ${status} ${dayName} ${date}: ${hours}h`);
    }
    
    console.log('─────────────────────────────────────────');
    console.log(`  WEEKLY TOTAL: ${(weeklyTotal / 3600).toFixed(1)}h`);
    console.log(`  DAILY AVERAGE: ${(weeklyTotal / 7 / 3600).toFixed(1)}h\n`);
    
    // Category totals
    const categoryTotal = Object.values(weeklyCategories).reduce((a, b) => a + b, 0);
    
    console.log('📊 WEEKLY CATEGORY BREAKDOWN:');
    console.log('─────────────────────────────────────────');
    
    const sortedCategories = Object.entries(weeklyCategories)
        .sort((a, b) => b[1] - a[1]);
    
    for (const [cat, seconds] of sortedCategories) {
        const percent = weeklyTotal > 0 ? Math.round((seconds / weeklyTotal) * 100) : 0;
        const hours = (seconds / 3600).toFixed(1);
        console.log(`  ${cat.padEnd(25)} ${hours}h (${percent}%)`);
    }
    
    console.log('─────────────────────────────────────────\n');
    
    // Validate invariants
    console.log('🔍 WEEKLY INVARIANTS CHECK:');
    console.log('─────────────────────────────────────────');
    
    // Check: Category total equals weekly total
    const categoryDiff = Math.abs(categoryTotal - weeklyTotal);
    if (categoryDiff > 0) {
        console.log(`  ❌ Category sum (${categoryTotal}s) !== Weekly total (${weeklyTotal}s)`);
        allPassed = false;
    } else {
        console.log(`  ✅ Category sum equals weekly total`);
    }
    
    // Check: Days sum equals weekly total
    const daysSum = days.reduce((sum, d) => sum + d.seconds, 0);
    const daysDiff = Math.abs(daysSum - weeklyTotal);
    if (daysDiff > 0) {
        console.log(`  ❌ Days sum (${daysSum}s) !== Weekly total (${weeklyTotal}s)`);
        allPassed = false;
    } else {
        console.log(`  ✅ Days sum equals weekly total`);
    }
    
    // Check: At least some data exists
    const daysWithData = days.filter(d => d.hasData).length;
    if (daysWithData === 0) {
        console.log(`  ⚠️  No data found for any day in the last week`);
    } else {
        console.log(`  ✅ Found data for ${daysWithData}/7 days`);
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                      WEEKLY VALIDATION RESULT');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    if (allPassed) {
        console.log('✅ Weekly data is consistent!\n');
    } else {
        console.log('❌ Weekly data has inconsistencies!\n');
    }
    
    return allPassed;
}

// Parse args
const args = process.argv.slice(2);

if (args.includes('--week')) {
    validateWeeklyData();
} else {
    const date = args.find(a => !a.startsWith('--')) || getToday();
    validateData(date);
}

