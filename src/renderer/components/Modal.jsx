import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './Modal.css';

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Deskly Modal
 *
 * Handles: portal rendering, enter/exit animation (slide-up + fade, NO scale),
 * ESC close, scroll lock, focus trap, auto-focus first element.
 *
 * Props:
 *   onClose   — called after exit animation completes
 *   title     — header title (omit to suppress header)
 *   back      — optional back-arrow callback
 *   footer    — ReactNode rendered in the sticky footer
 *   maxWidth  — dialog width cap in px (default 520)
 *   children  — wrap with <div className="dm-body"> for standard body padding
 */
export default function Modal({ onClose, title, back, footer, maxWidth = 520, children }) {
    const [closing, setClosing] = useState(false);
    const panelRef  = useRef(null);
    const closeRef  = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    const close = useCallback(() => {
        if (closing) return;
        setClosing(true);
        setTimeout(() => closeRef.current(), 180);
    }, [closing]);

    // Scroll lock
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    // ESC — capture phase beats nested handlers
    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        document.addEventListener('keydown', h, true);
        return () => document.removeEventListener('keydown', h, true);
    }, [close]);

    // Auto-focus first interactive element on mount; restore focus to the opener on close.
    useEffect(() => {
        const opener = document.activeElement; // element that triggered the modal
        requestAnimationFrame(() => {
            if (!panelRef.current) return;
            const auto  = panelRef.current.querySelector('[autofocus]');
            if (auto) { auto.focus(); return; }
            const first = panelRef.current.querySelectorAll(FOCUSABLE)[0];
            if (first) first.focus(); else panelRef.current.focus();
        });
        return () => {
            // Restore focus to the trigger so keyboard/SR users aren't dropped onto <body>.
            if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
                opener.focus();
            }
        };
    }, []);

    // Make the rest of the app inert while the dialog is open so focus and screen-reader
    // traversal physically cannot leave the modal (belt-and-braces with the JS Tab trap).
    useEffect(() => {
        const root = document.getElementById('root');
        if (root) {
            root.setAttribute('inert', '');
            root.setAttribute('aria-hidden', 'true');
        }
        return () => {
            if (root) {
                root.removeAttribute('inert');
                root.removeAttribute('aria-hidden');
            }
        };
    }, []);

    // Focus trap
    const trapTab = useCallback((e) => {
        if (e.key !== 'Tab' || !panelRef.current) return;
        const els   = [...panelRef.current.querySelectorAll(FOCUSABLE)];
        if (!els.length) return;
        const first = els[0];
        const last  = els[els.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
        }
    }, []);

    return ReactDOM.createPortal(
        <div
            className={`dm-overlay${closing ? ' dm-closing' : ''}`}
            onClick={close}
        >
            <div
                ref={panelRef}
                className={`dm-panel${closing ? ' dm-closing' : ''}`}
                style={{ maxWidth }}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title !== undefined ? 'dm-modal-title' : undefined}
                tabIndex={-1}
                onClick={e => e.stopPropagation()}
                onKeyDown={trapTab}
            >
                {title !== undefined && (
                    <div className="dm-header">
                        {back && (
                            <button className="dm-back" onClick={back} aria-label="Back">
                                <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
                            </button>
                        )}
                        <h2 id="dm-modal-title" className="dm-title">{title}</h2>
                        <button className="dm-close" onClick={close} aria-label="Close">
                            <span className="material-symbols-rounded" aria-hidden="true">close</span>
                        </button>
                    </div>
                )}

                {children}

                {footer && <div className="dm-footer">{footer}</div>}
            </div>
        </div>,
        document.body
    );
}
