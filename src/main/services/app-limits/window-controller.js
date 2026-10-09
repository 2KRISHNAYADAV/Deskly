/**
 * Window Controller
 * 
 * Native Windows operations for app limit enforcement:
 * - Minimize windows
 * - Terminate processes
 * - Block app focus (bring overlay to front when blocked app activates)
 * 
 * Uses PowerShell for Windows API access.
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Track blocked apps (apps that shouldn't be in foreground)
const blockedApps = new Map(); // processName -> { until: timestamp, overlay: window }

// PowerShell script for window operations
const PS_MINIMIZE_SCRIPT = `
param([string]$ProcessName)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WindowHelper {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    
    public const int SW_MINIMIZE = 6;
    public const int SW_FORCEMINIMIZE = 11;
}
"@

$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if ($procs) {
    foreach ($proc in $procs) {
        if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
            [WindowHelper]::ShowWindow($proc.MainWindowHandle, [WindowHelper]::SW_MINIMIZE) | Out-Null
            Write-Output "Minimized: $($proc.ProcessName) (PID: $($proc.Id))"
        }
    }
} else {
    Write-Output "Process not found: $ProcessName"
}
`;

const PS_TERMINATE_SCRIPT = `
param([string]$ProcessName)

$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if ($procs) {
    $procs | Stop-Process -Force
    Write-Output "Terminated: $ProcessName ($($procs.Count) processes)"
} else {
    Write-Output "Process not found: $ProcessName"
}
`;

const PS_GET_FOREGROUND = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class ForegroundHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$hwnd = [ForegroundHelper]::GetForegroundWindow()
$pid = 0
[ForegroundHelper]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null

if ($pid -gt 0) {
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Output $proc.ProcessName
    }
}
`;

// --- PowerShell Execution ---

async function runPowerShell(script, args = {}) {
    // Build parameter string
    let paramStr = '';
    for (const [key, value] of Object.entries(args)) {
        paramStr += ` -${key} "${value}"`;
    }

    const fullScript = script + paramStr;

    try {
        const { stdout, stderr } = await execAsync(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${fullScript.replace(/"/g, '\\"')}"`,
            { timeout: 10000 }
        );

        if (stderr) {
            console.warn('[WindowController] PowerShell stderr:', stderr);
        }

        return stdout.trim();
    } catch (error) {
        console.error('[WindowController] PowerShell error:', error.message);
        return null;
    }
}

// --- Public API ---

/**
 * Minimize all windows of a process
 * @param {string} processName - Process name without .exe
 * @returns {Promise<boolean>} Success
 */
async function minimizeApp(processName) {
    // Clean process name (remove .exe if present)
    const cleanName = processName.replace(/\.exe$/i, '');

    console.log(`🔽 Minimizing: ${cleanName}`);

    const result = await runPowerShell(PS_MINIMIZE_SCRIPT, { ProcessName: cleanName });

    if (result && result.includes('Minimized')) {
        console.log(`✅ ${result}`);
        return true;
    }

    console.log(`⚠️ Could not minimize ${cleanName}: ${result}`);
    return false;
}

/**
 * Terminate all instances of a process
 * @param {string} processName - Process name without .exe
 * @returns {Promise<boolean>} Success
 */
async function terminateApp(processName) {
    const cleanName = processName.replace(/\.exe$/i, '');

    console.log(`🔴 Terminating: ${cleanName}`);

    const result = await runPowerShell(PS_TERMINATE_SCRIPT, { ProcessName: cleanName });

    if (result && result.includes('Terminated')) {
        console.log(`✅ ${result}`);
        return true;
    }

    console.log(`⚠️ Could not terminate ${cleanName}: ${result}`);
    return false;
}

/**
 * Get the currently focused app's process name
 * @returns {Promise<string|null>} Process name or null
 */
async function getForegroundApp() {
    const result = await runPowerShell(PS_GET_FOREGROUND);
    return result || null;
}

/**
 * Block an app from being in foreground
 * When this app comes to foreground, we'll minimize it and show overlay
 * @param {string} processName - Process to block
 * @param {number} duration - Block duration in ms (0 = indefinite)
 */
function blockApp(processName, duration = 0) {
    const cleanName = processName.toLowerCase().replace(/\.exe$/i, '');

    blockedApps.set(cleanName, {
        until: duration > 0 ? Date.now() + duration : Infinity,
        blockedAt: Date.now()
    });

    console.log(`🚫 Blocked: ${cleanName}${duration ? ` for ${duration / 1000}s` : ' indefinitely'}`);
}

/**
 * Unblock an app
 * @param {string} processName - Process to unblock
 */
function unblockApp(processName) {
    const cleanName = processName.toLowerCase().replace(/\.exe$/i, '');

    if (blockedApps.has(cleanName)) {
        blockedApps.delete(cleanName);
        console.log(`✅ Unblocked: ${cleanName}`);
        return true;
    }
    return false;
}

/**
 * Check if an app is currently blocked
 * @param {string} processName - Process to check
 * @returns {boolean}
 */
function isBlocked(processName) {
    const cleanName = processName.toLowerCase().replace(/\.exe$/i, '');
    const block = blockedApps.get(cleanName);

    if (!block) return false;

    // Check if block expired
    if (block.until < Date.now()) {
        blockedApps.delete(cleanName);
        return false;
    }

    return true;
}

/**
 * Get all currently blocked apps
 * @returns {Array<{name: string, until: number}>}
 */
function getBlockedApps() {
    const now = Date.now();
    const result = [];

    for (const [name, block] of blockedApps) {
        if (block.until > now) {
            result.push({ name, until: block.until });
        } else {
            blockedApps.delete(name);
        }
    }

    return result;
}

/**
 * Clear all blocks
 */
function clearAllBlocks() {
    blockedApps.clear();
    console.log('🔓 All app blocks cleared');
}

// --- Exports ---

module.exports = {
    minimizeApp,
    terminateApp,
    getForegroundApp,
    blockApp,
    unblockApp,
    isBlocked,
    getBlockedApps,
    clearAllBlocks
};
