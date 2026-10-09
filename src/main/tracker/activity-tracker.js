/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    ACTIVITY TRACKER - CRITICAL MODULE                      ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║ ⚠️  READ .github/TRACKING_ARCHITECTURE.md BEFORE MODIFYING THIS FILE!     ║
 * ║                                                                           ║
 * ║ INVARIANTS THAT MUST NEVER BE BROKEN:                                     ║
 * ║ 1. Browser time === Sum of website times (tracked in sync)                ║
 * ║ 2. NO time lost on app switch (save elapsed BEFORE ending session)        ║
 * ║ 3. NO time lost to rounding (use accumulator for sub-second time)         ║
 * ║ 4. Aggregates updated ONLY via updateAppUsage() in updateSession()        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

const { spawn } = require('child_process');
const { updateAppUsage, getAppCategory, getToday, logSession, getDailySummary } = require('../database/db');
const { isBrowser, parseWebsiteFromTitle, recordWebsiteUsage } = require('../services/browser-intelligence');
const limitsEngine = require('../services/app-limits/limits-engine');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { randomUUID } = require('crypto');

const trackerEvents = new EventEmitter();

let trackingTimeout = null;
let idleTimeout = 5 * 60 * 1000; // 5 minutes in ms
let trackActivityRunning = false; // prevents concurrent trackActivity() invocations

// Session State
let currentSession = null;
let lastTickTime = null;
let lastTrackedDate = null; // Track date for daily reset

// Resilience: a single failed foreground poll (timeout/error) must NOT end the
// session and discard time. Under heavy system load (e.g. App Lock enforcement
// spawning tasklist/taskkill frequently), the persistent PowerShell poll can
// transiently time out. We tolerate a short burst of nulls — keep the current
// session alive and keep accumulating its time — and only give up after several
// consecutive failures (likely a real problem or the user is away).
let consecutiveNullPolls = 0;
const MAX_TOLERATED_NULL_POLLS = 8; // ~8 seconds of poll failures before ending

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT POWERSHELL PROCESS
//
// Instead of spawning a new powershell.exe every second (which incurs ~100ms
// process-spawn overhead + repeated .NET assembly compilation), we keep ONE
// long-lived PowerShell process alive.  We send "poll\n" on stdin each tick
// and read the active-window result back on stdout.  The C# type and all
// assemblies are compiled ONCE at process startup (~1-2 s), then every
// subsequent poll returns in <5 ms.
// ═══════════════════════════════════════════════════════════════════════════

const PS_SCRIPT_PERSISTENT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Diagnostics;

public class WindowTracker
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static string GetActiveWindowInfo()
    {
        try
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "unknown|No Window";
            
            uint processId = 0;
            GetWindowThreadProcessId(hwnd, out processId);
            
            if (processId == 0) return "unknown|No Process";
            
            Process proc = Process.GetProcessById((int)processId);
            string processName = proc.ProcessName.ToLower();
            string windowTitle = "";
            
            try
            {
                AutomationElement element = AutomationElement.FromHandle(hwnd);
                if (element != null)
                {
                    windowTitle = element.Current.Name ?? "";
                    
                    if (processName == "applicationframehost")
                    {
                        AutomationElement child = element.FindFirst(
                            TreeScope.Children,
                            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window)
                        );
                        
                        if (child == null)
                        {
                            child = element.FindFirst(
                                TreeScope.Descendants,
                                new PropertyCondition(AutomationElement.IsContentElementProperty, true)
                            );
                        }
                        
                        if (child != null)
                        {
                            try
                            {
                                int childPid = child.Current.ProcessId;
                                if (childPid > 0 && childPid != processId)
                                {
                                    Process childProc = Process.GetProcessById(childPid);
                                    processName = childProc.ProcessName.ToLower();
                                }
                            }
                            catch { }
                        }
                    }
                }
            }
            catch { }
            
            return processName + "|" + windowTitle;
        }
        catch (Exception ex)
        {
            return "error|" + ex.Message;
        }
    }
}
"@ -ReferencedAssemblies @("UIAutomationClient", "UIAutomationTypes")

