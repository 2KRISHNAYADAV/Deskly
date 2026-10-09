import React, { useRef, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import desklyIcon from '../assets/deskly-icon.png';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

const NEW_FEATURE_IDS = ['timeline'];
const SEEN_KEY = 'deskly_seenNewFeatures';

function readSeenFeatures() {
    try {
        const raw = safeGetItem(SEEN_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

const NAV_GROUPS = [
    {
        key: 'overview',
        items: [
            { id: 'dashboard',  icon: 'dashboard' },
            { id: 'apps',       icon: 'apps' },
            { id: 'browser',    icon: 'language' },
            { id: 'categories', icon: 'label' },
            { id: 'limits',     icon: 'timer' },
        ],
    },
    {
        key: 'tools',
        items: [
            { id: 'applock',  icon: 'lock' },
            { id: 'focus',    icon: 'center_focus_strong' },
            { id: 'timeline', icon: 'view_timeline' },
        ],
    },
    {
        key: 'more',
        items: [
            { id: 'reports',  icon: 'bar_chart' },
            { id: 'settings', icon: 'settings' },
        ],
    },
];

function Sidebar({ currentScreen, onNavigate }) {
    const { t }        = useTranslation();
    const navRef       = useRef(null);
    const indicatorRef = useRef(null);
    const initDone     = useRef(false);
    const [newIds, setNewIds] = useState(
        () => NEW_FEATURE_IDS.filter(id => !readSeenFeatures().includes(id))
    );

    // Slide the shared indicator to the active nav item.
    // useLayoutEffect fires synchronously after DOM mutations — the indicator
    // is in position before the browser paints, so there's no visible jump.
    useLayoutEffect(() => {
        if (!navRef.current || !indicatorRef.current) return;
        const active = navRef.current.querySelector('[aria-current="page"]');
        if (!active) {
            indicatorRef.current?.removeAttribute('data-visible');
            return;
        }

        const navRect = navRef.current.getBoundingClientRect();
        const btnRect = active.getBoundingClientRect();
        // getBoundingClientRect gives viewport-relative coords. Add scrollTop so
        // the absolute `top` is correct relative to the nav's scrollable content.
        const top    = btnRect.top - navRect.top + navRef.current.scrollTop;
        const height = btnRect.height;

        if (!initDone.current) {
            // First render: snap to position without animating.
            initDone.current = true;
            indicatorRef.current.style.transition = 'none';
            indicatorRef.current.style.top    = `${top}px`;
            indicatorRef.current.style.height = `${height}px`;
            indicatorRef.current.setAttribute('data-visible', 'true');
            // Force a reflow, then re-enable the CSS transition for all future moves.
            void indicatorRef.current.offsetHeight;
            indicatorRef.current.style.transition = '';
        } else {
            indicatorRef.current.style.top    = `${top}px`;
            indicatorRef.current.style.height = `${height}px`;
            indicatorRef.current.setAttribute('data-visible', 'true');
        }
    }, [currentScreen]);

    const handleNavigate = (screenId) => {
        if (NEW_FEATURE_IDS.includes(screenId) && newIds.includes(screenId)) {
            const seen = readSeenFeatures();
            safeSetItem(SEEN_KEY, JSON.stringify([...seen, screenId]));
            setNewIds(prev => prev.filter(id => id !== screenId));
        }
        if (screenId === currentScreen) return;
        onNavigate(screenId);
    };

    // Roving arrow-key navigation across all nav items (Up/Down move focus,
    // Home/End jump to the ends) — the expected keyboard model for a vertical
    // navigation rail. Tab still moves in/out of the rail as a whole.
    const handleNavKeyDown = (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const items = Array.from(navRef.current?.querySelectorAll('.nav-item') || []);
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement);
        e.preventDefault();
        let next;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        else if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
        else next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
        items[next]?.focus();
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <img
                        src={desklyIcon}
                        className="sidebar-logomark"
                        width="56"
                        height="56"
                        alt=""
                        aria-hidden="true"
                        style={{ display: 'block' }}
                    />
                    <div className="sidebar-logo-text">
                        <h1>Deskly</h1>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}>Academic</span>
                    </div>
                </div>
            </div>

            <nav className="sidebar-nav" ref={navRef} aria-label="Primary" onKeyDown={handleNavKeyDown}>
                {/* Single shared indicator — slides between active items via CSS transition */}
                <div ref={indicatorRef} className="nav-indicator" />

                {NAV_GROUPS.map((group) => (
                    <div key={group.key} className="nav-group">
                        <span className="nav-group-label">{t(`nav.groups.${group.key}`)}</span>
                        {group.items.map((item) => {
                            const isActive = currentScreen === item.id;
                            return (
                                <button
                                    key={item.id}
                                    className={`nav-item${isActive ? ' active' : ''}`}
                                    onClick={() => handleNavigate(item.id)}
                                    aria-current={isActive ? 'page' : undefined}
                                >
                                    <span className="material-symbols-rounded nav-item-icon" aria-hidden="true">
                                        {item.icon}
                                    </span>
                                    <span className="nav-item-label">{t(`nav.items.${item.id}`)}</span>
                                    {newIds.includes(item.id) && (
                                        <span className="nav-new-tag">New</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </nav>

        </aside>
    );
}

function areEqual(prevProps, nextProps) {
    return prevProps.currentScreen === nextProps.currentScreen;
}

export default React.memo(Sidebar, areEqual);
