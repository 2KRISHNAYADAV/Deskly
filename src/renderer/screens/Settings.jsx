import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { SafeAPI } from '../utils/safeApi';
import { trapFocus } from '../hooks/useModal';
import Modal from '../components/Modal';
import Account from './Account';
import '../components/SettingsRefined.css';
import '../styles/account.css';

// ─── Password field ───────────────────────────────────────────────────────────
function PwField({ label, value, onChange, show, onToggleShow, inputRef, placeholder, autoComplete }) {
    return (
        <div className="form-group" style={{ marginBottom: 0 }}>
            <label>{label}</label>
            <div style={{ position: 'relative' }}>
                <input
                    ref={inputRef}
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    style={{ paddingRight: '44px', fontFamily: 'inherit' }}
                />
                <button
                    type="button"
                    aria-label={show ? 'Hide password' : 'Show password'}
                    onClick={onToggleShow}
                    style={{
                        position: 'absolute', right: '10px', top: '50%',
                        transform: 'translateY(-50%)', background: 'none', border: 'none',
                        cursor: 'pointer', color: 'var(--on-surface-variant)', padding: '4px',
                        display: 'flex', alignItems: 'center',
                    }}
                >
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }} aria-hidden="true">
                        {show ? 'visibility_off' : 'visibility'}
                    </span>
                </button>
            </div>
        </div>
    );
}