# Signal that type compilation succeeded and we are ready to receive polls
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

# Main poll loop: block on stdin, respond on stdout
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line -eq "exit") { break }
    if ($line.Trim() -eq "poll") {
        $result = [WindowTracker]::GetActiveWindowInfo()
        [Console]::Out.WriteLine($result)
        [Console]::Out.Flush()
    }
}
`;

// ── Persistent process state ─────────────────────────────────────────────
const persistentScriptPath = path.join(os.tmpdir(), 'dw-tracker-persistent.ps1');
let psProcess = null;
let psReady = false;
let pendingPsCallback = null; // at most ONE in-flight poll at a time
let psOutputBuffer = '';
let psRestartTimer = null;

function startPersistentPS() {
    if (psProcess && !psProcess.killed) return;

    // Write the script to disk here rather than at module load, so startup
    // is not blocked by a synchronous file write before the window is shown.
    fs.writeFileSync(persistentScriptPath, PS_SCRIPT_PERSISTENT);

    psProcess = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', persistentScriptPath
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    psOutputBuffer = '';
    psReady = false;

    psProcess.stdout.on('data', (chunk) => {
        psOutputBuffer += chunk.toString();
        // PowerShell may use CRLF; split on \n and strip \r
        const lines = psOutputBuffer.split('\n');
        psOutputBuffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed === 'READY') {
                psReady = true;
                return;
            }
            if (pendingPsCallback) {
                const cb = pendingPsCallback;
                pendingPsCallback = null;
                cb(trimmed);
            }
        }
    });

    psProcess.stderr.on('data', () => { /* swallow stderr */ });

    psProcess.on('close', () => {
        psProcess = null;
        psReady = false;
        if (pendingPsCallback) {
            pendingPsCallback(null);
            pendingPsCallback = null;
        }
        // Re-spawn automatically unless tracking was stopped
        if (trackingTimeout !== null) {
            psRestartTimer = setTimeout(startPersistentPS, 2000);
        }
    });
}

function stopPersistentPS() {
    if (psRestartTimer) {
        clearTimeout(psRestartTimer);
        psRestartTimer = null;
    }
    if (psProcess) {
        try { psProcess.stdin.write('exit\n'); } catch (_) {}
        const proc = psProcess;
        psProcess = null;
        psReady = false;
        // Give 500 ms to exit gracefully before force-killing
        setTimeout(() => { try { proc.kill(); } catch (_) {} }, 500);
    }
}

// ── Window-result parsing (extracted so it's shared by both sync paths) ──
function parseWindowResult(output) {
    if (!output || output.startsWith('error|')) return null;
    const pipeIdx = output.indexOf('|');
    if (pipeIdx === -1) return null;

    let processName = output.substring(0, pipeIdx).toLowerCase().trim();
    const windowTitle = output.substring(pipeIdx + 1).trim();

    if (processName === 'applicationframehost' && windowTitle) {
        const titleLower = windowTitle.toLowerCase();
        const uwpMappings = {
            'whatsapp': 'whatsapp', 'telegram': 'telegram', 'instagram': 'instagram',
            'messenger': 'messenger', 'spotify': 'spotify', 'netflix': 'netflix',
            'xbox': 'xbox', 'calculator': 'calculator', 'photos': 'photos',
            'mail': 'mail', 'calendar': 'calendar', 'weather': 'weather',
            'store': 'microsoft-store', 'teams': 'teams', 'to do': 'todo',
            'onenote': 'onenote', 'twitter': 'twitter', 'facebook': 'facebook'
        };
        for (const [keyword, appName] of Object.entries(uwpMappings)) {
            if (titleLower.includes(keyword)) { processName = appName; break; }
        }
        if (processName === 'applicationframehost') {
            const firstWord = windowTitle.split(/[\s\-–—]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            processName = (firstWord && firstWord.length > 1) ? firstWord : 'uwp-app';
        }
    }

    if (!processName || processName === 'unknown' || processName === '') return null;
    return { processName, windowTitle };
}

function getActiveWindow() {
    return new Promise((resolve) => {
        if (!psReady || !psProcess || psProcess.killed) {
            resolve(null);
            return;
        }
        // Skip this tick if a previous poll hasn't returned yet
        if (pendingPsCallback) {
            resolve(null);
            return;
        }

        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                pendingPsCallback = null;
                resolve(null);
            }
        }, 3000);

        pendingPsCallback = (raw) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(parseWindowResult(raw));
            }
        };

        try {
            psProcess.stdin.write('poll\n');
        } catch (_) {
            settled = true;
            clearTimeout(timer);
            pendingPsCallback = null;
            resolve(null);
        }
    });
}


// --- SESSION MANAGEMENT ---

function startSession(appName, windowTitle) {
    const now = new Date();
    const category = getAppCategory(appName);

    return {
        id: randomUUID(),
        appName,
        windowTitle, // Initial window title
        category,
        startTime: now.toISOString(),
        endTime: now.toISOString(),
        duration: 0,
        lastActive: now.getTime()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️  CRITICAL FUNCTION: updateSession()
// ═══════════════════════════════════════════════════════════════════════════
// This is THE ONLY place where:
// 1. App aggregates are updated (via updateAppUsage)
// 2. Website usage is recorded (via recordWebsiteUsage)
// 
// These MUST happen together with the SAME seconds value to maintain sync!
// Browser time will ALWAYS equal website time because of this design.
// ═══════════════════════════════════════════════════════════════════════════

// Accumulator for sub-second time that would otherwise be lost
let timeAccumulator = 0;

function updateSession(session, elapsedSeconds) {
    if (!session) return;

    // Accumulate time (handles sub-second precision)
    timeAccumulator += elapsedSeconds;
    
    // Only update when we have at least 1 full second
    const wholeSeconds = Math.floor(timeAccumulator);
    if (wholeSeconds < 1) return;
    
    // Reset accumulator, keeping the fractional part
    timeAccumulator -= wholeSeconds;

    // Update duration
    session.duration += wholeSeconds;

    // Update EndTime to now
    const now = new Date();
    session.endTime = now.toISOString();
    session.lastActive = now.getTime();

    // Log incremental progress to DB for real-time UI
    const date = getToday();
    updateAppUsage(date, session.appName, wholeSeconds, session.category);

    // CRITICAL: Track website usage IN SYNC with app usage
    // This ensures browser app time always equals sum of website times
    if (isBrowser(session.appName) && session.windowTitle) {
        const website = parseWebsiteFromTitle(session.windowTitle);
        recordWebsiteUsage(website, wholeSeconds, session.appName);
    }
}

function endSession(session) {
    if (!session) return;

    // Reset the accumulator when ending a session
    // Any fractional second is lost (acceptable for accuracy)
    timeAccumulator = 0;

    // Final update of end time
    const now = new Date();
    session.endTime = now.toISOString();

    // Log the full session to the Session Store
    logSession(session);
    console.log(`⏹️ END SESSION: ${session.appName} (${session.duration}s)`);
}

// --------------------------

async function trackActivity() {
    if (trackActivityRunning) return;
    trackActivityRunning = true;
    try {
        const result = await getActiveWindow();
        const now = Date.now();
        const today = getToday();

        // Check for date change (new day) - reset extensions
        if (lastTrackedDate && lastTrackedDate !== today) {
            console.log(`🌅 New day detected: ${lastTrackedDate} → ${today}`);
            limitsEngine.resetDaily();
        }
        lastTrackedDate = today;

        // Calculate precise elapsed time since last tick
        // If this is the first tick, we default to 0 (no time added yet)
        let elapsed = 0;
        if (lastTickTime) {
            elapsed = (now - lastTickTime) / 1000;
        }
        lastTickTime = now;

        // Skip System Processes (but NOT our own app - we track ourselves too!)
        const skipApps = [
            'powershell', 'cmd', 'idle', 'conhost',
            'searchhost', 'startmenuexperiencehost', 'textinputhost', 'runtimebroker',
            'shellexperiencehost', 'lockapp', 'csrss', 'dwm', 'winlogon'
        ];

        // 1. Check if we should stop the current session (Idle or App Switch)
        if (currentSession) {
            // Check for idle
            const sessionIdleTime = now - currentSession.lastActive;
            if (sessionIdleTime > idleTimeout) {
                console.log(`💤 IDLE DETECTED. Closing session for ${currentSession.appName}`);
                endSession(currentSession);
                currentSession = null;
            }
        }

        // 2. Handle the Active Window Result
        if (result) {
            consecutiveNullPolls = 0; // got a real reading — reset failure counter
            const { processName: appName, windowTitle } = result;

            if (!skipApps.includes(appName)) {

                // Case A: No current session -> Start one
                if (!currentSession) {
                    currentSession = startSession(appName, windowTitle);
                    console.log(`▶️ START SESSION: ${appName}`);
                    // Note: First tick has no elapsed time to add (elapsed = 0)
                }
                // Case B: Switched App -> Add final elapsed time to OLD session, then switch
                else if (currentSession.appName !== appName) {
                    // CRITICAL FIX: Add the elapsed time to the PREVIOUS session before ending it
                    // This time belongs to the app that was active during this tick period
                    if (elapsed > 0) {
                        updateSession(currentSession, elapsed);
                    }
                    
                    const previousApp = currentSession.appName;
                    endSession(currentSession);
                    
                    // HIDE OVERLAY when switching away from limited app
                    // With showInactive(), the overlay doesn't steal focus, so we only hide when:
                    // - User genuinely switches to a different app (not electron/our overlay)
                    const overlayTarget = limitsEngine.getCurrentTarget();
                    
                    // Only hide if we were on the target app and now switching to something else (not electron)
                    const wasOnTargetApp = overlayTarget && previousApp.toLowerCase() === overlayTarget.toLowerCase();
                    const switchingToOtherApp = appName !== 'electron';
                    
                    if (wasOnTargetApp && switchingToOtherApp) {
                        console.log(`🖼️ Hiding overlay: switched from ${previousApp} to ${appName}`);
                        limitsEngine.hideOverlay();
                    }
                    
                    // Now start the new session
                    currentSession = startSession(appName, windowTitle);
                    console.log(`🔀 APP SWITCH: ${appName}`);
                }
                // Case C: Same App -> Update
                else {
                    // IMPORTANT: Update title BEFORE updateSession so that this tick's elapsed
                    // time is attributed to the tab that is CURRENTLY visible, not the previous one.
                    // Without this, every tab switch causes 1 second to be misattributed to
                    // the old tab (because the title update used to happen after the call).
                    currentSession.windowTitle = windowTitle;

                    if (elapsed > 0) {
                        // Let updateSession handle the accumulation and rounding
                        updateSession(currentSession, elapsed);
                        // Website tracking is now handled inside updateSession

                        // CHECK APP LIMITS - This is where enforcement happens!
                        checkAndEnforceLimits(appName);
                    }
                }
            } else {
                // System app active - save elapsed time to current session before ending
                if (currentSession) {
                    if (elapsed > 0) {
                        updateSession(currentSession, elapsed);
                    }
                    endSession(currentSession);
                    currentSession = null;
                }
            }
        } else {
            // No result this tick. This can be a genuine "no foreground window"
            // (real lock screen / desktop) OR a transient poll failure caused by
            // system-load contention (notably App Lock enforcement). We must not
            // discard the active session on a brief hiccup, or screen time freezes.
            consecutiveNullPolls++;

            if (currentSession) {
                if (consecutiveNullPolls < MAX_TOLERATED_NULL_POLLS) {
                    // Transient: keep the session alive and KEEP COUNTING its time.
                    // The user is almost certainly still on the same app; a dropped
                    // foreground poll shouldn't cost them their tracked seconds.
                    if (elapsed > 0) {
                        updateSession(currentSession, elapsed);
                    }
                } else {
                    // Sustained failure — likely a real lock screen or the user is
                    // away. Save remaining time and close the session cleanly.
                    if (elapsed > 0) {
                        updateSession(currentSession, elapsed);
                    }
                    endSession(currentSession);
                    currentSession = null;
                }
            }
        }

    } catch (error) {
        console.error('Tracking error:', error.message);
    } finally {
        trackActivityRunning = false;
        // Emit update event so UI can refresh essentially in real-time
        trackerEvents.emit('activity-tracked');

        // Schedule next track
        if (trackingTimeout !== null) {
            trackingTimeout = setTimeout(trackActivity, 1000); // 1s interval for smoother sessions
        }
    }
}

function startTracking() {
    if (trackingTimeout) {
        console.log('Tracking already started');
        return;
    }

    console.log('=== Starting Activity Tracking (Session Based) ===');
    console.log('Using persistent PowerShell process + UI Automation + Session Manager');

    // Start the persistent PowerShell process first.
    // It will signal READY once .NET type compilation is done (~1 s).
    // trackActivity() is safe to call immediately — it returns null until psReady.
    startPersistentPS();

    trackingTimeout = true;
    lastTickTime = Date.now();
    trackActivity();
}

function stopTracking() {
    if (trackingTimeout) {
        clearTimeout(trackingTimeout);
        trackingTimeout = null;

        // Close any open session
        if (currentSession) {
            endSession(currentSession);
            currentSession = null;
        }

        // Stop the persistent PowerShell process
        stopPersistentPS();

        console.log('Activity tracking stopped');
    }
}

function setIdleTimeout(minutes) {
    idleTimeout = minutes * 60 * 1000;
}

// Force an immediate update (skips if a poll is already in-flight to prevent concurrent execution)
async function forceTrackingUpdate() {
    if (trackActivityRunning) return;
    if (trackingTimeout && typeof trackingTimeout !== 'boolean') {
        clearTimeout(trackingTimeout);
    }
    await trackActivity();
}

// ═══════════════════════════════════════════════════════════════════════════
// APP LIMITS INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check and enforce app limits for the active app
 * Called every second from trackActivity() when app is being used
 */
async function checkAndEnforceLimits(appName) {
    if (!limitsEngine.isRunning()) {
        return;
    }
    
    try {
        // First check if this app even has a limit (quick check, no logging)
        const hasLimit = limitsEngine.store.get(appName);
        if (!hasLimit) {
            // No limit set for this app - but still check if we need to hide overlay
            // (user might have switched away from a limited app)
            limitsEngine.check(appName, 0); // This handles overlay hiding
            return;
        }
        
        // App has a limit - get usage data
        const summary = getDailySummary(getToday());
        const appKey = appName.toLowerCase();
        const appData = summary?.aggregates?.[appKey] || summary?.aggregates?.[appName];
        const usedSeconds = appData?.totalSeconds || 0;
        
        // Check against limits
        const result = limitsEngine.check(appName, usedSeconds);
        
        // If limit exceeded, show the overlay
        if (result.status === 'exceeded') {
            console.log(`⚠️ Limit exceeded: ${appName} (${result.usedMinutes}m / ${result.limitMinutes}m)`);
            await limitsEngine.enforce(result);
        }
    } catch (err) {
        console.error('Limits check error:', err.message);
    }
}

module.exports = {
    startTracking,
    stopTracking,
    setIdleTimeout,
    forceTrackingUpdate,
    trackerEvents,
};
