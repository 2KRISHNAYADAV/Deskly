import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import AppIcon from '../components/AppIcon';
import Modal from '../components/Modal';
import { formatDuration } from '../utils/formatDuration';
import discordIcon from '../assets/onboarding-icons/icons8-discord-96.png';
import instagramIcon from '../assets/onboarding-icons/icons8-instagram-96.png';
import spotifyIcon from '../assets/onboarding-icons/icons8-spotify-96.png';
import steamIcon from '../assets/onboarding-icons/icons8-steam-96.png';
import youtubeIcon from '../assets/onboarding-icons/icons8-youtube-96.png';
import './AppLock.css';

const PIN_MAX = 6;
const PIN_MIN = 4;

const TEMP_UNLOCK_OPTIONS = [
    { label: '15 minutes', minutes: 15 },
    { label: '30 minutes', minutes: 30 },
    { label: '1 hour',     minutes: 60 },
    { label: '4 hours',    minutes: 240 },
];

const TRIGGER_OPTIONS = [
    { id: 'immediate',     icon: 'block',         label: 'Always locked',     desc: 'Blocked every time it opens' },
    { id: 'schedule',      icon: 'schedule',      label: 'Scheduled hours',   desc: 'Locked only during set times' },
    { id: 'after_minutes', icon: 'timer',         label: 'After daily limit', desc: 'Locks past a usage threshold' },
    { id: 'duration',      icon: 'hourglass_top', label: 'Focus session',     desc: 'Locked for a fixed duration' },
];

