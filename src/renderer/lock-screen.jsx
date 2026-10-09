import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/material-symbols-rounded';
import './screens/LockScreen.css';

const PIN_LENGTH      = 6;
const PIN_MIN         = 4;
const MAX_PASSWORD    = 64;

function LockScreen() {
    const [data,      setData]      = useState(null);
    const [input,     setInput]     = useState('');
    const [status,    setStatus]    = useState('idle');   // idle | checking | success | error | locked_out
    const [errorMsg,  setErrorMsg]  = useState('');
    const [countdown, setCountdown] = useState(0);
    const [showPw,    setShowPw]    = useState(false);
    // Keyboard-first; on-screen keypad is opt-in and persisted.
    const [showPad,   setShowPad]   = useState(() => {
        try { return localStorage.getItem('applock.keypad') === '1'; } catch { return false; }
    });

    const hiddenRef    = useRef(null);
    const countdownRef = useRef(null);
    const statusRef    = useRef('idle');
    const inputRef     = useRef('');
    const isPINRef     = useRef(true);

    statusRef.current = status;
    inputRef.current  = input;

    // Master auth method arrives via lock:data; default to PIN.
    const isPIN = (data?.authMethod ?? 'pin') !== 'password';
    isPINRef.current = isPIN;

    // Keep the hidden input focused so physical-keyboard typing always lands.
    const refocus = useCallback(() => {
        requestAnimationFrame(() => hiddenRef.current?.focus());
    }, []);

    // ── Receive data + auth results from main ──────────────────────────────
    useEffect(() => {
        if (!window.lockAPI) return;

        window.lockAPI.onLockData((d) => {
            setData(d);
            setInput('');
            setStatus('idle');
            setErrorMsg('');
            refocus();
        });

        window.lockAPI.onAuthResult((result) => {
            if (result.success) {
                setStatus('success');
                setInput('');
            } else if (result.reason === 'locked_out') {
                setStatus('locked_out');
                setInput('');
                beginCountdown(result.remainingSeconds || 300);
            } else {
                const left = Math.max(0, 5 - (result.failedAttempts || 0));
                setStatus('error');
                setErrorMsg(
                    (result.failedAttempts || 0) >= 3 && left > 0
                        ? `Incorrect — ${left} attempt${left === 1 ? '' : 's'} left before lockout`
                        : 'Incorrect PIN. Try again.'
                );
                setInput('');
                setTimeout(() => {
                    if (statusRef.current === 'error') { setStatus('idle'); setErrorMsg(''); refocus(); }
                }, 1600);
            }
        });
    }, [refocus]);

    function beginCountdown(seconds) {
        setCountdown(seconds);
        clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
            setCountdown((p) => {
                if (p <= 1) {
                    clearInterval(countdownRef.current);
                    setStatus('idle');
                    setErrorMsg('');
                    refocus();
                    return 0;
                }
                return p - 1;
            });
        }, 1000);
    }
    useEffect(() => () => clearInterval(countdownRef.current), []);

    // ── Submit ──────────────────────────────────────────────────────────────
    const submit = useCallback((value) => {
        const v = (value ?? inputRef.current).trim();
        if (!v || statusRef.current === 'checking' || statusRef.current === 'locked_out' || statusRef.current === 'success') return;
        if (isPINRef.current && v.length < PIN_MIN) return;
        setStatus('checking');
        window.lockAPI?.authenticate(data?.appName, v);
    }, [data]);

    // ── Physical keyboard handling (the fix) ──────────────────────────────────
    useEffect(() => {
        function onKeyDown(e) {
            if (statusRef.current === 'checking' || statusRef.current === 'locked_out' || statusRef.current === 'success') return;

            if (isPINRef.current) {
                if (e.key >= '0' && e.key <= '9') {
                    e.preventDefault();
                    setInput((prev) => {
                        if (prev.length >= PIN_LENGTH) return prev;
                        const next = prev + e.key;
                        if (next.length === PIN_LENGTH) setTimeout(() => submit(next), 120);
                        return next;
                    });
                } else if (e.key === 'Backspace') {
                    e.preventDefault();
                    setInput((prev) => prev.slice(0, -1));
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                }
            } else {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [submit]);

    // Numpad (mouse) handlers
    const tapDigit = (d) => {
        if (statusRef.current !== 'idle' && statusRef.current !== 'error') return;
        setInput((prev) => {
            if (prev.length >= PIN_LENGTH) return prev;
            const next = prev + d;
            if (next.length === PIN_LENGTH) setTimeout(() => submit(next), 120);
            return next;
        });
        if (status === 'error') { setStatus('idle'); setErrorMsg(''); }
    };
    const tapBack = () => {
        if (statusRef.current === 'checking') return;
        setInput((prev) => prev.slice(0, -1));
    };

    const fmtCountdown = (s) => {
        const m = Math.floor(s / 60), sec = s % 60;
        return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `0:${String(sec).padStart(2, '0')}`;
    };

    if (!data) {
        return <div className="ls-boot"><div className="ls-boot-spinner" /></div>;
    }

    const success = status === 'success';
    const isQuit  = data.mode === 'quit';

    return (
        <div className={`ls ${success ? 'is-success' : ''}`} onMouseDown={refocus}>
            <div className="ls-dragbar" />

            {/* Ambient glow background */}
            <div className="ls-aura" aria-hidden />

            {/* Always-focused capture input (off-screen) */}
            <input
                ref={hiddenRef}
                className="ls-capture"
                type={isPIN ? 'text' : 'password'}
                inputMode={isPIN ? 'numeric' : 'text'}
                value={isPIN ? '' : input}
                onChange={(e) => { if (!isPIN) setInput(e.target.value.slice(0, MAX_PASSWORD)); }}
                autoFocus
                aria-hidden
                tabIndex={-1}
            />

            {/* Icon */}
            <div className="ls-badge">
                <div className="ls-badge-ring" />
                <span className="material-symbols-rounded ls-badge-icon" aria-hidden="true">
                    {success ? (isQuit ? 'logout' : 'lock_open_right') : (isQuit ? 'power_settings_new' : 'lock')}
                </span>
            </div>

            {/* Header */}
            <div className="ls-head">
                <h1 className="ls-title">
                    {success ? (isQuit ? 'Closing…' : 'Unlocked') : (isQuit ? 'Quit Deskly?' : data.displayName)}
                </h1>
                <p className="ls-sub">
                    {success
                        ? (isQuit ? 'Disabling App Lock and closing' : 'Reopening the app…')
                        : (isQuit
                            ? 'App Lock is active. Enter your PIN to quit and disable it.'
                            : 'Locked by Deskly — enter your PIN to continue')}
                </p>
            </div>

            {/* Body */}
            {success ? (
                <div className="ls-success">
                    <div className="ls-success-ring">
                        <span className="material-symbols-rounded" aria-hidden="true">check</span>
                    </div>
                </div>
            ) : status === 'locked_out' ? (
                <div className="ls-lockout">
                    <span className="material-symbols-rounded ls-lockout-icon" aria-hidden="true">hourglass_top</span>
                    <div className="ls-lockout-time">{fmtCountdown(countdown)}</div>
                    <p className="ls-lockout-text">Too many attempts. Locked temporarily.</p>
                </div>
            ) : isPIN ? (
                <>
                    <div className={`ls-dots ${status === 'error' ? 'shake' : ''}`}>
                        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                            <span key={i} className={`ls-dot ${i < input.length ? 'on' : ''} ${status === 'error' ? 'err' : ''}`} />
                        ))}
                    </div>

                    <div className="ls-msg-slot">
                        {status === 'error'    && <span className="ls-msg err">{errorMsg}</span>}
                        {status === 'checking' && <span className="ls-msg"><span className="ls-mini-spin" /> Verifying…</span>}
                        {status === 'idle' && !showPad && <span className="ls-msg">Type your PIN, then press Enter</span>}
                    </div>

                    {showPad && (
                        <div className="ls-pad">
                            {['1','2','3','4','5','6','7','8','9'].map((d) => (
                                <button key={d} className="ls-key" onClick={() => tapDigit(d)} tabIndex={-1}>{d}</button>
                            ))}
                            <span className="ls-key-blank" />
                            <button className="ls-key" onClick={() => tapDigit('0')} tabIndex={-1}>0</button>
                            <button className="ls-key ls-key-fn" onClick={tapBack} tabIndex={-1} aria-label="Delete">
                                <span className="material-symbols-rounded" aria-hidden="true">backspace</span>
                            </button>
                        </div>
                    )}

                    <button className="ls-pad-toggle" onClick={() => {
                        setShowPad(prev => {
                            const next = !prev;
                            try { localStorage.setItem('applock.keypad', next ? '1' : '0'); } catch {}
                            if (!next) refocus();
                            return next;
                        });
                    }} tabIndex={-1}>
                        <span className="material-symbols-rounded" aria-hidden="true">{showPad ? 'keyboard' : 'dialpad'}</span>
                        {showPad ? 'Use keyboard' : 'Show keypad'}
                    </button>
                </>
            ) : (
                <div className="ls-pw">
                    <div className="ls-pw-field">
                        <input
                            className="ls-pw-input"
                            type={showPw ? 'text' : 'password'}
                            value={input}
                            onChange={(e) => { setInput(e.target.value.slice(0, MAX_PASSWORD)); setErrorMsg(''); if (status === 'error') setStatus('idle'); }}
                            onKeyDown={(e) => e.key === 'Enter' && submit()}
                            placeholder="Enter password"
                            autoComplete="off"
                            autoFocus
                        />
                        <button className="ls-pw-eye" onClick={() => setShowPw((v) => !v)} tabIndex={-1}>
                            <span className="material-symbols-rounded" aria-hidden="true">{showPw ? 'visibility_off' : 'visibility'}</span>
                        </button>
                    </div>
                    <div className="ls-msg-slot">
                        {status === 'error' && <span className="ls-msg err">{errorMsg}</span>}
                    </div>
                    <button className="ls-pw-submit" onClick={() => submit()} disabled={!input.trim() || status === 'checking'}>
                        {status === 'checking' ? 'Verifying…' : 'Unlock'}
                    </button>
                </div>
            )}

            {/* Quit mode: allow cancelling the quit (keep Deskly running) */}
            {isQuit && !success && status !== 'checking' && (
                <button className="ls-cancel" onClick={() => window.lockAPI?.cancel()}>
                    Cancel — keep Deskly running
                </button>
            )}

            {/* Footer */}
            <div className="ls-foot">
                <span className="material-symbols-rounded" aria-hidden="true">shield</span>
                Protected by Deskly App Lock
            </div>
        </div>
    );
}

createRoot(document.getElementById('lock-root')).render(<LockScreen />);
