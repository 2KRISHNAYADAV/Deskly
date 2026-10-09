import React, { memo, useEffect, useRef } from 'react';
import './DotLoader.css';

function joinClassNames(...parts) {
    return parts.filter(Boolean).join(' ');
}

// DotLoader — animated 7×7 dot matrix.
//
// PERFORMANCE: the frame animation is driven by DIRECT DOM updates (toggling the
// `.active` class on each dot via refs), NOT React state. The old version called
// setState every `duration` ms (~10×/sec), re-rendering all 49 cells forever while
// the Dashboard is open — a constant reconciliation cost that competed with every
// other animation/interaction. Refs eliminate React from the hot loop entirely:
// each tick just flips classList on the dots that changed. Zero re-renders.
const DotLoader = memo(function DotLoader({
    frames = [],
    isPlaying = true,
    duration = 100,
    repeatCount = -1,
    onComplete,
    className,
    dotClassName,
    size = 4,
    gap = 2,
    activeColor = 'rgba(255, 255, 255, 0.9)',
    inactiveColor = 'rgba(255, 255, 255, 0.14)',
    ...props
}) {
    const dotRefs   = useRef([]);
    const onCompRef = useRef(onComplete);
    onCompRef.current = onComplete;

    useEffect(() => {
        if (!isPlaying || !Array.isArray(frames) || frames.length === 0) return undefined;

        let frameIndex = -1;
        let repeats = 0;
        const dots = dotRefs.current;

        function applyFrame(idx) {
            const active = frames[idx];
            if (!active) return;
            const set = active instanceof Set ? active : new Set(active);
            for (let i = 0; i < dots.length; i++) {
                const el = dots[i];
                if (!el) continue;
                const on = set.has(i);
                // toggle only when it actually changes — avoids needless style work
                if (on !== el.classList.contains('active')) el.classList.toggle('active', on);
            }
        }

        // Show first frame immediately, then advance on the interval.
        applyFrame(0);
        frameIndex = 0;

        const timer = setInterval(() => {
            const next = (frameIndex + 1) % frames.length;
            if (frameIndex + 1 >= frames.length) {
                if (repeatCount !== -1 && repeats + 1 >= repeatCount) {
                    clearInterval(timer);
                    if (typeof onCompRef.current === 'function') onCompRef.current();
                    return;
                }
                repeats += 1;
            }
            frameIndex = next;
            applyFrame(frameIndex);
        }, duration);

        return () => clearInterval(timer);
    }, [frames, isPlaying, duration, repeatCount]);

    return (
        <div
            {...props}
            className={joinClassNames('dot-loader-grid', className)}
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, auto)',
                gap: `${gap}px`,
                width: 'fit-content',
                ...props.style,
                '--dl-active': activeColor,
                '--dl-inactive': inactiveColor,
                '--dl-size': `${size}px`,
            }}
        >
            {Array.from({ length: 49 }).map((_, i) => (
                <div
                    key={i}
                    ref={(el) => { dotRefs.current[i] = el; }}
                    className={joinClassNames('dot-loader-dot', dotClassName)}
                />
            ))}
        </div>
    );
});

export default DotLoader;