function fmtRemaining(ts) {
    if (!ts || Date.now() >= ts) return null;
    const m = Math.ceil((ts - Date.now()) / 60_000);
    if (m < 60) return `${m}m left`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m left` : `${h}h left`;
}

function fmtMins(sec) {
    const m = Math.floor((sec || 0) / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
}

/**
 * Returns the live status of a lock so the card can explain exactly what's
 * happening and why — the difference between "feels broken" and "obviously working".
 * { chip, chipClass, detail }
 */
function describeLock(lock, st = {}) {
    const t   = lock.lockTrigger || { type: 'immediate' };
    const rem = fmtRemaining(lock.tempUnlockUntil);
    if (rem) return { chip: 'Unlocked', chipClass: 'unlocked', detail: `Re-locks when closed · ${rem}` };

    const active = st.isActive;
    switch (t.type) {
        case 'immediate':
            return { chip: 'Active', chipClass: 'enforcing', detail: 'Locked every time it opens' };
        case 'schedule':
            return active
                ? { chip: 'Active now', chipClass: 'enforcing', detail: `Locked until ${t.scheduleEnd}` }
                : { chip: 'Scheduled', chipClass: 'idle', detail: `Locks ${t.scheduleStart}–${t.scheduleEnd}` };
        case 'after_minutes': {
            const used  = fmtMins(st.todayUsageSeconds);
            const limit = t.afterMinutes;
            return active
                ? { chip: 'Active', chipClass: 'enforcing', detail: `Daily limit reached (${limit}m)` }
                : { chip: 'Tracking', chipClass: 'idle', detail: `Locks after ${limit}m · ${used} used today` };
        }
        case 'duration': {
            if (active) {
                const startedAt = t.lockStartedAt || 0;
                const leftMs = (t.lockDurationMinutes || 60) * 60_000 - (Date.now() - startedAt);
                const leftMin = Math.max(0, Math.ceil(leftMs / 60_000));
                return { chip: 'Focus', chipClass: 'enforcing', detail: `Locked for ${leftMin}m more` };
            }
            return { chip: 'Ended', chipClass: 'idle', detail: 'Focus session finished' };
        }
        default:
            return { chip: active ? 'Active' : 'Idle', chipClass: active ? 'enforcing' : 'idle', detail: '' };
    }
}

/* ════════════════════════════════════════════════════════════════
   PinPad — reusable PIN entry (dots + numpad + physical keyboard)
   ════════════════════════════════════════════════════════════════ */
function PinPad({ value, onChange, onComplete, error, disabled }) {
    const captureRef = useRef(null);
    const valueRef   = useRef(value);
    valueRef.current = value;

    const focus = useCallback(() => requestAnimationFrame(() => captureRef.current?.focus()), []);
    useEffect(() => { focus(); }, [focus]);

    useEffect(() => {
        function onKey(e) {
            if (disabled) return;
            if (e.key >= '0' && e.key <= '9') {
                e.preventDefault();
                if (valueRef.current.length >= PIN_MAX) return;
                const next = valueRef.current + e.key;
                onChange(next);
                if (next.length === PIN_MAX) onComplete?.(next);
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                onChange(valueRef.current.slice(0, -1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (valueRef.current.length >= PIN_MIN) onComplete?.(valueRef.current);
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onChange, onComplete, disabled]);

    const tap = (d) => {
        if (disabled || value.length >= PIN_MAX) return;
        const next = value + d;
        onChange(next);
        if (next.length === PIN_MAX) onComplete?.(next);
    };
    const back = () => { if (!disabled) onChange(value.slice(0, -1)); };

    // Keyboard-first by default (desktop). The on-screen keypad is an opt-in
    // accessibility affordance, persisted across sessions.
    const [showPad, setShowPad] = useState(() => {
        try { return localStorage.getItem('applock.keypad') === '1'; } catch { return false; }
    });
    const togglePad = () => {
        setShowPad(prev => {
            const next = !prev;
            try { localStorage.setItem('applock.keypad', next ? '1' : '0'); } catch {}
            if (!next) focus(); // returning to keyboard → refocus capture
            return next;
        });
    };

    return (
        <div className="pp" onMouseDown={focus}>
            <input ref={captureRef} className="pp-capture" inputMode="numeric" tabIndex={-1} aria-hidden
                value="" onChange={() => {}} />
            <div className={`pp-dots ${error ? 'shake' : ''}`}>
                {Array.from({ length: PIN_MAX }).map((_, i) => (
                    <span key={i} className={`pp-dot ${i < value.length ? 'on' : ''} ${error ? 'err' : ''}`} />
                ))}
            </div>

            {!showPad && (
                <p className="pp-hint">Type your PIN, then press Enter</p>
            )}

            {showPad && (
                <div className="pp-pad">
                    {['1','2','3','4','5','6','7','8','9'].map(d => (
                        <button key={d} className="pp-key" onClick={() => tap(d)} tabIndex={-1} disabled={disabled}>{d}</button>
                    ))}
                    <span className="pp-key-blank" />
                    <button className="pp-key" onClick={() => tap('0')} tabIndex={-1} disabled={disabled}>0</button>
                    <button className="pp-key pp-key-fn" onClick={back} tabIndex={-1} disabled={disabled} aria-label="Delete">
                        <span className="material-symbols-rounded" aria-hidden="true">backspace</span>
                    </button>
                </div>
            )}

            <button className="pp-toggle" onClick={togglePad} tabIndex={-1}>
                <span className="material-symbols-rounded" aria-hidden="true">{showPad ? 'keyboard' : 'dialpad'}</span>
                {showPad ? 'Use keyboard' : 'Show keypad'}
            </button>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   Setup — first-run onboarding (create master PIN)
   ════════════════════════════════════════════════════════════════ */
function SetupFlow({ onDone, stats }) {
    const [step,         setStep]         = useState('intro');  // intro | create | confirm
    const [method,       setMethod]       = useState('pin');
    const [pin1,         setPin1]         = useState('');
    const [pin2,         setPin2]         = useState('');
    const [pw1,          setPw1]          = useState('');
    const [pw2,          setPw2]          = useState('');
    const [error,        setError]        = useState('');
    const [busy,         setBusy]         = useState(false);
    const [selectedApps, setSelectedApps] = useState(() => new Set());

    const isPIN = method === 'pin';

    const toggleSetupApp = useCallback((name) => {
        setSelectedApps(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    }, []);

    async function finish(secret) {
        setBusy(true);
        try {
            const r = await window.electronAPI.setupMaster(secret, method);
            if (r.success) {
                if (selectedApps.size > 0) {
                    await Promise.all([...selectedApps].map(name =>
                        window.electronAPI.addAppLock(name, {
                            processName: name.endsWith('.exe') ? name : name + '.exe',
                            displayName: name,
                            lockTrigger: { type: 'immediate' },
                            category: null,
                        }).catch(() => {})
                    ));
                }
                // Clear both entered secrets before leaving the flow.
                setPin1(''); setPin2(''); setPw1(''); setPw2('');
                onDone();
            }
        } catch { setError('Could not set up. Try again.'); }
        finally { setBusy(false); }
    }

    function proceedCreate(val) {
        const v = val ?? (isPIN ? pin1 : pw1);
        if (v.length < PIN_MIN) { setError(`Use at least ${PIN_MIN} ${isPIN ? 'digits' : 'characters'}`); return; }
        setError('');
        setStep('confirm');
    }

    function proceedConfirm(val) {
        const a = isPIN ? pin1 : pw1;
        const b = val ?? (isPIN ? pin2 : pw2);
        if (a !== b) {
            setError(isPIN ? "PINs don't match" : "Passwords don't match");
            if (isPIN) setPin2('');
            return;
        }
        finish(a);
    }

    if (step === 'intro') {
        // Fixed set of 5 psychologically relevant distracting apps, shown as
        // permanent visual examples (not derived from the user's real apps).
        const DEMO_APPS = [
            { name: 'Discord', icon: discordIcon },
            { name: 'Instagram', icon: instagramIcon },
            { name: 'Spotify', icon: spotifyIcon },
            { name: 'YouTube', icon: youtubeIcon },
            { name: 'Steam', icon: steamIcon },
        ];

        // Gather real user apps (non-Deskly, non-system-protected, with usage) for the chips section
        const realApps = (stats?.apps || [])
            .filter(a => {
                if (!a?.name) return false;
                const lower = String(a.name).toLowerCase();
                if (lower.includes('deskly')) return false;
                if ((a.seconds || 0) <= 0) return false;
                // Filter out obvious system-protected processes from the intro chips
                const protectedKeywords = ['explorer', 'dwm', 'winlogon', 'csrss', 'lsass', 'svchost', 'system', 'registry', 'taskmgr', 'conhost'];
                if (protectedKeywords.some(k => lower.includes(k))) return false;
                return true;
            })
            .slice(0, 6);

        const selCount = selectedApps.size;

        return (
            <div key="intro" className="lk-intro">

                <div className="lk-intro-preview">
                    {DEMO_APPS.map((app, i) => (
                        <div key={app.name} className="lk-intro-prev-app"
                            style={{ animationDelay: `${i * 0.06}s` }}>
                            <img className="lk-intro-demo-icon" src={app.icon} alt="" aria-hidden="true" />
                            <div className="lk-intro-prev-lock">
                                <span className="material-symbols-rounded" aria-hidden="true">lock</span>
                            </div>
                        </div>
                    ))}
                </div>

                <h1 className="lk-intro-title">Lock what pulls you back</h1>
                <p className="lk-intro-sub">
                    Set one PIN. Block any app — social, games, anything — until you choose to open it.
                </p>

                <div className="lk-intro-reassurance">
                    {[
                        { icon: 'restart_alt', text: 'Reset anytime' },
                        { icon: 'edit',        text: 'Edit any lock' },
                        { icon: 'key',         text: 'One PIN for all' },
                    ].map(r => (
                        <div key={r.icon} className="lk-intro-reassurance-item">
                            <span className="material-symbols-rounded" aria-hidden="true">{r.icon}</span>
                            <span>{r.text}</span>
                        </div>
                    ))}
                </div>

                {realApps.length > 0 && (
                    <div className="lk-intro-chips-wrap">
                        <span className="lk-intro-chips-label">Choose which apps to protect first</span>
                        <div className="lk-intro-chips">
                            {realApps.map(app => {
                                const on = selectedApps.has(app.name);
                                return (
                                    <button
                                        key={app.name}
                                        className={`lk-intro-chip${on ? ' on' : ''}`}
                                        onClick={() => toggleSetupApp(app.name)}
                                    >
                                        <AppIcon appName={app.name} size={17} />
                                        <span>{app.name.replace(/\.exe$/i, '')}</span>
                                        {on && (
                                            <span className="material-symbols-rounded lk-intro-chip-ic" aria-hidden="true">lock</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                <button className="lk-cta" onClick={() => setStep('create')}>
                    {selCount > 0
                        ? `Set up PIN & lock ${selCount} app${selCount !== 1 ? 's' : ''}`
                        : 'Set up a PIN'}
                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </button>

                <p className="lk-intro-note">
                    Forgotten your PIN? You can always reset without losing any data.
                </p>
            </div>
        );
    }

    const onCreate  = step === 'create';
    return (
        <div key={onCreate ? 'create' : 'confirm'} className="lk-stage">
            {/* Step indicator */}
            <div className="lk-steps">
                <span className="lk-step on" />
                <span className={`lk-step ${onCreate ? '' : 'on'}`} />
            </div>

            <div className="lk-stage-icon">
                <span className="material-symbols-rounded" aria-hidden="true">{onCreate ? 'pin' : 'check_circle'}</span>
            </div>
            <h1 className="lk-stage-title">{onCreate ? 'Create your PIN' : 'Confirm your PIN'}</h1>
            <p className="lk-stage-sub">
                {onCreate ? "You'll enter this to unlock apps and manage locks." : 'Enter the same PIN once more.'}
            </p>

            {onCreate && (
                <div className="lk-method-toggle">
                    {['pin', 'password'].map(m => (
                        <button key={m} className={`lk-method-btn ${method === m ? 'on' : ''}`}
                            onClick={() => { setMethod(m); setError(''); setPin1(''); setPin2(''); setPw1(''); setPw2(''); }}>
                            <span className="material-symbols-rounded" aria-hidden="true">{m === 'pin' ? 'pin' : 'password'}</span>
                            {m === 'pin' ? 'PIN' : 'Password'}
                        </button>
                    ))}
                </div>
            )}

            {isPIN ? (
                <PinPad
                    value={onCreate ? pin1 : pin2}
                    onChange={onCreate ? (v) => { setPin1(v); setError(''); } : (v) => { setPin2(v); setError(''); }}
                    onComplete={onCreate ? proceedCreate : proceedConfirm}
                    error={!!error}
                    disabled={busy}
                />
            ) : (
                <div className="lk-pw-stage">
                    <input className="lk-pw-input" type="password" autoFocus
                        value={onCreate ? pw1 : pw2}
                        onChange={(e) => { onCreate ? setPw1(e.target.value) : setPw2(e.target.value); setError(''); }}
                        onKeyDown={(e) => e.key === 'Enter' && (onCreate ? proceedCreate() : proceedConfirm())}
                        placeholder={onCreate ? 'Create a password' : 'Confirm password'} />
                </div>
            )}

            <div className="lk-stage-msg">{error && <span className="lk-err" role="alert">{error}</span>}</div>

            <div className="lk-stage-actions">
                {!onCreate && (
                    <button className="lk-btn lk-btn-ghost" onClick={() => { setStep('create'); setPin2(''); setPw2(''); setError(''); }} disabled={busy}>
                        Back
                    </button>
                )}
                {!isPIN && (
                    <button className="lk-btn lk-btn-primary" onClick={() => onCreate ? proceedCreate() : proceedConfirm()} disabled={busy}>
                        {onCreate ? 'Continue' : (busy ? 'Setting up…' : 'Confirm')}
                    </button>
                )}
                {isPIN && onCreate && (pin1.length >= PIN_MIN && pin1.length < PIN_MAX) && (
                    <button className="lk-btn lk-btn-primary" onClick={() => proceedCreate()}>Continue</button>
                )}
                {isPIN && !onCreate && (pin2.length >= PIN_MIN && pin2.length < PIN_MAX) && (
                    <button className="lk-btn lk-btn-primary" onClick={() => proceedConfirm()} disabled={busy}>
                        {busy ? 'Setting up…' : 'Confirm'}
                    </button>
                )}
            </div>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   Auth gate — unlock the management page
   ════════════════════════════════════════════════════════════════ */
function AuthGate({ authMethod, onUnlocked, onReset }) {
    const [pin,    setPin]    = useState('');
    const [pw,     setPw]     = useState('');
    const [error,  setError]  = useState('');
    const [busy,   setBusy]   = useState(false);
    const [lockout, setLockout] = useState(0);
    const [forgot, setForgot] = useState(false);
    const isPIN = authMethod !== 'password';
    // Absolute wall-clock deadline for the current lockout. Decrementing a plain
    // counter drifts across sleep/throttle; anchoring to a timestamp and deriving
    // the remaining seconds each tick keeps it honest.
    const lockoutEndRef = useRef(0);

    useEffect(() => {
        if (lockout <= 0) return;
        const tick = () => {
            const secs = Math.max(0, Math.ceil((lockoutEndRef.current - Date.now()) / 1000));
            setLockout(secs);
        };
        const t = setInterval(tick, 1000);
        const onVis = () => { if (document.visibilityState === 'visible') tick(); };
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('focus', onVis);
        return () => {
            clearInterval(t);
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('focus', onVis);
        };
    }, [lockout > 0]); // re-arm only when crossing the active/inactive boundary

    async function verify(val) {
        const secret = val ?? (isPIN ? pin : pw);
        if (isPIN && secret.length < PIN_MIN) return;
        setBusy(true);
        try {
            const r = await window.electronAPI.verifyMaster(secret);
            // Clear the secret from state on EVERY outcome, including success — otherwise
            // the plaintext PIN/password lingers in the fiber tree and any heap/crash dump.
            if (r.success) { setPin(''); setPw(''); onUnlocked(); return; }
            if (r.reason === 'locked_out') {
                const secs = r.remainingSeconds || 300;
                lockoutEndRef.current = Date.now() + secs * 1000;
                setLockout(secs);
                setError('');
            }
            else setError('Incorrect. Try again.');
            setPin(''); setPw('');
        } catch { setError('Something went wrong.'); setPin(''); setPw(''); }
        finally { setBusy(false); }
    }

    const fmt = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

    // Early return AFTER all hooks (Rules of Hooks).
    if (forgot) {
        return (
            <div className="lk-stage">
                <ResetFlow onBack={() => setForgot(false)} onDone={onReset} />
            </div>
        );
    }

    return (
        <div className="lk-stage">
            <div className="lk-stage-icon"><span className="material-symbols-rounded" aria-hidden="true">lock</span></div>
            <h1 className="lk-stage-title">App Lock</h1>
            <p className="lk-stage-sub">Enter your PIN to manage locked apps</p>

            {lockout > 0 ? (
                <div className="lk-lockout-stage">
                    <span className="material-symbols-rounded" aria-hidden="true">hourglass_top</span>
                    <div className="lk-lockout-time">{fmt(lockout)}</div>
                    <p>Too many attempts. Try again shortly.</p>
                </div>
            ) : isPIN ? (
                <PinPad value={pin} onChange={(v) => { setPin(v); setError(''); }} onComplete={verify} error={!!error} disabled={busy} />
            ) : (
                <div className="lk-pw-stage">
                    <input className="lk-pw-input" type="password" autoFocus value={pw}
                        onChange={(e) => { setPw(e.target.value); setError(''); }}
                        onKeyDown={(e) => e.key === 'Enter' && verify()} placeholder="Enter password" />
                    <button className="lk-btn lk-btn-primary" style={{ marginTop: 14 }} onClick={() => verify()} disabled={busy || !pw}>
                        {busy ? 'Verifying…' : 'Unlock'}
                    </button>
                </div>
            )}
            <div className="lk-stage-msg">{error && <span className="lk-err" role="alert">{error}</span>}</div>
            <button className="lk-forgot-link" onClick={() => setForgot(true)}>Forgot PIN?</button>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   Lock wizard — pick trigger + confirm (master already set)
   ════════════════════════════════════════════════════════════════ */
function LockWizard({ app, onClose, onSaved }) {
    const [type,       setType]       = useState('immediate');
    const [afterMin,   setAfterMin]   = useState(60);
    const [start,      setStart]      = useState('22:00');
    const [end,        setEnd]        = useState('08:00');
    const [durMin,     setDurMin]     = useState(120);
    const [busy,       setBusy]       = useState(false);

    const [saveErr, setSaveErr] = useState('');

    async function save() {
        setBusy(true);
        setSaveErr('');
        const lockTrigger = {
            type,
            afterMinutes:        type === 'after_minutes' ? afterMin : null,
            scheduleStart:       type === 'schedule' ? start : null,
            scheduleEnd:         type === 'schedule' ? end : null,
            lockDurationMinutes: type === 'duration' ? durMin : null,
        };
        try {
            const r = await window.electronAPI.addAppLock(app.name, {
                processName: app.name.endsWith('.exe') ? app.name : app.name + '.exe',
                displayName: app.displayName || app.name,
                lockTrigger,
                category: app.category || null,
            });
            if (r && r.success) {
                onSaved();
                onClose();
            } else {
                const reason = r?.reason;
                setSaveErr(
                    reason === 'protected'  ? "This app can't be locked (system-protected)."
                  : reason === 'no_master' ? 'Set up your PIN first.'
                  : reason === 'invalid'   ? 'Invalid app.'
                  : 'Could not lock this app. Please try again.'
                );
            }
        } catch (err) {
            setSaveErr('Something went wrong. Please try again.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="dm-body lk-wizard">
            <div className="lk-wizard-app">
                <AppIcon appName={app.name} size={40} />
                <div>
                    <div className="lk-wizard-app-name">{app.displayName || app.name}</div>
                    <div className="lk-wizard-app-sub">{formatDuration(app.seconds || 0)} recently</div>
                </div>
            </div>

            <h3 className="lk-wizard-q">When should it lock?</h3>
            <div className="lk-triggers" role="radiogroup" aria-label="When should it lock?">
                {TRIGGER_OPTIONS.map(o => (
                    <button key={o.id} className={`lk-trigger ${type === o.id ? 'on' : ''}`}
                        role="radio" aria-checked={type === o.id} onClick={() => setType(o.id)}>
                        <span className="material-symbols-rounded lk-trigger-ic" aria-hidden="true">{o.icon}</span>
                        <div className="lk-trigger-txt">
                            <span className="lk-trigger-label">{o.label}</span>
                            <span className="lk-trigger-desc">{o.desc}</span>
                        </div>
                        <span className={`lk-radio ${type === o.id ? 'on' : ''}`} />
                    </button>
                ))}
            </div>

            {type === 'after_minutes' && (
                <div className="lk-cfg">
                    <span>Lock after</span>
                    <input type="number" min="1" max="1440" value={afterMin}
                        onChange={e => setAfterMin(Math.min(1440, Math.max(1, +e.target.value || 1)))} />
                    <span>min of use today</span>
                </div>
            )}
            {type === 'schedule' && (
                <div className="lk-cfg">
                    <input type="time" value={start} onChange={e => setStart(e.target.value)} />
                    <span>to</span>
                    <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
                </div>
            )}
            {type === 'duration' && (
                <div className="lk-cfg">
                    <span>Lock for</span>
                    <input type="number" min="1" max="1440" value={durMin}
                        onChange={e => setDurMin(Math.min(1440, Math.max(1, +e.target.value || 1)))} />
                    <span>min from now</span>
                </div>
            )}

            {saveErr && <p className="lk-err" role="alert" style={{ textAlign: 'center', margin: '4px 0 0' }}>{saveErr}</p>}

            <div className="lk-wizard-foot">
                <button className="lk-btn lk-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="lk-btn lk-btn-primary" onClick={save} disabled={busy}>
                    {busy ? 'Locking…' : 'Lock app'}
                </button>
            </div>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   Management screen
   ════════════════════════════════════════════════════════════════ */
function Management({ stats, onReset }) {
    const { t } = useTranslation();
    const [locks,     setLocks]     = useState({});
    const [status,    setStatus]    = useState({});
    const [lockable,  setLockable]  = useState([]);
    const [loading,   setLoading]   = useState(true);
    const [picker,    setPicker]    = useState(false);
    const [wizApp,    setWizApp]    = useState(null);
    const [removeApp, setRemoveApp] = useState(null); // {key, displayName}
    const [settings,  setSettings]  = useState(false);
    const [search,    setSearch]    = useState('');
    const [, force]   = useState(0);
    const mountedRef  = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Periodically refresh status so schedule/usage chips stay live.
    useEffect(() => {
        const t = setInterval(async () => {
            try {
                const st = await window.electronAPI.getAppLockStatus();
                if (!mountedRef.current) return;
                setStatus(st || {});
            } catch {}
            if (mountedRef.current) force(n => n + 1);
        }, 15_000);
        return () => clearInterval(t);
    }, []);

    const load = useCallback(async () => {
        try {
            const [all, st, apps] = await Promise.all([
                window.electronAPI.getAppLocks().catch(() => ({})),
                window.electronAPI.getAppLockStatus().catch(() => ({})),
                window.electronAPI.getLockableApps().catch(() => []),
            ]);
            setLocks(all || {});
            setStatus(st || {});

            // Merge the historical catalog with today's live apps so the picker is
            // never empty — dedupe by lowercased name, exclude already-locked.
            const lockedSet = new Set(Object.keys(all || {}));
            const merged = new Map();
            for (const a of (apps || [])) {
                const k = (a.name || '').toLowerCase();
                if (k && !lockedSet.has(k)) merged.set(k, a);
            }
            for (const a of (stats?.apps || [])) {
                const k = (a.name || '').toLowerCase();
                if (k && !lockedSet.has(k) && !merged.has(k)) {
                    merged.set(k, { name: a.name, displayName: a.displayName || a.name, seconds: a.seconds || 0, category: a.category || null });
                }
            }
            setLockable([...merged.values()].sort((x, y) => (y.seconds || 0) - (x.seconds || 0)));
        } finally { setLoading(false); }
    }, [stats?.apps]);
    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!window.electronAPI?.onAppLockStatusUpdate) return;
        return window.electronAPI.onAppLockStatusUpdate((st) => setStatus(st || {}));
    }, []);

    const lockedKeys = Object.keys(locks);

    const filteredLockable = useMemo(() =>
        search
            ? lockable.filter(a => (a.displayName || a.name).toLowerCase().includes(search.toLowerCase()))
            : lockable,
    [lockable, search]);

    return (
        <div className="lk-screen">
            <div className="page-header page-header-animated lk-header">
                <div>
                    <h1 className="page-title">{t('appLock.title')}</h1>
                    <p className="page-subtitle">{t('appLock.subtitle')}</p>
                </div>
                <button className="lk-icon-btn" onClick={() => setSettings(true)} aria-label="App Lock settings" title="Settings">
                    <span className="material-symbols-rounded" aria-hidden="true">settings</span>
                </button>
            </div>

            {/* Status bar */}
            <div className="lk-status-bar page-section">
                <div className={`lk-shield ${lockedKeys.length ? 'active' : ''}`}>
                    <span className="material-symbols-rounded" aria-hidden="true">{lockedKeys.length ? 'shield' : 'shield'}</span>
                </div>
                <div className="lk-status-text">
                    <div className="lk-status-title">
                        {lockedKeys.length ? 'Protection active' : 'No apps locked'}
                    </div>
                    <div className="lk-status-sub">
                        {lockedKeys.length
                            ? `${lockedKeys.length} app${lockedKeys.length === 1 ? '' : 's'} protected`
                            : 'Lock an app to get started'}
                    </div>
                </div>
                <button className="lk-add-btn" onClick={() => { setSearch(''); setPicker(true); }}>
                    <span className="material-symbols-rounded" aria-hidden="true">add</span>
                    Lock an app
                </button>
            </div>

            {/* Locked apps */}
            {lockedKeys.length > 0 && (
                <section className="lk-section page-section">
                    <h2 className="lk-section-title">Locked apps</h2>
                    <div className="lk-list">
                        {lockedKeys.map((key) => {
                            const lock = locks[key];
                            const st   = status[key] || {};
                            const desc = describeLock(lock, st);
                            return (
                                <div key={key} className="lk-card list-item-animated">
                                    <AppIcon appName={key} size={38} />
                                    <div className="lk-card-info">
                                        <span className="lk-card-name">
                                            <span title={lock.displayName}>{lock.displayName}</span>
                                            {lock.category && <span className="lk-cat-tag">{lock.category}</span>}
                                        </span>
                                        <span className="lk-card-trigger">{desc.detail}</span>
                                    </div>
                                    <div className="lk-card-status">
                                        <span className={`lk-chip ${desc.chipClass}`}>
                                            {desc.chipClass === 'enforcing' && <span className="lk-chip-dot" />}
                                            {desc.chip}
                                        </span>
                                    </div>
                                    <button className="lk-remove" onClick={() => setRemoveApp({ key, displayName: lock.displayName })} aria-label="Remove lock" title="Remove lock">
                                        <span className="material-symbols-rounded" aria-hidden="true">close</span>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {loading && (
                <div className="loading-state-animated">
                    <div className="loading-spinner-smooth" />
                    <p className="loading-text-animated">Loading…</p>
                </div>
            )}

            {/* App picker */}
            {picker && (
                <Modal onClose={() => setPicker(false)} maxWidth={440} title="Choose an app">
                    <div className="dm-body lk-picker">
                        <div className="lk-search">
                            <span className="material-symbols-rounded" aria-hidden="true">search</span>
                            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps…" />
                        </div>
                        {filteredLockable.length === 0 ? (
                            <p className="lk-picker-empty">{search ? 'No matching apps.' : 'No apps available to lock.'}</p>
                        ) : (
                            <div className="lk-picker-list">
                                {filteredLockable.map(app => (
                                    <button key={app.name} className="lk-picker-row" onClick={() => { setWizApp(app); setPicker(false); }}>
                                        <AppIcon appName={app.name} size={32} />
                                        <div className="lk-picker-info">
                                            <span className="lk-picker-name" title={app.displayName || app.name}>{app.displayName || app.name}</span>
                                            <span className="lk-picker-usage">
                                                {app.category && <span className="lk-cat-tag">{app.category}</span>}
                                                {formatDuration(app.seconds || 0)} recently
                                            </span>
                                        </div>
                                        <span className="material-symbols-rounded lk-picker-go" aria-hidden="true">chevron_right</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </Modal>
            )}

            {/* Lock wizard */}
            {wizApp && (
                <Modal onClose={() => setWizApp(null)} maxWidth={440} title={`Lock ${wizApp.displayName || wizApp.name}`}
                    back={() => { setWizApp(null); setPicker(true); }}>
                    <LockWizard app={wizApp} onClose={() => setWizApp(null)} onSaved={load} />
                </Modal>
            )}

            {/* Remove (PIN required) */}
            {removeApp && (
                <Modal onClose={() => setRemoveApp(null)} maxWidth={360} title="Remove lock">
                    <RemoveLockFlow app={removeApp} onClose={() => setRemoveApp(null)} onRemoved={load} />
                </Modal>
            )}

            {/* Settings */}
            {settings && (
                <Modal onClose={() => setSettings(false)} maxWidth={420} title="App Lock settings">
                    <SettingsFlow onClose={() => setSettings(false)} onChanged={load} onReset={() => { setSettings(false); onReset(); }} />
                </Modal>
            )}
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   Remove lock — requires the master PIN
   ════════════════════════════════════════════════════════════════ */
function RemoveLockFlow({ app, onClose, onRemoved }) {
    const [pin,   setPin]   = useState('');
    const [error, setError] = useState('');
    const [busy,  setBusy]  = useState(false);

    async function confirm(secret) {
        const v = secret ?? pin;
        if (v.length < PIN_MIN) return;
        setBusy(true);
        try {
            const r = await window.electronAPI.removeAppLock(app.key, v);
            if (r.success) { setPin(''); onRemoved(); onClose(); }
            else { setError(r.reason === 'locked_out' ? 'Too many attempts. Wait and retry.' : 'Incorrect PIN.'); setPin(''); }
        } catch { setError('Something went wrong.'); setPin(''); }
        finally { setBusy(false); }
    }

    return (
        <div className="dm-body lk-remove-modal">
            <p className="lk-remove-text">
                Enter your PIN to remove the lock on <strong>{app.displayName}</strong>.
            </p>
            <PinPad value={pin} onChange={(v) => { setPin(v); setError(''); }} onComplete={confirm} error={!!error} disabled={busy} />
            <div className="lk-stage-msg" style={{ justifyContent: 'center' }}>{error && <span className="lk-err" role="alert">{error}</span>}</div>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   Settings — change PIN / reset App Lock
   ════════════════════════════════════════════════════════════════ */
function SettingsFlow({ onClose, onChanged, onReset }) {
    const [view, setView] = useState('menu'); // menu | change | reset

    if (view === 'change') return <ChangePinFlow onBack={() => setView('menu')} onDone={() => { onChanged(); onClose(); }} />;
    if (view === 'reset')  return <ResetFlow onBack={() => setView('menu')} onDone={() => onReset()} />;

    return (
        <div className="dm-body lk-settings">
            <button className="lk-setting-row" onClick={() => setView('change')}>
                <span className="material-symbols-rounded" aria-hidden="true">password</span>
                <div className="lk-setting-text">
                    <span className="lk-setting-title">Change PIN</span>
                    <span className="lk-setting-desc">Update your master PIN or password</span>
                </div>
                <span className="material-symbols-rounded lk-setting-go" aria-hidden="true">chevron_right</span>
            </button>
            <button className="lk-setting-row danger" onClick={() => setView('reset')}>
                <span className="material-symbols-rounded" aria-hidden="true">restart_alt</span>
                <div className="lk-setting-text">
                    <span className="lk-setting-title">Reset App Lock</span>
                    <span className="lk-setting-desc">Remove all locks and clear your PIN</span>
                </div>
                <span className="material-symbols-rounded lk-setting-go" aria-hidden="true">chevron_right</span>
            </button>
        </div>
    );
}

function ChangePinFlow({ onBack, onDone }) {
    const [step,  setStep]  = useState('current'); // current | new | confirm
    const [cur,   setCur]   = useState('');
    const [nw,    setNw]    = useState('');
    const [cf,    setCf]    = useState('');
    const [error, setError] = useState('');
    const [busy,  setBusy]  = useState(false);

    async function verifyCurrent(secret) {
        const v = secret ?? cur;
        if (v.length < PIN_MIN) return;
        setBusy(true);
        try {
            const r = await window.electronAPI.verifyMaster(v);
            if (r.success) { setStep('new'); setError(''); }
            else { setError(r.reason === 'locked_out' ? 'Locked out. Try later.' : 'Incorrect PIN.'); setCur(''); }
        } finally { setBusy(false); }
    }
    function toConfirm(secret) {
        const v = secret ?? nw;
        if (v.length < PIN_MIN) { setError(`At least ${PIN_MIN} digits`); return; }
        setError(''); setStep('confirm');
    }
    async function finish(secret) {
        const v = secret ?? cf;
        if (v !== nw) { setError("PINs don't match"); setCf(''); return; }
        setBusy(true);
        try {
            const r = await window.electronAPI.changeMaster(cur, nw, 'pin');
            if (r.success) { setCur(''); setNw(''); setCf(''); onDone(); }
            else setError('Could not change PIN.');
        } finally { setBusy(false); }
    }

    const cfg = {
        current: { title: 'Current PIN', val: cur, set: setCur, on: verifyCurrent },
        new:     { title: 'New PIN',     val: nw,  set: setNw,  on: toConfirm },
        confirm: { title: 'Confirm new PIN', val: cf, set: setCf, on: finish },
    }[step];

    return (
        <div className="dm-body lk-change" key={step}>
            <div className="lk-change-head">
                <button className="lk-mini-back" onClick={onBack} aria-label="Back"><span className="material-symbols-rounded" aria-hidden="true">arrow_back</span></button>
                <span className="lk-change-title">{cfg.title}</span>
            </div>
            <PinPad value={cfg.val} onChange={(v) => { cfg.set(v); setError(''); }} onComplete={cfg.on} error={!!error} disabled={busy} />
            <div className="lk-stage-msg" style={{ justifyContent: 'center' }}>{error && <span className="lk-err" role="alert">{error}</span>}</div>
        </div>
    );
}

// Enforced security delay (seconds) before a lock reset can proceed. A self-service
// reset with no delay is equivalent to no lock — anyone at the keyboard could clear it
// in two clicks. The countdown makes the reset a deliberate, timed action that a
// passer-by can't complete quickly while the owner is away. The authoritative
// protection (OS-account / second-factor verification) must be enforced in the main
// process inside resetAppLock(); this delay is the renderer-side deterrent.
const RESET_DELAY_SECONDS = 30;

function ResetFlow({ onBack, onDone }) {
    const [confirm, setConfirm] = useState('');
    const [busy,    setBusy]    = useState(false);
    const [error,   setError]   = useState('');
    const [remaining, setRemaining] = useState(RESET_DELAY_SECONDS);
    const typed = confirm.trim().toUpperCase() === 'RESET';

    // Tick the security-delay countdown once per second, down to zero.
    useEffect(() => {
        if (remaining <= 0) return;
        const id = setTimeout(() => setRemaining(r => Math.max(0, r - 1)), 1000);
        return () => clearTimeout(id);
    }, [remaining]);

    const ready = typed && remaining <= 0 && !busy;

    async function doReset() {
        if (!ready) return;
        setBusy(true);
        setError('');
        try {
            const result = await window.electronAPI.resetAppLock();
            // Treat an explicit failure (e.g. main-process second-factor rejected) as an error
            // rather than silently proceeding.
            if (result && result.success === false) {
                setError(result.error || 'Reset was not authorized.');
                return;
            }
            onDone();
        } catch (e) {
            console.error('App lock reset failed:', e);
            setError('Could not reset the app lock. Please try again.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="dm-body lk-reset">
            <div className="lk-reset-icon"><span className="material-symbols-rounded" aria-hidden="true">warning</span></div>
            <p id="lk-reset-consequence" className="lk-reset-text">
                This removes <strong>all locks</strong> and clears your PIN. Use this only if you've
                forgotten your PIN — it cannot be undone.
            </p>
            <label className="lk-reset-label">Type <strong>RESET</strong> to confirm</label>
            <input className="lk-pw-input" value={confirm} onChange={e => { setConfirm(e.target.value); setError(''); }}
                placeholder="RESET" autoFocus
                onKeyDown={e => e.key === 'Enter' && ready && doReset()} />
            {remaining > 0 && (
                <p className="lk-reset-text" style={{ opacity: 0.75, marginTop: 8 }} aria-live="polite">
                    Security delay: reset available in {remaining}s
                </p>
            )}
            {error && (
                <div className="lk-stage-msg" role="alert" style={{ justifyContent: 'center' }}>
                    <span className="lk-err">{error}</span>
                </div>
            )}
            <div className="lk-wizard-foot">
                <button className="lk-btn lk-btn-ghost" onClick={onBack} disabled={busy}>Cancel</button>
                <button className="lk-btn lk-btn-danger" onClick={doReset} disabled={!ready}
                    aria-describedby="lk-reset-consequence">
                    {busy ? 'Resetting…' : remaining > 0 ? `Wait ${remaining}s…` : 'Reset App Lock'}
                </button>
            </div>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   Root — state machine
   ════════════════════════════════════════════════════════════════ */
export default function AppLock({ stats }) {
    const [mode,       setMode]       = useState('loading'); // loading|setup|auth|manage
    const [authMethod, setAuthMethod] = useState('pin');

    const refresh = useCallback(async () => {
        try {
            const configured = await window.electronAPI.isMasterConfigured();
            if (!configured) { setMode('setup'); return; }
            const meta = await window.electronAPI.getAppLockMeta?.();
            setAuthMethod(meta?.authMethod || 'pin');
            setMode('auth');
        } catch { setMode('setup'); }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    if (mode === 'loading') {
        return (
            <div className="lk-screen">
                <div className="loading-state-animated">
                    <div className="loading-spinner-smooth" />
                    <p className="loading-text-animated">Loading…</p>
                </div>
            </div>
        );
    }
    if (mode === 'setup') {
        return <div className="lk-screen lk-centered"><SetupFlow onDone={() => setMode('manage')} stats={stats} /></div>;
    }
    if (mode === 'auth') {
        return (
            <div className="lk-screen lk-centered">
                <AuthGate
                    authMethod={authMethod}
                    onUnlocked={() => setMode('manage')}
                    onReset={() => setMode('setup')}
                />
            </div>
        );
    }
    return <Management stats={stats} onReset={() => setMode('setup')} />;
}
