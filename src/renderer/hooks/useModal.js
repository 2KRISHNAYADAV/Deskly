import { useEffect, useRef, useCallback } from 'react';

// All elements that should receive keyboard focus
const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Handles standard modal interaction behavior:
 *  - Locks background scroll while the modal is open
 *  - ESC key closes the modal (capture phase, works even with nested handlers)
 *  - Auto-focuses the first interactive element (or element with autoFocus)
 *  - Traps Tab / Shift+Tab focus within the modal container
 *
 * Usage:
 *   const { contentRef, handleKeyDown } = useModal(onClose);
 *   // Attach contentRef + onKeyDown={handleKeyDown} + tabIndex={-1} to the modal content div
 */
export function useModal(onClose) {
    const contentRef = useRef(null);

    // Lock background scroll for the duration the modal is mounted
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    // ESC key closes the modal (capture phase intercepts before any nested handlers)
    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [onClose]);

    // Move focus into the modal on mount
    useEffect(() => {
        requestAnimationFrame(() => {
            if (!contentRef.current) return;
            // Honour an explicit autoFocus attribute first
            const explicit = contentRef.current.querySelector('[autofocus]');
            if (explicit) {
                explicit.focus();
                return;
            }
            // Otherwise land on the first interactive element
            const focusable = contentRef.current.querySelectorAll(FOCUSABLE_SELECTORS);
            if (focusable.length) {
                focusable[0].focus();
            } else {
                contentRef.current.focus();
            }
        });
    }, []);

    // Focus trap — Tab and Shift+Tab cycle within the modal, never escape it
    const handleKeyDown = useCallback((e) => {
        if (e.key !== 'Tab' || !contentRef.current) return;
        const focusable = [...contentRef.current.querySelectorAll(FOCUSABLE_SELECTORS)];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }, []);

    return { contentRef, handleKeyDown };
}

/**
 * Inline focus-trap handler for modals that cannot use the useModal hook
 * (e.g. modals rendered directly inside a parent component without extraction).
 * Attach to the modal content div's onKeyDown prop.
 * Uses e.currentTarget so no ref is needed.
 */
export function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const container = e.currentTarget;
    const focusable = [...container.querySelectorAll(FOCUSABLE_SELECTORS)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
    } else {
        if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}
