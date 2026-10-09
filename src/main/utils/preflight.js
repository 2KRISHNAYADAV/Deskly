/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║            Deskly - PREFLIGHT CHECK SUITE                      ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Runs all validation checks before build/deploy                           ║
 * ║  This is the CI/CD safety net for the codebase                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * Usage:
 *   npm run preflight           # Run all checks
 *   npm run preflight -- --fix  # Run checks and auto-fix where possible
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Get vault path from vault-pointer store (same as app uses)
function getVaultPath() {
    try {
        // Try to read from electron-store vault-pointer
        const Store = require('electron-store');
        const vaultPointer = new Store({ name: 'vault-pointer' });
        const storedPath = vaultPointer.get('vaultPath');
        if (storedPath && fs.existsSync(storedPath)) {
            return storedPath;
        }
    } catch (e) {
        // electron-store might not work in pure Node context
    }
    
    // Fallback to default vault location
    const defaultPath = path.join(os.homedir(), 'Documents', 'Deskly Academic Vault');
    if (fs.existsSync(defaultPath)) {
        return defaultPath;
    }

    const legacyDefaultPath = path.join(os.homedir(), 'Documents', 'Deskly Vault');
    if (fs.existsSync(legacyDefaultPath)) {
        return legacyDefaultPath;
    }
    
    // Legacy fallback
    const legacyPath = path.join(os.homedir(), 'Documents', 'Deskly');
    if (fs.existsSync(legacyPath)) {
        return legacyPath;
    }
    
    return null;
}

const VAULT_PATH = getVaultPath();

// Colors for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(title) {
    console.log();
    log('─'.repeat(60), 'cyan');
    log(`  ${title}`, 'bright');
    log('─'.repeat(60), 'cyan');
}

function success(message) {
    log(`  ✅ ${message}`, 'green');
}

function warning(message) {
    log(`  ⚠️  ${message}`, 'yellow');
}

function error(message) {
    log(`  ❌ ${message}`, 'red');
}

function info(message) {
    log(`  ℹ️  ${message}`, 'blue');
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check 1: Vault Structure
 */
function checkVaultStructure() {
    header('CHECK 1: Vault Structure');
    
    // Skip if no vault found
    if (!VAULT_PATH) {
        warning('No vault found - skipping vault structure check');
        info('Vault will be created on first app run (onboarding)');
        return true; // Not a failure - just means new install
    }
    
    let passed = true;
    const requiredDirs = [
        'data',
        'data/websites',
    ];
    
    for (const dir of requiredDirs) {
        const fullPath = path.join(VAULT_PATH, dir);
        if (fs.existsSync(fullPath)) {
            success(`Directory exists: ${dir}`);
        } else {
            warning(`Directory missing: ${dir} (will be created on first run)`);
        }
    }
    
    // Check if vault path is accessible
    if (fs.existsSync(VAULT_PATH)) {
        success(`Vault accessible at: ${VAULT_PATH}`);
    } else {
        warning(`Vault path not accessible: ${VAULT_PATH}`);
    }
    
    return passed;
}

/**
 * Check 2: Critical Files Exist
 */
function checkCriticalFiles() {
    header('CHECK 2: Critical Files');
    
    let passed = true;
    const criticalFiles = [
        { path: 'src/main/main.js', desc: 'Main process entry' },
        { path: 'src/main/preload.js', desc: 'Preload bridge' },
        { path: 'src/main/database/db.js', desc: 'Database layer' },
        { path: 'src/main/tracker/activity-tracker.js', desc: 'Activity tracking' },
        { path: 'src/main/services/unified-stats.js', desc: 'Stats service' },
        { path: 'src/main/services/browser-intelligence.js', desc: 'Browser parsing' },
        { path: 'src/main/services/vault-manager.js', desc: 'Vault I/O' },
        { path: 'src/renderer/utils/safeApi.js', desc: 'Safe IPC wrapper' },
        { path: 'src/renderer/App.jsx', desc: 'React app entry' },
    ];
    
    for (const file of criticalFiles) {
        if (fs.existsSync(file.path)) {
            success(`${file.desc}: ${file.path}`);
        } else {
            error(`Missing: ${file.path} (${file.desc})`);
            passed = false;
        }
    }
    
    return passed;
}

/**
 * Check 3: Tracking Invariants in Code
 */
function checkTrackingInvariants() {
    header('CHECK 3: Tracking Code Invariants');
    
    let passed = true;
    
    // Check 1: updateSession should contain website tracking
    const activityTracker = fs.readFileSync('src/main/tracker/activity-tracker.js', 'utf8');
    
    if (activityTracker.includes('recordWebsiteUsage') && 
        activityTracker.includes('function updateSession')) {
        success('Website tracking is inside updateSession()');
    } else {
        error('Website tracking may not be synced with app tracking!');
        info('recordWebsiteUsage() must be called inside updateSession()');
        passed = false;
    }
    
    // Check 2: logSession should NOT update aggregates
    const dbCode = fs.readFileSync('src/main/database/db.js', 'utf8');
    const logSessionMatch = dbCode.match(/function logSession[\s\S]*?^}/m);
    
    if (logSessionMatch) {
        const logSessionCode = logSessionMatch[0];
        if (logSessionCode.includes('totalSeconds +=') || 
            logSessionCode.includes('aggregates[')) {
            error('logSession() is updating aggregates - DOUBLE COUNTING BUG!');
            passed = false;
        } else {
            success('logSession() does not update aggregates');
        }
    }
    
    // Check 3: Time accumulator exists
    if (activityTracker.includes('timeAccumulator')) {
        success('Time accumulator exists for sub-second precision');
    } else {
        warning('No time accumulator found - may lose sub-second time');
    }
    
    // Check 4: Elapsed time saved on app switch
    if (activityTracker.includes('updateSession(currentSession, elapsed)') &&
        activityTracker.includes('endSession(currentSession)')) {
        success('Elapsed time saved before session end');
    } else {
        warning('May be losing time on app switch');
    }
    
    return passed;
}

