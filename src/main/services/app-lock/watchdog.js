/**
 * App Lock Watchdog
 *
 * When App Lock is active, a determined user could kill Deskly from Task Manager
 * to disable enforcement. We can't prevent a kill without a kernel driver, but we
 * CAN resurrect: a small detached PowerShell process watches for Deskly and
 * relaunches it within a few seconds if it disappears.
 *
 * Lifecycle:
 *   • start(exePath, processName)  — spawned when locks become active.
 *   • stop()                       — called on AUTHORIZED quit (after PIN), so a
 *                                    legitimate exit does NOT get resurrected.
 *
 * Honest limitations:
 *   • Packaged builds only — in dev, Deskly runs as electron.exe via a script,
 *     so relaunching an .exe doesn't apply.
 *   • The watchdog itself is a powershell.exe process; a knowledgeable user could
 *     find and kill it too. This raises the bar substantially (two processes,
 *     one not obviously named "Deskly") without claiming to be unbeatable.
 *   • Deskly's single-instance lock means an accidental double-launch is harmless.
 */

'use strict';

const { spawn } = require('child_process');

let watchdogPid = null;

function isRunning() { return watchdogPid != null; }

function start(exePath, processName) {
    if (watchdogPid) return;
    if (!exePath || !processName) return;

    // Process name without extension for Get-Process -Name
    const baseName = processName.replace(/\.exe$/i, '');
    const safeExe  = exePath.replace(/'/g, "''");

    const script =
        `$ErrorActionPreference='SilentlyContinue';` +
        `while ($true) {` +
        `  $p = Get-Process -Name '${baseName}';` +
        `  if (-not $p) { Start-Process -FilePath '${safeExe}'; }` +
        `  Start-Sleep -Seconds 3;` +
        `}`;

    try {
        const child = spawn(
            'powershell',
            ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
            { detached: true, stdio: 'ignore', windowsHide: true }
        );
        child.unref();
        watchdogPid = child.pid;
        console.log(`[AppLock] Watchdog started (pid ${watchdogPid})`);
    } catch (err) {
        console.warn('[AppLock] Watchdog failed to start:', err.message);
    }
}

function stop() {
    if (!watchdogPid) return;
    try {
        spawn('taskkill', ['/F', '/PID', String(watchdogPid)], { windowsHide: true });
    } catch {}
    console.log(`[AppLock] Watchdog stopped (pid ${watchdogPid})`);
    watchdogPid = null;
}

module.exports = { start, stop, isRunning };
