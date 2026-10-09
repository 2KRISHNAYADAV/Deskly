import React, { useState, useEffect, useCallback } from 'react';

// Floating frameless window controls — no titlebar band, controls live in the air.
// Matches how Linear, Notion, and Arc approach their custom frames.
export default function Titlebar() {
    const [maximized, setMaximized]   = useState(false);
    const [hovered,   setHovered]     = useState(null); // 'min' | 'max' | 'close' | null
    const [pressed,   setPressed]     = useState(null);

    useEffect(() => {
        const onResize = () => {
            setMaximized(
                window.outerWidth  >= screen.availWidth &&
                window.outerHeight >= screen.availHeight
            );
        };
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const minimize = useCallback(() => window.electronAPI?.minimize(), []);
    const maximize = useCallback(() => window.electronAPI?.maximize(), []);
    const close    = useCallback(() => window.electronAPI?.close(),    []);

    const btn = (key, onClick, icon, isClose) => {
        const isHovered = hovered  === key;
        const isPressed = pressed  === key;

        const bg = isClose
            ? isPressed ? '#c0392b'
            : isHovered ? '#e74c3c'
            : 'transparent'
            : isPressed ? 'rgba(255,255,255,0.10)'
            : isHovered ? 'rgba(255,255,255,0.07)'
            : 'transparent';

        const iconColor = isClose && isHovered
            ? '#ffffff'
            : 'rgba(255,255,255,0.48)';

        return (
            <button
                key={key}
                onClick={onClick}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => { setHovered(null); setPressed(null); }}
                onMouseDown={() => setPressed(key)}
                onMouseUp={() => setPressed(null)}
                title={key === 'min' ? 'Minimize' : key === 'max' ? (maximized ? 'Restore' : 'Maximize') : 'Close'}
                style={{
                    width: 40, height: 28,
                    border: 'none',
                    background: bg,
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: iconColor,
                    transition: 'background 0.12s ease, color 0.12s ease',
                    WebkitAppRegion: 'no-drag',
                    flexShrink: 0,
                    outline: 'none',
                }}
            >
                {icon}
            </button>
        );
    };

    const minIcon = (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    );

    const maxIcon = maximized ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3.5 1.5H8.5V6.5M1.5 3.5H6.5V8.5H1.5V3.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
    ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="1.5" y="1.5" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.1" />
        </svg>
    );

    const closeIcon = (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    );

    return (
        <div
            style={{
                position: 'fixed',
                top: 0, left: 0, right: 0,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: 6,
                zIndex: 99999,
                WebkitAppRegion: 'drag',
                pointerEvents: 'auto',
                background: 'transparent',
                userSelect: 'none',
            }}
        >
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                WebkitAppRegion: 'no-drag',
            }}>
                {btn('min',   minimize, minIcon,   false)}
                {btn('max',   maximize, maxIcon,   false)}
                {btn('close', close,    closeIcon, true)}
            </div>
        </div>
    );
}
