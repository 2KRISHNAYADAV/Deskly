import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/material-symbols-rounded';
import './screens/FocusScreen.css';

function fmt(sec) {
    const s = Math.max(0, sec | 0);
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

function FocusScreen() {
    const [data,    setData]    = useState(null);
    const [left,    setLeft]    = useState(0);
    const [confirm, setConfirm] = useState(false);
    const endsAtRef = useRef(0);

    useEffect(() => {
        if (!window.focusOverlayAPI) return;
        window.focusOverlayAPI.onData((d) => {
            setData(d);
            setConfirm(false);
            endsAtRef.current = d?.endsAt || 0;
            setLeft(Math.max(0, Math.round(((d?.endsAt || 0) - Date.now()) / 1000)));
        });
    }, []);

    // Local 1s countdown synced to endsAt
    useEffect(() => {
        const t = setInterval(() => {
            if (endsAtRef.current) {
                setLeft(Math.max(0, Math.round((endsAtRef.current - Date.now()) / 1000)));
            }
        }, 1000);
        return () => clearInterval(t);
    }, []);

    if (!data) return <div className="fs-boot"><div className="fs-spin" /></div>;

    const strict = data.mode === 'strict';

    return (
        <div className="fs">
            <div className="fs-dragbar" />

            <div className="fs-badge">
                <span className="material-symbols-rounded" aria-hidden="true">{strict ? 'center_focus_strong' : 'self_improvement'}</span>
            </div>

            <h1 className="fs-title">{strict ? 'Stay focused' : 'You’re in a focus session'}</h1>
            <p className="fs-sub">
                {strict
                    ? 'This app is blocked while you focus.'
                    : 'Try to stay on task — you’ve got this.'}
            </p>

            <div className="fs-timer">{fmt(left)}</div>
            <div className="fs-timer-label">remaining</div>

            {strict ? (
                !confirm ? (
                    <button className="fs-btn fs-ghost" onClick={() => setConfirm(true)}>End session early</button>
                ) : (
                    <div className="fs-confirm">
                        <p>End your focus session?</p>
                        <div className="fs-confirm-row">
                            <button className="fs-btn fs-ghost" onClick={() => setConfirm(false)}>Keep going</button>
                            <button className="fs-btn fs-danger" onClick={() => window.focusOverlayAPI.end()}>End</button>
                        </div>
                    </div>
                )
            ) : (
                <div className="fs-nudge-row">
                    <button className="fs-btn fs-primary" onClick={() => window.focusOverlayAPI.dismiss()}>Back to work</button>
                    <button className="fs-btn fs-ghost" onClick={() => window.focusOverlayAPI.dismiss()}>Dismiss</button>
                </div>
            )}

            <div className="fs-foot">
                <span className="material-symbols-rounded" aria-hidden="true">bolt</span>
                Deskly Focus
            </div>
        </div>
    );
}

createRoot(document.getElementById('focus-root')).render(<FocusScreen />);
