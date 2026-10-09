/**
 * Vault Inspector - Deep dive into vault data
 * 
 * Usage:
 *   npm run inspect                    # Inspect today
 *   npm run inspect -- --date 2026-01-20  # Specific date
 *   npm run inspect -- --range 7      # Last 7 days
 *   npm run inspect -- --apps         # Focus on apps
 *   npm run inspect -- --websites     # Focus on websites
 *   npm run inspect -- --sessions     # Show sessions
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

function formatTime(seconds) {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function loadData(date) {
    const month = date.substring(0, 7);
    const appDataPath = path.join(VAULT_PATH, 'data', `${month}.json`);
    const websiteDataPath = path.join(VAULT_PATH, 'data', 'websites', `${month}.json`);
    
    let appData = {};
    let websiteData = {};
    
    if (fs.existsSync(appDataPath)) {
        try {
            appData = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
        } catch (e) {}
    }
    
    if (fs.existsSync(websiteDataPath)) {
        try {
            websiteData = JSON.parse(fs.readFileSync(websiteDataPath, 'utf8'));
        } catch (e) {}
    }
    
    return {
        apps: appData[date] || {},
        websites: websiteData[date] || {}
    };
}

function inspectDate(date, options = {}) {
    console.log(`\n📅 ${date}`);
    console.log('═'.repeat(60));
    
    const data = loadData(date);
    const aggregates = data.apps.aggregates || {};
    const sessions = data.apps.sessions || [];
    const websites = data.websites.websites || {};
    const byBrowser = data.websites.byBrowser || {};
    
    // Apps
    if (!options.websitesOnly) {
        console.log('\n📱 APPS:');
        console.log('─'.repeat(40));
        
        const sortedApps = Object.entries(aggregates)
            .sort((a, b) => (b[1].totalSeconds || 0) - (a[1].totalSeconds || 0));
        
        let total = 0;
        for (const [app, appData] of sortedApps) {
            const seconds = appData.totalSeconds || 0;
            total += seconds;
            const category = appData.category || 'Uncategorized';
            console.log(`  ${app.padEnd(20)} ${formatTime(seconds).padStart(10)}  [${category}]`);
        }
        console.log('─'.repeat(40));
        console.log(`  ${'TOTAL'.padEnd(20)} ${formatTime(total).padStart(10)}`);
    }
    
    // Websites
    if (!options.appsOnly) {
        console.log('\n🌐 WEBSITES:');
        console.log('─'.repeat(40));
        
        const sortedWebsites = Object.entries(websites)
            .sort((a, b) => (b[1].seconds || 0) - (a[1].seconds || 0))
            .slice(0, 15);
        
        for (const [id, site] of sortedWebsites) {
            const name = site.name || id;
            const browser = site.browser || '?';
            const seconds = site.seconds || 0;
            console.log(`  ${name.substring(0, 18).padEnd(18)} ${formatTime(seconds).padStart(8)}  [${browser}]`);
        }
        
        if (Object.keys(websites).length > 15) {
            console.log(`  ... and ${Object.keys(websites).length - 15} more`);
        }
        
        console.log('\n  By Browser:');
        for (const [browser, seconds] of Object.entries(byBrowser)) {
            console.log(`    ${browser}: ${formatTime(seconds)}`);
        }
    }
    
    // Sessions
    if (options.sessions) {
        console.log('\n📝 SESSIONS:');
        console.log('─'.repeat(40));
        
        for (const session of sessions.slice(-10)) {
            const start = new Date(session.startTime).toLocaleTimeString();
            const dur = formatTime(session.duration);
            console.log(`  ${start} - ${session.appName} (${dur})`);
        }
        
        if (sessions.length > 10) {
            console.log(`  ... and ${sessions.length - 10} more`);
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    
    let date = getToday();
    let range = 1;
    let options = {};
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--date' && args[i + 1]) {
            date = args[i + 1];
            i++;
        } else if (args[i] === '--range' && args[i + 1]) {
            range = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === '--apps') {
            options.appsOnly = true;
        } else if (args[i] === '--websites') {
            options.websitesOnly = true;
        } else if (args[i] === '--sessions') {
            options.sessions = true;
        }
    }
    
    console.log('\n🔍 VAULT INSPECTOR');
    console.log('═'.repeat(60));
    
    if (range > 1) {
        for (let i = range - 1; i >= 0; i--) {
            inspectDate(getDateDaysAgo(i), options);
        }
    } else {
        inspectDate(date, options);
    }
    
    console.log();
}

main();