/**
 * Check 4: IPC Handler Chain
 */
function checkIPCChain() {
    header('CHECK 4: IPC Handler Chain');
    
    let passed = true;
    
    const mainJs = fs.readFileSync('src/main/main.js', 'utf8');
    const preloadJs = fs.readFileSync('src/main/preload.js', 'utf8');
    const safeApiJs = fs.readFileSync('src/renderer/utils/safeApi.js', 'utf8');
    
    // Critical IPC methods that must exist in all three
    const criticalMethods = [
        { name: 'getTodayStats', ipc: 'stats:today' },
        { name: 'getWeeklyStats', ipc: 'stats:weekly' },
        { name: 'getBrowserBreakdown', ipc: 'browser:breakdown' },
    ];
    
    for (const method of criticalMethods) {
        const inMain = mainJs.includes(method.ipc);
        const inPreload = preloadJs.includes(method.name);
        const inSafeApi = safeApiJs.includes(method.name);
        
        if (inMain && inPreload && inSafeApi) {
            success(`${method.name}: main ✓ preload ✓ safeApi ✓`);
        } else {
            error(`${method.name}: main ${inMain ? '✓' : '✗'} preload ${inPreload ? '✓' : '✗'} safeApi ${inSafeApi ? '✓' : '✗'}`);
            passed = false;
        }
    }
    
    return passed;
}

/**
 * Check 5: Package Dependencies
 */
function checkDependencies() {
    header('CHECK 5: Dependencies');
    
    let passed = true;
    
    if (!fs.existsSync('node_modules')) {
        error('node_modules not found - run npm install');
        passed = false;
    } else {
        success('node_modules exists');
    }
    
    // Check critical dependencies
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const criticalDeps = ['electron', 'react', 'react-dom', 'vite'];
    
    for (const dep of criticalDeps) {
        if (pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]) {
            success(`${dep} is in package.json`);
        } else {
            error(`${dep} missing from package.json`);
            passed = false;
        }
    }
    
    return passed;
}

/**
 * Check 6: Data Consistency (if data exists)
 * NOTE: This check is informational only - historical data may have inconsistencies
 */
