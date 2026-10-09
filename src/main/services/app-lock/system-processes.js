/**
 * System Process Protection
 *
 * A hardcoded denylist of Windows processes that must NEVER be locked or killed.
 * Killing any of these can break the desktop shell, the login session, audio,
 * input, or security subsystems — i.e. brick the user's session until reboot.
 *
 * This list is the single source of truth, enforced at THREE layers:
 *   1. UI         — protected processes never appear in the lockable-apps picker
 *   2. lock-store — addLock() rejects any protected process
 *   3. enforcer   — the kill path skips protected processes even if one slips in
 *
 * The redundancy is intentional. A bug in any one layer must not be able to
 * take down explorer.exe again.
 */

'use strict';

// All entries lowercase. Compared against tasklist output (also lowercased).
const PROTECTED_PROCESSES = new Set([
    // ── Desktop shell — killing these removes taskbar/desktop/start menu ──
    'explorer.exe',
    'dwm.exe',                          // Desktop Window Manager (compositor)
    'startmenuexperiencehost.exe',
    'shellexperiencehost.exe',
    'searchhost.exe',
    'searchapp.exe',
    'searchindexer.exe',
    'textinputhost.exe',
    'applicationframehost.exe',

    // ── Session / login — killing these logs the user out or BSODs ──
    'winlogon.exe',
    'wininit.exe',
    'csrss.exe',
    'smss.exe',
    'userinit.exe',
    'logonui.exe',
    'lockapp.exe',
    'fontdrvhost.exe',
    'sihost.exe',

    // ── Security subsystem ──
    'lsass.exe',
    'services.exe',
    'svchost.exe',
    'smartscreen.exe',
    'securityhealthservice.exe',
    'securityhealthsystray.exe',

    // ── Input / accessibility ──
    'ctfmon.exe',

    // ── Generic hosts / infrastructure ──
    'runtimebroker.exe',
    'conhost.exe',
    'dllhost.exe',
    'taskhostw.exe',
    'spoolsv.exe',                      // print spooler
    'audiodg.exe',                      // audio device graph — killing mutes the system
    'wudfhost.exe',

    // ── Recovery tool — the user needs this to recover from any mistake ──
    'taskmgr.exe',

    // ── Kernel / pseudo-processes (appear in tasklist) ──
    'system',
    'registry',
    'system idle process',
    'memory compression',
    'ntoskrnl.exe',

    // ── Deskly itself — locking ourselves would be absurd and break enforcement ──
    'deskly.exe',
    'electron.exe',                     // dev build
]);

/**
 * Returns true if the given process name is a protected system/critical process
 * that must never be locked or killed.
 * @param {string} name  process name, with or without .exe, any case
 */
function isProtectedProcess(name) {
    if (!name) return true; // null/empty → treat as protected (fail-safe)
    const lower = String(name).trim().toLowerCase();
    if (!lower) return true;
    if (PROTECTED_PROCESSES.has(lower)) return true;
    // Also guard the .exe-less form and vice versa
    if (PROTECTED_PROCESSES.has(lower + '.exe')) return true;
    if (lower.endsWith('.exe') && PROTECTED_PROCESSES.has(lower.slice(0, -4))) return true;
    return false;
}

module.exports = { PROTECTED_PROCESSES, isProtectedProcess };