// ─── Browser Lock Dialog ──────────────────────────────────────────────────────
function LockDialog({ mode, onClose, onSuccess }) {
    const [currentPw, setCurrentPw] = useState('');
    const [newPw,     setNewPw]     = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew,     setShowNew]     = useState(false);
    const [error,   setError]   = useState('');
    const [loading, setLoading] = useState(false);
    const firstInputRef = useRef(null);

    useEffect(() => {
        const t = setTimeout(() => firstInputRef.current?.focus(), 60);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [onClose]);

    const clearError = () => { if (error) setError(''); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (mode === 'set' || mode === 'change') {
            if (newPw.length < 8) { setError('Password must be at least 8 characters.'); return; }
            if (newPw !== confirmPw) { setError('Passwords do not match.'); return; }
        }
        setLoading(true);
        let result;
        if (mode === 'set')         result = await SafeAPI.setBrowserLock(newPw, null);
        else if (mode === 'change') result = await SafeAPI.setBrowserLock(newPw, currentPw);
        else                        result = await SafeAPI.removeBrowserLock(currentPw);
        setLoading(false);
        if (result?.success) onSuccess(mode !== 'remove');
        else setError(result?.error || 'Something went wrong. Please try again.');
    };

    const title       = mode === 'set' ? 'Enable Browser Lock' : mode === 'change' ? 'Change Password' : 'Remove Browser Lock';
    const icon        = mode === 'remove' ? 'lock_open' : 'lock';
    const submitLabel = mode === 'set' ? 'Set Password' : mode === 'change' ? 'Update Password' : 'Remove Lock';

    return (
        <div role="presentation" className="modal-overlay-animated"
            style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.76)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={onClose}
        >
            <div role="dialog" aria-modal="true" aria-labelledby="lock-dialog-title"
                onClick={(e) => e.stopPropagation()} onKeyDown={trapFocus} tabIndex={-1}
                className="modal-animated"
                style={{ background: 'var(--surface-container-highest)', border: '1px solid var(--outline-variant)', borderRadius: '16px', padding: '28px 28px 24px', maxWidth: '400px', width: '90%', boxShadow: '0 24px 48px rgba(0,0,0,0.6)' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 22, color: 'var(--on-surface-variant)' }} aria-hidden="true">{icon}</span>
                    <h2 id="lock-dialog-title" style={{ fontSize: '17px', fontWeight: 600, color: 'var(--on-surface)', margin: 0 }}>{title}</h2>
                </div>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {(mode === 'change' || mode === 'remove') && (
                        <PwField label="Current password" value={currentPw} onChange={(e) => { setCurrentPw(e.target.value); clearError(); }}
                            show={showCurrent} onToggleShow={() => setShowCurrent(p => !p)}
                            inputRef={firstInputRef} placeholder="Enter current password" autoComplete="current-password" />
                    )}
                    {mode === 'remove' && (
                        <p style={{ fontSize: '13px', color: 'var(--on-surface-variant)', lineHeight: 1.5, margin: '-6px 0 0' }}>
                            Enter your current password to disable the lock.
                        </p>
                    )}
                    {(mode === 'set' || mode === 'change') && (
                        <>
                            <PwField label={mode === 'change' ? 'New password' : 'Create a password'}
                                value={newPw} onChange={(e) => { setNewPw(e.target.value); clearError(); }}
                                show={showNew} onToggleShow={() => setShowNew(p => !p)}
                                inputRef={mode === 'set' ? firstInputRef : null}
                                placeholder="At least 8 characters" autoComplete="new-password" />
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Confirm password</label>
                                <input type="password" value={confirmPw}
                                    onChange={(e) => { setConfirmPw(e.target.value); clearError(); }}
                                    placeholder="Re-enter password" autoComplete="new-password"
                                    style={{ fontFamily: 'inherit' }} />
                            </div>
                        </>
                    )}
                    {error && (
                        <p style={{ fontSize: '13px', color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                            <span className="material-symbols-rounded" style={{ fontSize: 15 }} aria-hidden="true">error</span>{error}
                        </p>
                    )}
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
                        <button type="button" onClick={onClose} className="refined-btn">Cancel</button>
                        <button type="submit" disabled={loading}
                            className={mode === 'remove' ? 'danger-btn' : 'refined-btn primary'}
                            style={{ opacity: loading ? 0.7 : 1, cursor: loading ? 'wait' : 'pointer' }}>
                            {loading ? 'Please wait...' : submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Main Settings ────────────────────────────────────────────────────────────
function Settings() {
    const { t } = useTranslation();
    const NAV = [
        { id: 'about',    label: 'About',                          icon: 'info' },
        { id: 'goals',    label: t('settings.sections.goals'),     icon: 'target' },
        { id: 'wellness', label: t('settings.sections.wellness'),  icon: 'self_improvement' },
        { id: 'privacy',  label: t('settings.sections.privacy'),   icon: 'lock' },
        { id: 'system',   label: t('settings.sections.system'),    icon: 'tune' },
        { id: 'storage',  label: t('settings.sections.storage'),   icon: 'folder' },
        { id: 'danger',   label: t('settings.sections.danger'),    icon: 'warning' },
    ];
    const [settings, setSettings]   = useState({ breakReminders: true, breakInterval: 30 });
    const [dailyGoal, setDailyGoal] = useState(8);
    const [autoStart, setAutoStart] = useState(false);
    const [loading, setLoading]             = useState(true);
    const [vaultPath, setVaultPath]         = useState('');
    const [vaultStatus, setVaultStatus]     = useState(null);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [browserLockEnabled, setBrowserLockEnabled] = useState(false);
    const [lockDialog, setLockDialog]       = useState(null);
    const [activeSection, setActiveSection] = useState('about');


    const goalDebounceRef     = useRef(null);
    const intervalDebounceRef = useRef(null);
    const pendingGoalRef      = useRef(null);
    const pendingIntervalRef  = useRef(null);

    useEffect(() => {
        loadSettings();
        loadVaultPath();
    }, []);

    useEffect(() => {
        return () => {
            if (pendingGoalRef.current != null) {
                clearTimeout(goalDebounceRef.current);
                SafeAPI.setDailyGoal(pendingGoalRef.current);
            }
            if (pendingIntervalRef.current != null) {
                clearTimeout(intervalDebounceRef.current);
                const minutes = pendingIntervalRef.current;
                window.electronAPI?.setBreakInterval?.(minutes);
                SafeAPI.setSetting('breakInterval', minutes);
            }
        };
    }, []);

    useEffect(() => {
        if (!confirmDialog) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [confirmDialog]);

    useEffect(() => {
        if (!confirmDialog) return;
        const handler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmDialog(null); } };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [confirmDialog]);

    const loadVaultPath = async () => {
        if (window.electronAPI?.getVaultPath) {
            const p = await window.electronAPI.getVaultPath();
            setVaultPath(p || 'Not configured');
        }
    };

    const loadSettings = async () => {
        const [breakEnabled, breakInt, goal, autoStartEnabled, lockStatus] =
            (await Promise.allSettled([
                SafeAPI.getSetting('breakReminder'),
                SafeAPI.getSetting('breakInterval'),
                SafeAPI.getDailyGoal(),
                SafeAPI.getAutoStart(),
                SafeAPI.getBrowserLockStatus(),
            ])).map(r => r.status === 'fulfilled' ? r.value : null);
        setSettings({ breakReminders: breakEnabled !== false, breakInterval: breakInt || 30 });
        setDailyGoal(goal || 8);
        setAutoStart(autoStartEnabled || false);
        setBrowserLockEnabled(lockStatus?.enabled ?? false);
        setLoading(false);
    };

    const handleBreakToggle      = async (enabled) => { setSettings(p => ({ ...p, breakReminders: enabled })); if (window.electronAPI) await window.electronAPI.toggleBreakReminder(enabled); await SafeAPI.setSetting('breakReminder', enabled); };
    const commitInterval = async (minutes) => {
        pendingIntervalRef.current = null;
        if (window.electronAPI) await window.electronAPI.setBreakInterval(minutes);
        await SafeAPI.setSetting('breakInterval', minutes);
    };
    const handleBreakInterval    = (e) => {
        const minutes = parseInt(e.target.value, 10);
        setSettings(p => ({ ...p, breakInterval: minutes }));
        pendingIntervalRef.current = minutes;
        clearTimeout(intervalDebounceRef.current);
        intervalDebounceRef.current = setTimeout(() => commitInterval(minutes), 350);
    };
    const commitGoal = (hours) => {
        pendingGoalRef.current = null;
        return SafeAPI.setDailyGoal(hours);
    };
    const handleGoalChange       = (e) => {
        const hours = parseInt(e.target.value, 10);
        setDailyGoal(hours);
        pendingGoalRef.current = hours;
        clearTimeout(goalDebounceRef.current);
        goalDebounceRef.current = setTimeout(() => commitGoal(hours), 350);
    };
    const handleAutoStart        = async (enabled) => { setAutoStart(enabled); await SafeAPI.setAutoStart(enabled); };
    const testNotification       = async () => SafeAPI.sendTestNotification();

    const cancelPendingWrites = () => {
        clearTimeout(goalDebounceRef.current);
        clearTimeout(intervalDebounceRef.current);
        pendingGoalRef.current = null;
        pendingIntervalRef.current = null;
    };
    const resetData              = () => setConfirmDialog({ title: 'Delete All Tracking Data', message: 'This will permanently delete all your activity history. This action cannot be undone.', confirmText: 'Delete Everything', onConfirm: async () => {
        cancelPendingWrites();
        try { await SafeAPI.resetData(); } catch (e) { console.error('resetData failed:', e); }
        window.location.reload();
    } });
    const resetSetup             = () => setConfirmDialog({ title: 'Restart Setup Wizard', message: 'This will delete your local Vault and restart the setup process. All local configuration will be lost.', confirmText: 'Run Setup Wizard', onConfirm: async () => {
        cancelPendingWrites();
        try {
            if (window.electronAPI?.nukeVault) {
                await window.electronAPI.nukeVault();
                window.location.reload();
            }
        } catch (e) { console.error('nukeVault failed:', e); }
    } });
    const openVaultFolder        = async () => window.electronAPI?.openVaultFolder?.();
    const changeVaultLocation    = () => setConfirmDialog({ title: 'Move Vault Location', message: 'Your data will be copied to a new folder. The app will need to restart after the move.', confirmText: 'Choose New Location', onConfirm: async () => {
        setVaultStatus('Moving vault...');
        try {
            const result = await window.electronAPI.changeVaultLocation();
            if (!result || result.canceled) { setVaultStatus(null); return; }
            if (result.success) { setVaultPath(result.newPath); setVaultStatus('✓ Moved! Restart required'); }
            else { setVaultStatus('Could not move vault right now. Please try again.'); }
        } catch (e) {
            console.error('changeVaultLocation failed:', e);
            setVaultStatus('Could not move vault right now. Please try again.');
        }
        setTimeout(() => setVaultStatus(null), 5000);
    } });

    if (loading) return (
        <div className="loading-state-animated" style={{ minHeight: '100%' }}>
            <div className="loading-spinner-smooth" />
            <p className="loading-text-animated">Loading settings...</p>
        </div>
    );

    const renderContent = () => {
        switch (activeSection) {
            case 'about':
                return <Account />;

            case 'goals':
                return (
                    <div>
                        <div className="settings-panel-heading">
                            <h2>Goals &amp; Limits</h2>
                            <p>Set your daily screen time target</p>
                        </div>
                        <div className="settings-section-refined">
                            <div className="settings-card-refined">
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Daily Screen Time Goal</span>
                                        <span className="setting-desc">How much screen time you want to allow yourself each day</span>
                                    </div>
                                    <div className="setting-action">
                                        <select className="refined-select" value={dailyGoal} onChange={handleGoalChange}>
                                            {[1,2,3,4,5,6,7,8,9,10,11,12].map(h => (
                                                <option key={h} value={h}>{h} {h === 1 ? 'hour' : 'hours'}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case 'wellness':
                return (
                    <div>
                        <div className="settings-panel-heading">
                            <h2>Wellness</h2>
                            <p>Break reminders and healthy habits</p>
                        </div>
                        <div className="settings-section-refined">
                            <div className="settings-card-refined">
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Break Reminders</span>
                                        <span className="setting-desc">Get notified to take a break periodically</span>
                                    </div>
                                    <div className="setting-action">
                                        <label className="toggle-switch">
                                            <input type="checkbox" checked={settings.breakReminders} onChange={(e) => handleBreakToggle(e.target.checked)} aria-label="Break Reminders" />
                                            <span className="toggle-slider" />
                                        </label>
                                    </div>
                                </div>
                                {settings.breakReminders && (
                                    <div className="setting-row">
                                        <div className="setting-info">
                                            <span className="setting-name">Reminder Interval</span>
                                            <span className="setting-desc">How often you'd like to be reminded</span>
                                        </div>
                                        <div className="setting-action">
                                            <select className="refined-select" value={settings.breakInterval} onChange={handleBreakInterval}>
                                                {[20,30,45,60].map(m => <option key={m} value={m}>Every {m} mins</option>)}
                                            </select>
                                            <button className="refined-btn" onClick={testNotification}>Test</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );

            case 'privacy':
                return (
                    <div>
                        <div className="settings-panel-heading">
                            <h2>Privacy</h2>
                            <p>Local data security and access control</p>
                        </div>
                        <div className="settings-section-refined">
                            <div className="settings-card-refined">
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Browser Activity Lock</span>
                                        <span className="setting-desc">
                                            {browserLockEnabled
                                                ? 'A password is required to view the Browser Activity screen.'
                                                : 'Require a password before anyone can view your browsing data.'}
                                        </span>
                                    </div>
                                    <div className="setting-action">
                                        {browserLockEnabled ? (
                                            <>
                                                <span className="update-status-pill status-up-to-date">
                                                    <span className="material-symbols-rounded" style={{ fontSize: 11, marginRight: 4 }} aria-hidden="true">lock</span>
                                                    Enabled
                                                </span>
                                                <button className="refined-btn" onClick={() => setLockDialog({ mode: 'change' })}>Change</button>
                                                <button className="refined-btn" onClick={() => setLockDialog({ mode: 'remove' })}>Remove</button>
                                            </>
                                        ) : (
                                            <button className="refined-btn primary" onClick={() => setLockDialog({ mode: 'set' })}>Enable</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case 'system':
                return (
                    <div>
                        <div className="settings-panel-heading">
                            <h2>System</h2>
                            <p>Interface language and system startup</p>
                        </div>
                        <div className="settings-section-refined">
                            <div className="settings-card-refined">
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Language</span>
                                        <span className="setting-desc">Interface language for Deskly Academic Edition</span>
                                    </div>
                                    <div className="setting-action">
                                        <span className="update-status-pill status-up-to-date">English</span>
                                    </div>
                                </div>
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Start with Windows</span>
                                        <span className="setting-desc">Launch automatically on system login</span>
                                    </div>
                                    <div className="setting-action">
                                        <label className="toggle-switch">
                                            <input type="checkbox" checked={autoStart} onChange={(e) => handleAutoStart(e.target.checked)} aria-label="Start with Windows" />
                                            <span className="toggle-slider" />
                                        </label>
                                    </div>
                                </div>
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Distribution Type</span>
                                        <span className="setting-desc">Academic Edition (College Final-Year Research Project)</span>
                                    </div>
                                    <div className="setting-action">
                                        <span className="update-status-pill status-up-to-date">Local-First</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case 'storage':
                return (
                    <div>
                        <div className="settings-panel-heading">
                            <h2>Data Storage</h2>
                            <p>Where Deskly stores your activity data</p>
                        </div>
                        <div className="settings-section-refined">
                            <div className="settings-card-refined">
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Vault Location</span>
                                        <span className="setting-desc vault-path" title={vaultPath}>{vaultPath}</span>
                                    </div>
                                    <div className="setting-action">
                                        <button className="refined-btn" onClick={openVaultFolder}>
                                            <span className="material-symbols-rounded" style={{ fontSize: 14 }} aria-hidden="true">folder_open</span>
                                            Open
                                        </button>
                                    </div>
                                </div>
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Move Vault</span>
                                        <span className="setting-desc">Relocate to a different folder on this machine</span>
                                    </div>
                                    <div className="setting-action">
                                        <button className="refined-btn" onClick={changeVaultLocation}>{vaultStatus || 'Move…'}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case 'danger':
                return (
                    <div>
                        <div className="settings-panel-heading">
                            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--error)', letterSpacing: '-0.02em', margin: '0 0 4px' }}>Reset</h2>
                            <p>Destructive actions — cannot be undone</p>
                        </div>
                        <div className="settings-section-refined danger-zone">
                            <div className="settings-card-refined">
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Run Setup Wizard</span>
                                        <span className="setting-desc">Reset configuration and go through initial setup again</span>
                                    </div>
                                    <div className="setting-action">
                                        <button className="danger-btn" onClick={resetSetup}>Run Setup Wizard</button>
                                    </div>
                                </div>
                                <div className="setting-row">
                                    <div className="setting-info">
                                        <span className="setting-name">Delete Activity Data</span>
                                        <span className="setting-desc">Permanently erase all tracking history</span>
                                    </div>
                                    <div className="setting-action">
                                        <button className="danger-btn" onClick={resetData}>Delete Data</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            default: return null;
        }
    };

    return (
        <div className="settings-shell">
            <nav className="settings-pill-nav">
                <div className="settings-pill-track" role="tablist" aria-label="Settings sections" aria-orientation="horizontal">
                    {NAV.map((item) => {
                        const isDanger = item.id === 'danger';
                        const isActive = activeSection === item.id;
                        const showSep  = item.id === 'danger';
                        return (
                            <React.Fragment key={item.id}>
                                {showSep && <div className="s-pill-sep" role="separator" />}
                                <button
                                    id={`settings-tab-${item.id}`}
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-controls={`settings-panel-${item.id}`}
                                    tabIndex={isActive ? 0 : -1}
                                    className={`s-pill-btn${isActive ? ' active' : ''}`}
                                    onClick={() => setActiveSection(item.id)}
                                    style={isDanger && !isActive ? { color: 'rgba(239,68,68,0.45)' } : undefined}
                                >
                                    <span
                                        className="material-symbols-rounded s-pill-icon"
                                        aria-hidden="true"
                                        style={isDanger ? { color: isActive ? 'var(--error)' : 'rgba(239,68,68,0.45)' } : undefined}
                                    >
                                        {item.icon}
                                    </span>
                                    <span className="s-pill-label">{item.label}</span>
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            </nav>

            <div className="settings-content">
                <div className="settings-content-inner">
                    <div
                        key={activeSection}
                        id={`settings-panel-${activeSection}`}
                        role="tabpanel"
                        aria-labelledby={`settings-tab-${activeSection}`}
                        tabIndex={-1}
                        className="settings-panel"
                    >
                        {renderContent()}
                    </div>
                </div>
            </div>

            {lockDialog && (
                <LockDialog mode={lockDialog.mode} onClose={() => setLockDialog(null)}
                    onSuccess={(newEnabled) => { setBrowserLockEnabled(newEnabled); setLockDialog(null); }} />
            )}

            {confirmDialog && (
                <Modal
                    onClose={() => setConfirmDialog(null)}
                    maxWidth={400}
                    footer={
                        <>
                            <button type="button" autoFocus className="dm-btn dm-ghost" onClick={() => setConfirmDialog(null)}>
                                Cancel
                            </button>
                            <button type="button" className="dm-btn dm-danger" onClick={() => { setConfirmDialog(null); confirmDialog.onConfirm(); }}>
                                {confirmDialog.confirmText}
                            </button>
                        </>
                    }
                >
                    <div className="dm-body">
                        <div className="dm-danger-head">
                            <span className="material-symbols-rounded" aria-hidden="true">warning</span>
                            <h2 className="dm-danger-title">{confirmDialog.title}</h2>
                        </div>
                        <p className="dm-danger-body">{confirmDialog.message}</p>
                    </div>
                </Modal>
            )}
        </div>
    );
}

export default Settings;