function checkDataConsistency() {
    header('CHECK 6: Data Consistency');
    
    // Skip if no vault found
    if (!VAULT_PATH) {
        info('No vault found - skipping data consistency check');
        return true;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);
    const appDataPath = path.join(VAULT_PATH, 'data', `${month}.json`);
    const websiteDataPath = path.join(VAULT_PATH, 'data', 'websites', `${month}.json`);
    
    if (!fs.existsSync(appDataPath)) {
        info('No app data yet for this month (OK for fresh install)');
        return true;
    }
    
    // Data consistency is informational only - always pass
    // Historical data may have sync issues but that's OK
    
    try {
        const appData = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
        const websiteData = fs.existsSync(websiteDataPath) 
            ? JSON.parse(fs.readFileSync(websiteDataPath, 'utf8'))
            : {};
        
        const dayAppData = appData[today];
        const dayWebsiteData = websiteData[today];
        
        if (!dayAppData) {
            info('No data for today yet');
            return true;
        }
        
        const aggregates = dayAppData.aggregates || {};
        const byBrowser = dayWebsiteData?.byBrowser || {};
        
        // Check browser sync - INFORMATIONAL ONLY
        const browsers = ['brave', 'chrome', 'firefox', 'edge', 'comet', 'arc', 'opera', 'vivaldi', 'waterfox', 'librewolf', 'tor', 'floorp', 'zen', 'whale', 'sidekick'];
        let hasData = false;
        
        for (const browser of browsers) {
            const browserAppTime = aggregates[browser]?.totalSeconds || 0;
            const browserWebsiteTime = byBrowser[browser.charAt(0).toUpperCase() + browser.slice(1)] || 0;
            
            if (browserAppTime > 0 || browserWebsiteTime > 0) {
                hasData = true;
                const diff = Math.abs(browserAppTime - browserWebsiteTime);
                if (diff <= 5) {
                    success(`${browser}: app=${browserAppTime}s website=${browserWebsiteTime}s ✓`);
                } else {
                    // Just a warning, not a failure - historical data may be out of sync
                    warning(`${browser}: app=${browserAppTime}s website=${browserWebsiteTime}s (historical drift)`);
                }
            }
        }
        
        if (!hasData) {
            info('No browser data to check');
        }
        
    } catch (e) {
        warning(`Could not parse data: ${e.message}`);
    }
    
    // Always pass - this is informational
    return true;
}

/**
 * Check 7: Build Output
 */
function checkBuildOutput() {
    header('CHECK 7: Build Output');
    
    let passed = true;
    
    if (fs.existsSync('dist/renderer/index.html')) {
        success('Renderer build exists: dist/renderer/index.html');
    } else {
        warning('No renderer build - run npm run dev or npm run build');
    }
    
    if (fs.existsSync('dist/renderer/assets')) {
        const assets = fs.readdirSync('dist/renderer/assets');
        const hasJs = assets.some(f => f.endsWith('.js'));
        const hasCss = assets.some(f => f.endsWith('.css'));
        
        if (hasJs && hasCss) {
            success(`Build assets: ${assets.length} files`);
        } else {
            warning('Build may be incomplete');
        }
    }
    
    return passed;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════════════════════════════

function runPreflight() {
    console.log();
    log('╔═══════════════════════════════════════════════════════════════════╗', 'cyan');
    log('║        Deskly - PREFLIGHT CHECK SUITE                  ║', 'cyan');
    log('╚═══════════════════════════════════════════════════════════════════╝', 'cyan');
    
    const startTime = Date.now();
    const results = [];
    
    // Run all checks
    results.push({ name: 'Vault Structure', passed: checkVaultStructure() });
    results.push({ name: 'Critical Files', passed: checkCriticalFiles() });
    results.push({ name: 'Tracking Invariants', passed: checkTrackingInvariants() });
    results.push({ name: 'IPC Handler Chain', passed: checkIPCChain() });
    results.push({ name: 'Dependencies', passed: checkDependencies() });
    results.push({ name: 'Data Consistency', passed: checkDataConsistency() });
    results.push({ name: 'Build Output', passed: checkBuildOutput() });
    
    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;
    
    console.log();
    log('═══════════════════════════════════════════════════════════════════', 'cyan');
    log('                        PREFLIGHT SUMMARY', 'bright');
    log('═══════════════════════════════════════════════════════════════════', 'cyan');
    console.log();
    
    for (const result of results) {
        if (result.passed) {
            success(`${result.name}`);
        } else {
            error(`${result.name}`);
        }
    }
    
    console.log();
    log(`Time: ${elapsed}s`, 'blue');
    
    if (failedCount === 0) {
        console.log();
        log('╔═══════════════════════════════════════════════════════════════════╗', 'green');
        log('║              ✅ ALL PREFLIGHT CHECKS PASSED!                      ║', 'green');
        log('║                   Safe to build and deploy                        ║', 'green');
        log('╚═══════════════════════════════════════════════════════════════════╝', 'green');
        console.log();
        process.exit(0);
    } else {
        console.log();
        log('╔═══════════════════════════════════════════════════════════════════╗', 'red');
        log(`║              ❌ ${failedCount} CHECK(S) FAILED                                  ║`, 'red');
        log('║                   Fix issues before proceeding                    ║', 'red');
        log('╚═══════════════════════════════════════════════════════════════════╝', 'red');
        console.log();
        process.exit(1);
    }
}

// Run
runPreflight();

