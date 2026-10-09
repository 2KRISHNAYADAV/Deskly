import React from 'react';
import './Pagination.css';

/**
 * Premium pagination control — numbered pages with ellipsis truncation.
 *
 *   ‹  1  …  4  5  6  …  20  ›
 *
 * - Renders nothing when there is only one page.
 * - `windowSize` controls how many neighbours of the current page are shown.
 */
function buildPageList(current, total, windowSize = 1) {
    const range = [1];
    for (let i = current - windowSize; i <= current + windowSize; i++) {
        if (i > 1 && i < total) range.push(i);
    }
    if (total > 1) range.push(total);

    const uniq = [...new Set(range)].sort((a, b) => a - b);

    // Insert ellipsis markers where the sequence skips
    const out = [];
    let prev = 0;
    for (const n of uniq) {
        if (prev) {
            if (n - prev === 2) out.push(prev + 1);       // single gap → show the number
            else if (n - prev > 2) out.push('…');          // wider gap → ellipsis
        }
        out.push(n);
        prev = n;
    }
    return out;
}

export default function Pagination({ page, totalPages, onChange, className = '' }) {
    if (!totalPages || totalPages <= 1) return null;

    const pages = buildPageList(page, totalPages);
    const go = (p) => {
        if (!Number.isFinite(p)) return;
        const next = Math.min(Math.max(1, p), totalPages);
        if (next !== page) onChange(next);
    };

    return (
        <nav className={`pagination ${className}`} aria-label="Pagination">
            <span className="sr-only" role="status" aria-live="polite">{`Page ${page} of ${totalPages}`}</span>
            <button
                className="pg-btn pg-arrow"
                onClick={() => go(page - 1)}
                disabled={page === 1}
                aria-label="Previous page"
            >
                <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
            </button>

            {pages.map((p, i) =>
                p === '…' ? (
                    <span key={`gap-${i}`} className="pg-ellipsis" aria-hidden="true">…</span>
                ) : (
                    <button
                        key={p}
                        className={`pg-btn${p === page ? ' active' : ''}`}
                        onClick={() => go(p)}
                        aria-label={`Page ${p}`}
                        aria-current={p === page ? 'page' : undefined}
                    >
                        {p}
                    </button>
                )
            )}

            <button
                className="pg-btn pg-arrow"
                onClick={() => go(page + 1)}
                disabled={page === totalPages}
                aria-label="Next page"
            >
                <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
            </button>
        </nav>
    );
}
