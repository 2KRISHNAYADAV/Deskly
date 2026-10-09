import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
// ScreenTimeRing replaced with minimal SVG — no canvas, instant load
import AppIcon from '../components/AppIcon';
import CircularReveal from '../components/CircularReveal';
import DotLoader from '../components/ui/DotLoader';
import { DashboardSkeleton } from '../components/SkeletonScreens';
import { SafeAPI } from '../utils/safeApi';
import { formatDuration } from '../utils/formatDuration';
import { sanitizeText } from '../utils/sanitizeText';
import { getDateLocale } from '../i18n';
import { hashString } from '../utils/colors';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import '../components/DashboardResponsive.css';
import './Dashboard.css';

// ── GoalParticles — canvas burst when screen time hits 100% ──────────────────
function GoalParticles({ active }) {
    const canvasRef = useRef(null);
    const particlesRef = useRef([]);
    const rafRef = useRef(null);
    const firedRef = useRef(false);

    useEffect(() => {
        // Reset the one-shot latch when the goal state clears, so a later day's
        // celebration can fire again without a full remount.
        if (!active) { firedRef.current = false; return; }
        if (firedRef.current) return;
        firedRef.current = true;
        const canvas = canvasRef.current;
        if (!canvas) { firedRef.current = false; return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { firedRef.current = false; return; }
        const W = canvas.width, H = canvas.height;

        // Spawn 28 particles from center-bottom of the ring area
        const COLORS = ['#1D4ED8', '#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#ffffff'];
        particlesRef.current = Array.from({ length: 28 }, (_, i) => {
            const angle = (Math.random() * Math.PI * 2);
            const speed = 2.5 + Math.random() * 3.5;
            return {
                x: W / 2, y: H / 2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 2,
                radius: 2.5 + Math.random() * 2.5,
                color: COLORS[i % COLORS.length],
                alpha: 1,
                decay: 0.018 + Math.random() * 0.012,
            };
        });

        const frame = () => {
            ctx.clearRect(0, 0, W, H);
            let alive = false;
            for (const p of particlesRef.current) {
                if (p.alpha <= 0) continue;
                alive = true;
                p.x  += p.vx;
                p.y  += p.vy;
                p.vy += 0.12; // gravity
                p.alpha -= p.decay;
                ctx.save();
                ctx.globalAlpha = Math.max(0, p.alpha);
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            if (alive) rafRef.current = requestAnimationFrame(frame);
        };
        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
    }, [active]);

    if (!active) return null;
    return (
        <canvas
            ref={canvasRef}
            className="goal-particles-canvas"
            aria-hidden="true"
            width={320} height={320}
            style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none', zIndex: 10,
            }}
        />
    );
}

// ── Vertical Liquid Tube helpers ──────────────────────────────────────────────

function _liquidRGB(pct) {
    if (pct <= 60) return [34, 197, 94];
    if (pct <= 80) {
        const t = (pct - 60) / 20;
        return [Math.round(34 + (245 - 34) * t), Math.round(197 + (158 - 197) * t), Math.round(94 + (11 - 94) * t)];
    }
    if (pct <= 95) {
        const t = (pct - 80) / 15;
        return [Math.round(245 + (239 - 245) * t), Math.round(158 + (68 - 158) * t), Math.round(11 + (68 - 11) * t)];
    }
    return [239, 68, 68];
}

function _pillPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,       x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h,   x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h,   x,     y + h - r, r);
    ctx.lineTo(x,    y + r);
    ctx.arcTo(x,     y,       x + r, y,          r);
    ctx.closePath();
}

// Glass liquid orb — a sphere that fills with glowing liquid bottom→top.
// Reads instantly as a "how full" indicator. Glass effect via key-light
// radial gradient + specular dot at top-left, same wave + bubble physics.
function LiquidOrb({ pct = 0 }) {
    const canvasRef  = useRef(null);
    const rafRef     = useRef(null);
    const pctRef     = useRef(pct);
    pctRef.current   = pct;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr  = window.devicePixelRatio || 1;
        const SIZE = 104;
        const cx   = SIZE / 2;   // 43
        const cy   = SIZE / 2;   // 43
        const R    = SIZE / 2 - 3;   // 40

        canvas.width        = SIZE * dpr;
        canvas.height       = SIZE * dpr;
        canvas.style.width  = `${SIZE}px`;
        canvas.style.height = `${SIZE}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);

        let phase = 0;

        function frame() {
            phase += 0.022;

            const raw  = Number(pctRef.current);
            const p    = Math.min(Math.max(Number.isFinite(raw) ? raw : 0, 0), 100);
            const frac = p / 100;
            const [cr, cg, cb] = _liquidRGB(p);

            // fillY: liquid surface. frac=0 → cy+R (bottom/empty), frac=1 → cy-R (full)
            const fillY = cy + R - 2 * R * frac;

            ctx.clearRect(0, 0, SIZE, SIZE);

            // ── 1. Glass sphere vessel ────────────────────────────────
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.025)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // ── Clip everything to sphere ─────────────────────────────
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
            ctx.clip();

            if (frac > 0.005) {
                // ── 2. Liquid fill with wavy surface ──────────────────
                const waveAmp  = 3.2;
                const waveFreq = 0.145;

                ctx.beginPath();
                ctx.moveTo(cx - R - 4, cy + R + 4);
                ctx.lineTo(cx + R + 4, cy + R + 4);
                ctx.lineTo(cx + R + 4, fillY);
                for (let x = Math.ceil(cx + R + 4); x >= Math.floor(cx - R - 4); x--) {
                    ctx.lineTo(x, fillY + Math.sin(x * waveFreq + phase) * waveAmp);
                }
                ctx.closePath();

                const bodyGrad = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
                bodyGrad.addColorStop(0,    `rgba(${cr},${cg},${cb},0.70)`);
                bodyGrad.addColorStop(0.50, `rgba(${cr},${cg},${cb},0.88)`);
                bodyGrad.addColorStop(1,    `rgba(${cr},${cg},${cb},0.66)`);
                ctx.fillStyle = bodyGrad;
                ctx.fill();

                // ── 3. Bottom depth shadow ────────────────────────────
                const depthGrad = ctx.createLinearGradient(0, cy + R * 0.38, 0, cy + R);
                depthGrad.addColorStop(0, 'rgba(0,0,0,0.00)');
                depthGrad.addColorStop(1, 'rgba(0,0,0,0.34)');
                ctx.fillStyle = depthGrad;
                ctx.fillRect(cx - R - 4, cy - R - 4, (R + 4) * 2, (R + 4) * 2);

                // ── 4. Bubble shimmer ─────────────────────────────────
                if (frac > 0.06) {
                    const b1x = cx - 9 + Math.sin(phase * 0.42) * 4;
                    const b1y = fillY + (cy + R - fillY) * 0.28 + Math.cos(phase * 0.58) * 3;
                    ctx.beginPath();
                    ctx.arc(b1x, b1y, 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.26)';
                    ctx.fill();
                }
                if (frac > 0.18) {
                    const b2x = cx + 7 + Math.cos(phase * 0.34) * 3;
                    const b2y = fillY + (cy + R - fillY) * 0.54 + Math.sin(phase * 0.48) * 2.5;
                    ctx.beginPath();
                    ctx.arc(b2x, b2y, 1.8, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.20)';
                    ctx.fill();
                }
                if (frac > 0.42) {
                    const b3x = cx - 2 + Math.sin(phase * 0.27) * 5;
                    const b3y = fillY + (cy + R - fillY) * 0.70 + Math.cos(phase * 0.40) * 2;
                    ctx.beginPath();
                    ctx.arc(b3x, b3y, 1.4, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.16)';
                    ctx.fill();
                }
            }

            // ── 5. Rim shadow — always drawn (empty sphere still has depth)
            const rimGrad = ctx.createRadialGradient(cx, cy, R * 0.52, cx, cy, R);
            rimGrad.addColorStop(0, 'rgba(0,0,0,0.00)');
            rimGrad.addColorStop(1, 'rgba(0,0,0,0.40)');
            ctx.fillStyle = rimGrad;
            ctx.fillRect(cx - R - 4, cy - R - 4, (R + 4) * 2, (R + 4) * 2);

            // ── 6. Key light — broad soft white highlight top-left ────
            // This is what makes it unmistakably look like glass/liquid.
            const klGrad = ctx.createRadialGradient(
                cx - R * 0.28, cy - R * 0.32, 0,
                cx - R * 0.05, cy - R * 0.08, R * 0.90
            );
            klGrad.addColorStop(0,    'rgba(255,255,255,0.32)');
            klGrad.addColorStop(0.20, 'rgba(255,255,255,0.15)');
            klGrad.addColorStop(0.55, 'rgba(255,255,255,0.04)');
            klGrad.addColorStop(1,    'rgba(255,255,255,0.00)');
            ctx.fillStyle = klGrad;
            ctx.fillRect(cx - R - 4, cy - R - 4, (R + 4) * 2, (R + 4) * 2);

            // ── 7. Specular hot-spot — tiny intense dot ───────────────
            const specGrad = ctx.createRadialGradient(
                cx - R * 0.30, cy - R * 0.34, 0,
                cx - R * 0.30, cy - R * 0.34, R * 0.20
            );
            specGrad.addColorStop(0,    'rgba(255,255,255,0.65)');
            specGrad.addColorStop(0.45, 'rgba(255,255,255,0.24)');
            specGrad.addColorStop(1,    'rgba(255,255,255,0.00)');
            ctx.fillStyle = specGrad;
            ctx.fillRect(cx - R - 4, cy - R - 4, (R + 4) * 2, (R + 4) * 2);

            ctx.restore(); // end clip

            rafRef.current = requestAnimationFrame(frame);
        }

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}

// ── Vertical Liquid Tube — pill-shaped glass tube, fills bottom→top ──────────
function VerticalLiquidTube({ pct = 0 }) {
    const canvasRef = useRef(null);
    const rafRef    = useRef(null);
    const pctRef    = useRef(pct);
    pctRef.current  = pct;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const W = 22, H = 210;
        canvas.width  = W * dpr; canvas.height = H * dpr;
        canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        const R = W / 2;
        let phase = 0;

        function frame() {
            phase += 0.018;
            const raw  = Number(pctRef.current);
            const p    = Math.min(Math.max(Number.isFinite(raw) ? raw : 0, 0), 100);
            const frac = p / 100;
            const [cr, cg, cb] = _liquidRGB(p);
            const fillY = H - H * frac;

            ctx.clearRect(0, 0, W, H);

            _pillPath(ctx, 0, 0, W, H, R);
            ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1; ctx.stroke();

            if (frac > 0.005) {
                ctx.save();
                _pillPath(ctx, 0, 0, W, H, R); ctx.clip();

                const waveAmp = 2.5, waveFreq = 0.20;
                ctx.beginPath();
                ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.lineTo(W, fillY);
                for (let x = W; x >= 0; x--) ctx.lineTo(x, fillY + Math.sin(x * waveFreq + phase) * waveAmp);
                ctx.closePath();
                const bodyGrad = ctx.createLinearGradient(0, 0, W, 0);
                bodyGrad.addColorStop(0,   `rgba(${cr},${cg},${cb},0.72)`);
                bodyGrad.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.82)`);
                bodyGrad.addColorStop(1,   `rgba(${cr},${cg},${cb},0.68)`);
                ctx.fillStyle = bodyGrad; ctx.fill();

                ctx.save();
                ctx.beginPath(); ctx.rect(W * 0.06, fillY + waveAmp, W * 0.22, H - fillY - waveAmp);
                ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill(); ctx.restore();

                ctx.save();
                const depthGrad = ctx.createLinearGradient(0, H * 0.7, 0, H);
                depthGrad.addColorStop(0, 'rgba(0,0,0,0)'); depthGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
                ctx.beginPath(); ctx.rect(0, fillY, W, H - fillY);
                ctx.fillStyle = depthGrad; ctx.fill(); ctx.restore();

                ctx.save();
                const b1y = fillY + (H - fillY) * 0.35 + Math.sin(phase * 0.4) * 4;
                ctx.beginPath(); ctx.arc(W * 0.38 + Math.cos(phase * 0.6) * 2, b1y, 2.2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill();
                const b2y = fillY + (H - fillY) * 0.60 + Math.cos(phase * 0.35) * 3;
                ctx.beginPath(); ctx.arc(W * 0.65 + Math.sin(phase * 0.5) * 1.5, b2y, 1.6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fill(); ctx.restore();

                const wsGrad = ctx.createLinearGradient(0, 0, W, 0);
                wsGrad.addColorStop(0,    'rgba(0,0,0,0.40)');
                wsGrad.addColorStop(0.22, 'rgba(0,0,0,0.12)');
                wsGrad.addColorStop(0.50, 'rgba(0,0,0,0.00)');
                ctx.fillStyle = wsGrad; ctx.fillRect(0, 0, W, H);

                const shGrad = ctx.createLinearGradient(0, R, 0, H - R);
                shGrad.addColorStop(0,    'rgba(255,255,255,0.00)');
                shGrad.addColorStop(0.12, 'rgba(255,255,255,0.36)');
                shGrad.addColorStop(0.50, 'rgba(255,255,255,0.26)');
                shGrad.addColorStop(0.88, 'rgba(255,255,255,0.32)');
                shGrad.addColorStop(1,    'rgba(255,255,255,0.00)');
                ctx.fillStyle = shGrad; ctx.fillRect(0, 0, 3.5, H);

                const tcGrad = ctx.createRadialGradient(W * 0.5, R, 0, W * 0.5, R, R);
                tcGrad.addColorStop(0, 'rgba(255,255,255,0.12)'); tcGrad.addColorStop(1, 'rgba(255,255,255,0.00)');
                ctx.fillStyle = tcGrad; ctx.fillRect(0, 0, W, R * 2);

                const bcGrad = ctx.createRadialGradient(W * 0.5, H - R, 0, W * 0.5, H - R, R);
                bcGrad.addColorStop(0, 'rgba(255,255,255,0.10)'); bcGrad.addColorStop(1, 'rgba(255,255,255,0.00)');
                ctx.fillStyle = bcGrad; ctx.fillRect(0, H - R * 2, W, R * 2);

                ctx.restore();
            }

            if (frac > 0.05) {
                ctx.save();
                ctx.shadowColor = `rgba(${cr},${cg},${cb},0.40)`; ctx.shadowBlur = 14;
                _pillPath(ctx, 0.5, 0.5, W - 1, H - 1, R - 0.5);
                ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.25)`; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.restore();
            }

            rafRef.current = requestAnimationFrame(frame);
        }

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}

// ── useCountUp — writes directly to a DOM ref, bypassing React state entirely.
//
// The old version called setValue() ~30 times/sec × 3 hooks = 90 setState calls/sec
// for 900ms. Each setState caused a full Dashboard re-render, which re-rendered
// ScreenTimeRing, which (under the old code) restarted the canvas RAF.
//
// The new version: one RAF loop per hook, writes to element.textContent directly.
// Zero React re-renders during the count-up animation.
function useCountUp(elemRef, target, duration = 650) {
    const rafRef   = useRef(null);
    const startRef = useRef(null);
    const lastRef  = useRef(0);

    useEffect(() => {
        if (!elemRef.current) return;
        // Coerce to a finite integer — a NaN/undefined target would otherwise
        // animate toward NaN and paint "NaN" into the DOM.
        const dest = Number.isFinite(Number(target)) ? Math.round(Number(target)) : 0;
        const from = lastRef.current;
        if (from === dest) return;
        startRef.current = null;
        cancelAnimationFrame(rafRef.current);

        const animate = (ts) => {
            if (!startRef.current) startRef.current = ts;
            const progress = Math.min((ts - startRef.current) / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
            const current  = Math.round(from + (dest - from) * eased);
            // Track the value actually shown so an interrupted run resumes from
            // here instead of snapping back to the last committed baseline.
            lastRef.current = current;
            if (elemRef.current) elemRef.current.textContent = current;
            if (progress < 1) rafRef.current = requestAnimationFrame(animate);
            else lastRef.current = dest;
        };
        rafRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafRef.current);
    }, [elemRef, target, duration]);
}

// Module-level constants — these never change, so hoisting prevents a fresh
// array/element being allocated on every Dashboard render (which happens every
// stats push + every useCountUp setValue tick).
// 4 accent colors — teal (brand), emerald, sky, rose. Clean, Google-quality palette.
const CIRCULAR_REVEAL_ITEMS = [
    { text: 'PRODUCTIVITY', icon: 'trending_up',     color: '#60a5fa' },
    { text: 'BALANCE',      icon: 'balance',          color: '#34d399' },
    { text: 'WELLNESS',     icon: 'spa',              color: '#f472b6' },
    { text: 'MINDFUL',      icon: 'self_improvement', color: '#a78bfa' },
];

const balanceGameFrames = [
    [14, 7, 0, 8, 6, 13, 20],
    [14, 7, 13, 20, 16, 27, 21],
    [14, 20, 27, 21, 34, 24, 28],
    [27, 21, 34, 28, 41, 32, 35],
    [34, 28, 41, 35, 48, 40, 42],
    [34, 28, 41, 35, 48, 42, 46],
    [34, 28, 41, 35, 48, 42, 38],
    [34, 28, 41, 35, 48, 30, 21],
    [34, 28, 41, 48, 21, 22, 14],
    [34, 28, 41, 21, 14, 16, 27],
    [34, 28, 21, 14, 10, 20, 27],
    [28, 21, 14, 4, 13, 20, 27],
    [28, 21, 14, 12, 6, 13, 20],
    [28, 21, 14, 6, 13, 20, 11],
    [28, 21, 14, 6, 13, 20, 10],
    [14, 6, 13, 20, 9, 7, 21],
];

// ── InsightCard — rotates through weekly insights ─────────────────────────────
const InsightCard = React.memo(function InsightCard() {
    const [data,    setData]    = useState(null);
    const [idx,     setIdx]     = useState(0);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        SafeAPI.getWeeklyInsights().then(d => d && setData(d));
    }, []);

    // Auto-rotate every 6 seconds when multiple insights exist
    useEffect(() => {
        if (!data?.insights?.length || data.insights.length < 2) return;
        const id = setInterval(() => {
            setVisible(false);
            setTimeout(() => {
                setIdx(i => (i + 1) % data.insights.length);
                setVisible(true);
            }, 220);
        }, 6000);
        return () => clearInterval(id);
    }, [data]);

    if (!data || !data.hasData || !data.insights.length) return null;

    const insight = data.insights[idx];
    const total   = data.insights.length;

    return (
        <div className="db-insight-card refined-card page-section">
            <div className="db-insight-icon">
                <span className="material-symbols-rounded" aria-hidden="true">{insight.icon}</span>
            </div>
            <div className="db-insight-body" style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease' }}>
                <div className="db-insight-label">Weekly Insight</div>
                <div className="db-insight-title">{insight.title}</div>
                <p className="db-insight-text">{insight.body}</p>
            </div>
            {total > 1 && (
                <div className="db-insight-dots" role="tablist" aria-label="Insight navigation">
                    {data.insights.map((_, i) => (
                        <button
                            key={i}
                            role="tab"
                            aria-selected={i === idx}
                            aria-label={`Insight ${i + 1} of ${total}`}
                            className={`db-insight-dot${i === idx ? ' active' : ''}`}
                            onClick={() => { setVisible(false); setTimeout(() => { setIdx(i); setVisible(true); }, 180); }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}); // React.memo — no props, prevents re-render on every 3-second stats push

// ── MilestoneModal — fires when streak hits a new milestone ──────────────────
const MILESTONES = [
    { days: 3,  icon: 'stars',                title: '3-Day Streak!',   msg: 'Three days of mindful screen time. You\'re building a habit.' },
    { days: 7,  icon: 'local_fire_department', title: 'Week Warrior!',   msg: 'A full week of healthy screen time. This is no accident.' },
    { days: 14, icon: 'military_tech',         title: 'Two Weeks!',      msg: 'Fourteen days strong. Real habits take root.' },
    { days: 30, icon: 'workspace_premium',     title: 'Monthly Master!', msg: 'A whole month. You\'ve genuinely changed your relationship with screens.' },
    { days: 60, icon: 'emoji_events',          title: '60 Days!',        msg: 'Two months of consistency. You\'re in rare company.' },
    { days: 100,icon: 'diamond',               title: '100 Days!',       msg: 'A hundred days. Legendary. The world needs more of this.' },
];

function MilestoneModal({ streakDays, onClose }) {
    const milestone = MILESTONES.slice().reverse().find(m => streakDays >= m.days);
    if (!milestone) return null;

    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };

    return (
        <div className="db-milestone-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
            <div
                className="db-milestone-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="db-milestone-title"
                onClick={e => e.stopPropagation()}
            >
                <div className="db-milestone-icon-wrap">
                    <span className="material-symbols-rounded db-milestone-icon" aria-hidden="true">{milestone.icon}</span>
                </div>
                <div className="db-milestone-streak">{streakDays}</div>
                <div className="db-milestone-unit">days</div>
                <h2 id="db-milestone-title" className="db-milestone-title">{milestone.title}</h2>
                <p className="db-milestone-msg">{milestone.msg}</p>
                <button className="db-milestone-btn" onClick={onClose}>
                    Keep going <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </button>
            </div>
        </div>
    );
}

// ── GoalsTodayCard — per-app goals progress ───────────────────────────────────
const GoalsTodayCard = React.memo(function GoalsTodayCard() {
    const [goals, setGoals] = useState([]);

    useEffect(() => {
        SafeAPI.getAppGoalsProgress().then(p => {
            if (Array.isArray(p) && p.length > 0) setGoals(p);
        });
    }, []);

    if (!goals.length) return null;

    const met     = goals.filter(g => g.met).length;
    const pctDone = Math.round((met / goals.length) * 100);

    return (
        <div className="db-goals-card page-section">
            <div className="db-goals-header">
                <div>
                    <div className="db-goals-label">Goals Today</div>
                    <div className="db-goals-subtitle">{met} of {goals.length} {met === 1 ? 'goal' : 'goals'} met</div>
                </div>
                <div className="db-goals-pct" style={{ color: pctDone === 100 ? '#22C55E' : undefined }}>
                    {pctDone}%
                </div>
            </div>
            <div className="db-goals-list">
                {goals.map(goal => (
                    <div key={goal.appName} className={`db-goals-row${goal.met ? ' db-goals-row--met' : ''}`}>
                        <div className="db-goals-row-icon">
                            <span className="material-symbols-rounded" style={{ color: goal.type === 'minimum' ? '#22C55E' : '#F87171' }} aria-hidden="true">
                                {goal.type === 'minimum' ? 'trending_up' : 'trending_down'}
                            </span>
                        </div>
                        <div className="db-goals-row-info">
                            <span className="db-goals-row-name">{goal.label}</span>
                            <span className="db-goals-row-meta">
                                {goal.currentMinutes}m {goal.type === 'minimum' ? '/' : 'of max'} {goal.targetMinutes}m
                            </span>
                        </div>
                        <div className="db-goals-bar-wrap">
                            <div
                                className="db-goals-bar-fill"
                                style={{
                                    width: `${Math.min(100, goal.percentComplete)}%`,
                                    background: goal.met
                                        ? '#22C55E'
                                        : goal.type === 'maximum' && goal.percentComplete > 80
                                            ? '#F87171'
                                            : 'var(--accent)',
                                }}
                            />
                        </div>
                        {goal.met && (
                            <span className="material-symbols-rounded db-goals-check" aria-hidden="true">check_circle</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}); // React.memo — no props, prevents re-render on every 3-second stats push

// Module-level constants — defined once, never recreated on re-render
const CAT_DOT_COLORS  = ['var(--accent)', 'var(--color-emerald)', 'var(--color-rose)', '#a78bfa'];
const CATEGORY_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4', '#FF5722', '#607D8B'];

// Helper to normalize category names for matching (same normalization as topCategories uses)
const normalizeCategoryName = (name) => {
    return String(name || '').replace(/[-_ ]?\d+.*$/, '').replace(/-/g, ' ').toLowerCase().trim();
};

// Color helper (mirroring CategoriesPage.jsx logic)
const getCategoryColor = (catData, catId) => {
    if (catId === 'uncategorized') return '#8b8b9e';
    if (catData?.color) return catData.color;
    // Fallback to hash-based color from palette
    const hash = (catId || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
};

function Dashboard({ onNavigate, stats: propsStats }) {
    const { t } = useTranslation();
    const [stats, setStats] = useState(propsStats || { totalSeconds: 0, formattedTotal: '0m', apps: [], categories: {} });
    const [streak, setStreak] = useState({ currentStreak: 0 });
    const [unlockCount, setUnlockCount] = useState(0);
    const [goalHours, setGoalHours] = useState(8);
    const [showMilestone, setShowMilestone] = useState(false);
    const [weeklyStats, setWeeklyStats] = useState({ days: [], totalSeconds: 0, avgSeconds: 0 });
    const [appLimits, setAppLimits] = useState({});
    const [loading, setLoading] = useState(!propsStats);
    const [loadError, setLoadError] = useState(null);
    const [goalCelebrated, setGoalCelebrated] = useState(false);
    const [categories, setCategories] = useState([]);

    // DOM refs for count-up targets — writing textContent directly, zero re-renders
    const appsElemRef    = useRef(null);
    const streakElemRef  = useRef(null);
    const unlocksElemRef = useRef(null);
    useCountUp(appsElemRef,    stats.apps?.length   || 0, 700);
    useCountUp(streakElemRef,  streak.currentStreak || 0, 800);
    useCountUp(unlocksElemRef, unlockCount          || 0, 600);

    // Update stats when props change (real-time updates from App.jsx)
    useEffect(() => {
        if (propsStats && propsStats.totalSeconds !== undefined) {
            setStats(propsStats);
            setLoading(false);
        }
    }, [propsStats]);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const cats = await window.electronAPI.getCategories();
                setCategories(cats || []);
            } catch (err) {
                console.warn('Failed to fetch categories:', err);
                setCategories([]);
            }
        };
        fetchCategories();
    }, []);

    const loadData = async () => {
        // Only set loading if we don't have stats from props
        const hasPropsStats = propsStats && propsStats.totalSeconds !== undefined;
        if (!hasPropsStats) {
            setLoading(true);
        }
        setLoadError(null);
        try {
            // allSettled (not all): a single failed read — e.g. streak — must not blank
            // the whole dashboard. Each value falls back independently, and we only show
            // the error banner if the PRIMARY today-stats read failed.
            const [today, streakData, goal, unlocks, weekly, limits] = await Promise.allSettled([
                hasPropsStats ? Promise.resolve(propsStats) : SafeAPI.getTodayStats(),
                SafeAPI.getStreak(),
                SafeAPI.getDailyGoal(),
                SafeAPI.getUnlockCount(),
                SafeAPI.getWeeklyStats(),
                SafeAPI.getAppLimits(),
            ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

            if (!hasPropsStats && today === null) {
                // Primary data source failed — surface a retry rather than a false empty state.
                setLoadError('Could not load your dashboard. Please try again.');
                setLoading(false);
                return;
            }

            setStats(today || { totalSeconds: 0, apps: [], categories: {} });
            const sd = streakData || { currentStreak: 0 };
            setStreak(sd);
            // Check if this streak is a new milestone that hasn't been celebrated
            const MILESTONE_DAYS = [3, 7, 14, 30, 60, 100];
            const lastCelebrated = parseInt(safeGetItem('deskly_lastCelebratedStreak') || '0', 10);
            if (sd.currentStreak > 0 && MILESTONE_DAYS.includes(sd.currentStreak) && sd.currentStreak > lastCelebrated) {
                setShowMilestone(true);
            }
            setUnlockCount(unlocks || 0);
            setGoalHours(goal ?? 8);
            setWeeklyStats(weekly || { days: [], totalSeconds: 0, avgSeconds: 0 });
            setAppLimits(limits || {});
        } catch (e) {
            console.error('Dashboard load failed:', e);
            setLoadError('Could not load your dashboard. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const goalSeconds = goalHours * 3600;

    const goalPercentage = useMemo(() =>
        Math.min(Math.round((stats.totalSeconds / (goalSeconds || 1)) * 100), 100),
    [stats.totalSeconds, goalSeconds]);

    // Trigger goal celebration once when percentage first reaches 100
    useEffect(() => {
        if (goalPercentage >= 100 && !goalCelebrated && stats.totalSeconds > 0) {
            setGoalCelebrated(true);
        }
    }, [goalPercentage, goalCelebrated, stats.totalSeconds]);

    // The dashboard can stay mounted for days (no remount to reset local state).
    // Without this, goalCelebrated latches true forever after the first celebration
    // and a goal reached on a later day would silently never animate again.
    const goalCelebratedDateRef = useRef(new Date().toDateString());
    useEffect(() => {
        const checkDayRollover = () => {
            const todayStr = new Date().toDateString();
            if (todayStr !== goalCelebratedDateRef.current) {
                goalCelebratedDateRef.current = todayStr;
                setGoalCelebrated(false);
            }
        };
        const id = setInterval(checkDayRollover, 60000);
        return () => clearInterval(id);
    }, []);

    // Top Apps — memoized so sort doesn't run on every render
    const topApps = useMemo(() =>
        [...(stats.apps || [])].sort((a, b) => b.seconds - a.seconds).slice(0, 3),
    [stats.apps]);

    // Categories — memoized
    const topCategories = useMemo(() =>
        Object.entries(stats.categories || {})
            .map(([name, data]) => ({
                name: name.replace(/[-_ ]?\d+.*$/, '').replace(/-/g, ' '),
                ...data
            }))
            .filter(c => c.seconds > 60)
            .sort((a, b) => b.seconds - a.seconds)
            .slice(0, 3),
    [stats.categories]);

    const balanceFooterSignals = useMemo(() => {
        const days = (weeklyStats?.days || []).filter(day => Number.isFinite(day?.seconds));
        const previousDays = days.slice(0, -1);
        const baselineSeconds = previousDays.length
            ? previousDays.reduce((sum, day) => sum + day.seconds, 0) / previousDays.length
            : (weeklyStats?.avgSeconds || 0);
        const trendDelta = baselineSeconds > 0 ? ((stats.totalSeconds - baselineSeconds) / baselineSeconds) : null;

        const trendLabel = trendDelta === null
            ? 'Trend calibrating'
            : Math.abs(trendDelta) < 0.05
                ? 'Trend steady vs week'
                : `Trend ${trendDelta > 0 ? '+' : ''}${Math.round(trendDelta * 100)}% vs week`;

        const enabledLimits = Object.entries(appLimits || {}).filter(([, limit]) => limit?.enabled !== false);
        const usageByApp = new Map((stats.apps || []).map(app => [String(app.name || '').toLowerCase(), app.seconds || 0]));
        let exceeded = 0;
        let nearing = 0;

        for (const [key, limit] of enabledLimits) {
            const usedSeconds = usageByApp.get(String(key || '').toLowerCase()) || 0;
            const usedMinutes = usedSeconds / 60;
            const effectiveMinutes = limit?.effectiveMinutes || limit?.dailyMinutes || 0;
            if (!effectiveMinutes) continue;
            const pressure = usedMinutes / effectiveMinutes;
            if (pressure >= 1) exceeded += 1;
            else if (pressure >= 0.85) nearing += 1;
        }

        const limitsLabel = enabledLimits.length === 0
            ? 'No active limits'
            : exceeded > 0
                ? `${exceeded} limit${exceeded > 1 ? 's' : ''} exceeded`
                : nearing > 0
                    ? `${nearing} limit${nearing > 1 ? 's' : ''} nearing`
                    : 'Limits in safe range';

        return { trendLabel, limitsLabel };
    }, [weeklyStats, stats.totalSeconds, stats.apps, appLimits]);

    // Greeting and date: stable within the same hour/day. useMemo with [] means
    // these compute once at mount and never again — no GC pressure on every push.
    const greeting = useMemo(() => {
        const h = new Date().getHours();
        return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    }, []);

    const dateString = useMemo(() =>
        new Date().toLocaleDateString(getDateLocale(), { weekday: 'long', month: 'long', day: 'numeric' }),
    []);

    const formatTime = useCallback((seconds) => formatDuration(seconds), []);

    // Defer DotLoader start until AFTER the full card entrance has settled (~680ms).
    // DotLoader's setInterval fires setState every 95ms, re-rendering 49 dots; if it
    // runs during the entrance it forces React reconciliations + style recalcs that
    // jank the cards. Starting it after entrance keeps the first impression smooth.
    const [dotLoaderReady, setDotLoaderReady] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setDotLoaderReady(true), 680);
        return () => clearTimeout(t);
    }, []);

    const balanceDotLoader = useMemo(() => dotLoaderReady ? (
        <DotLoader
            frames={balanceGameFrames}
            duration={95}
            size={4}
            gap={2}
            activeColor="rgba(255, 255, 255, 0.85)"
            inactiveColor="rgba(255, 255, 255, 0.10)"
        />
    ) : null, [dotLoaderReady]);

    const getAppColor = useCallback((name) => {
        // Use CSS token vars — same palette as AppUsage.jsx for cross-screen consistency
        const colors = [
            'var(--cat-productivity)', 'var(--cat-social)', 'var(--cat-entertainment)',
            'var(--cat-browsing)', 'var(--cat-gaming)', 'var(--primary)', 'var(--secondary)',
            'var(--tertiary)', 'var(--cat-other)'
        ];
        return colors[hashString(name) % colors.length];
    }, []);

    if (loading) return <DashboardSkeleton />;

    // Load failed and we have nothing to show — offer a retry instead of a blank or
    // misleading empty dashboard.
    if (loadError && stats.totalSeconds === 0 && !(stats.apps?.length)) {
        return (
            <div className="dashboard-screen" style={{ width: '100%', display: 'block', paddingBottom: '40px' }}>
                <div className="page-header db-header" style={{ marginBottom: '20px' }}>
                    <h1 className="page-title" style={{ marginBottom: 0 }}>{greeting}</h1>
                </div>
                <div role="alert" style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '14px', padding: '48px 24px', textAlign: 'center',
                    background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: '12px',
                }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 40, color: 'var(--on-surface-muted)' }} aria-hidden="true">cloud_off</span>
                    <p style={{ color: 'var(--on-surface)', fontSize: '15px', fontWeight: 600, margin: 0 }}>{loadError}</p>
                    <button className="refined-btn primary" onClick={() => loadData()}>{t('common.retry')}</button>
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard-screen" style={{
            width: '100%',
            display: 'block',
            paddingBottom: '40px',
        }}>
            {/* Header */}
            <div className="page-header page-header-animated db-header" style={{ marginBottom: '20px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <h1 className="page-title" style={{ marginBottom: 0 }}>{greeting}</h1>
                    <p className="page-subtitle" style={{ margin: 0 }}>
                        {dateString}
                    </p>
                </div>
            </div>
            {/* Non-blocking error banner when a refresh fails but we still have prior data */}
            {loadError && (
                <div role="alert" style={{
                    background: 'var(--error-container)', color: 'var(--error)', border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px',
                    display: 'flex', alignItems: 'center', gap: '10px',
                }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden="true">error</span>
                    <span style={{ flex: 1 }}>{loadError}</span>
                    <button className="refined-btn" onClick={() => loadData()} style={{ padding: '4px 12px', fontSize: '12px' }}>{t('common.retry')}</button>
                </div>
            )}

            {/* Main Grid */}
            <div className="dashboard-grid-container">

                {/* 1. Hero — minimal screen time card */}
                <div className="refined-card area-hero db-hero" style={{ padding: '28px 28px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', minHeight: '280px', overflow: 'visible' }}>
                    <GoalParticles active={goalCelebrated} />

                    {/* Orb — absolutely centered in the right half of the card */}
                    <div style={{ position: 'absolute', right: '36px', top: '50%', transform: 'translateY(-50%)' }}>
                        <LiquidOrb pct={goalPercentage} />
                    </div>

                    {/* Label + badge row — full width */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-muted)' }}>
                            Screen Time
                        </span>
                        <span style={{
                            fontSize: '11px', fontWeight: 600,
                            color:       goalPercentage >= 100 ? 'var(--error)'            : goalPercentage >= 80 ? 'var(--warning)'           : 'var(--accent-text)',
                            background:  goalPercentage >= 100 ? 'var(--error-container)'  : goalPercentage >= 80 ? 'var(--warning-container)' : 'var(--accent-dim)',
                            border: `1px solid ${goalPercentage >= 100 ? 'rgba(239,68,68,0.22)' : goalPercentage >= 80 ? 'rgba(251,191,36,0.22)' : 'rgba(29,78,216,0.28)'}`,
                            borderRadius: '4px', padding: '3px 8px',
                        }}>
                            {goalPercentage}% of goal
                        </span>
                    </div>

                    {/* Middle: big time + orb centered in remaining space */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingTop: '12px' }}>
                        <div>
                            <div style={{ fontSize: '56px', fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1, color: 'var(--on-surface)', fontVariantNumeric: 'tabular-nums' }}>
                                {formatTime(stats.totalSeconds)}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--on-surface-muted)', marginTop: '8px' }}>
                                {stats.totalSeconds === 0
                                    ? 'Tracking active — no usage yet'
                                    : goalPercentage < 50  ? 'Staying balanced today'
                                    : goalPercentage < 80  ? 'Past halfway — stay mindful'
                                    : goalPercentage < 100 ? 'Approaching your daily limit'
                                    :                        'Goal reached — take a break'}
                            </div>
                        </div>
                    </div>

                    {/* Progress bar — full width */}
                    <div style={{ marginTop: '20px' }}>
                        <div style={{ height: '4px', background: 'var(--outline-variant)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${Math.min(goalPercentage, 100)}%`,
                                background: goalPercentage >= 100 ? 'var(--error)' : goalPercentage >= 80 ? 'var(--warning)' : 'var(--accent)',
                                borderRadius: '2px',
                                transition: 'width 0.6s ease',
                            }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--on-surface-muted)' }}>0h</span>
                            <span style={{ fontSize: '11px', color: 'var(--on-surface-muted)' }}>Goal: {goalHours}h</span>
                        </div>
                    </div>
                </div>

                {/* 2. Stats Capsules */}
                <div className="area-stats">
                    <div className="stats-capsules-grid">
                        {/* Apps Used */}
                        <div className="refined-card stat-capsule apps db-cap-1" style={{
                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '12px', textAlign: 'center', overflow: 'hidden'
                        }}>
                            <div className="capsule-icon" style={{ width: 44, height: 44, fontSize: 22, color: 'var(--accent-text)', marginBottom: 0, background: 'var(--accent-dim)' }}>
                                <span className="material-symbols-rounded" aria-hidden="true">apps</span>
                            </div>
                            <div>
                                <span ref={appsElemRef} className="capsule-value">0</span>
                                <span className="capsule-label">apps today</span>
                            </div>
                        </div>

                        {/* Streak */}
                        <div className="refined-card stat-capsule db-cap-2" style={{
                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '12px', textAlign: 'center', overflow: 'hidden'
                        }}>
                            <div className="capsule-icon" style={{ width: 44, height: 44, fontSize: 22, color: 'var(--warning)', marginBottom: 0, background: 'var(--warning-container)' }}>
                                <span className="material-symbols-rounded" aria-hidden="true">local_fire_department</span>
                            </div>
                            <div>
                                <span className="capsule-value" style={{ position: 'relative', display: 'inline-block' }}>
                                    <span ref={streakElemRef}>0</span>
                                    {[7, 14, 30, 60, 100].includes(streak.currentStreak) && (
                                        <span style={{
                                            position: 'absolute', top: -6, right: -18,
                                            fontSize: 11, fontWeight: 700,
                                            background: 'var(--warning)', color: '#000',
                                            borderRadius: 999, padding: '1px 5px',
                                            animation: 'badge-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
                                            animationDelay: '0.6s',
                                        }}>✦</span>
                                    )}
                                </span>
                                <span className="capsule-label">day streak</span>
                            </div>
                        </div>


                        {/* Unlocks */}
                        <div className="refined-card stat-capsule db-cap-3" style={{
                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '12px', textAlign: 'center', overflow: 'hidden',
                        }}>
                            <div className="capsule-icon" style={{ width: 44, height: 44, fontSize: 22, color: 'var(--color-sky)', marginBottom: 0, background: 'rgba(56,189,248,0.10)' }}>
                                <span className="material-symbols-rounded" aria-hidden="true">lock_open</span>
                            </div>
                            <div>
                                <span ref={unlocksElemRef} className="capsule-value">0</span>
                                <span className="capsule-label">unlocks</span>
                            </div>
                        </div>

                        {/* App Timers — navigates to limits */}
                        <button className="refined-card stat-capsule stat-capsule-nav db-cap-4" onClick={() => onNavigate('limits')} style={{
                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '12px', textAlign: 'center', overflow: 'hidden',
                        }}>
                            <div className="capsule-icon" style={{ width: 44, height: 44, fontSize: 22, color: 'var(--color-emerald)', marginBottom: 0, background: 'rgba(52,211,153,0.10)' }}>
                                <span className="material-symbols-rounded" aria-hidden="true">timer</span>
                            </div>
                            <div>
                                <span className="capsule-value" style={{ fontSize: '18px', fontWeight: 600, color: 'var(--on-surface)' }}>App Limits</span>
                                <span className="capsule-label">manage</span>
                            </div>
                        </button>

                        {/* Categories — navigates to categories */}
                        <button className="refined-card stat-capsule stat-capsule-nav db-cap-5" onClick={() => onNavigate('categories')} style={{
                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '12px', textAlign: 'center', overflow: 'hidden',
                        }}>
                            <div className="capsule-icon" style={{ width: 44, height: 44, fontSize: 22, color: 'var(--color-rose)', marginBottom: 0, background: 'rgba(244,114,182,0.10)' }}>
                                <span className="material-symbols-rounded" aria-hidden="true">label</span>
                            </div>
                            <div>
                                <span className="capsule-value" style={{ fontSize: '18px', fontWeight: 600, color: 'var(--on-surface)' }}>Categories</span>
                                <span className="capsule-label">organize</span>
                            </div>
                        </button>

                        {/* Weekly Report — navigates to reports */}
                        <button className="refined-card stat-capsule stat-capsule-nav db-cap-6" onClick={() => onNavigate('reports')} style={{
                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '12px', textAlign: 'center', overflow: 'hidden',
                        }}>
                            <div className="capsule-icon" style={{ width: 44, height: 44, fontSize: 22, color: 'var(--color-sky)', marginBottom: 0, background: 'rgba(56,189,248,0.10)' }}>
                                <span className="material-symbols-rounded" aria-hidden="true">monitoring</span>
                            </div>
                            <div>
                                <span className="capsule-value" style={{ fontSize: '18px', fontWeight: 600, color: 'var(--on-surface)' }}>Weekly</span>
                                <span className="capsule-label">review</span>
                            </div>
                        </button>
                    </div>
                </div>

                {/* 3. Balance */}
                <div className="refined-card hero-card area-balance db-balance" style={{
                    padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center',
                    overflow: 'hidden'
                }}>
                    {/* Header */}
                    <div className="list-header" style={{ marginBottom: '12px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <div className="list-title">Focus</div>
                    </div>

                    {/* Circular Reveal */}
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <CircularReveal
                            size="md"
                            items={CIRCULAR_REVEAL_ITEMS}
                            centerContent={balanceDotLoader}
                        />
                    </div>

                    {/* Data-driven footer signals only */}
                    <div style={{
                        marginTop: '10px',
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                        justifyContent: 'center'
                    }}>
                        <span style={{
                            fontSize: '10px',
                            color: 'var(--on-surface-muted)',
                            background: 'var(--fill-quaternary)',
                            border: '1px solid var(--outline-variant)',
                            borderRadius: '4px',
                            padding: '4px 8px'
                        }}>
                            {balanceFooterSignals.trendLabel}
                        </span>
                        <span style={{
                            fontSize: '10px',
                            color: 'var(--on-surface-muted)',
                            background: 'var(--fill-quaternary)',
                            border: '1px solid var(--outline-variant)',
                            borderRadius: '4px',
                            padding: '4px 8px'
                        }}>
                            {balanceFooterSignals.limitsLabel}
                        </span>
                    </div>
                </div>

                {/* 4. Most Used */}
                <div className="refined-card area-recent db-recent" style={{ padding: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div className="list-header" style={{ marginBottom: '16px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="list-title">{t('dashboard.mostUsed')}</div>
                        <button
                            onClick={() => onNavigate('apps')}
                            title="View All Apps"
                            aria-label="View All Apps"
                            className="btn-icon-ghost"
                        >
                            <span className="material-symbols-rounded" style={{ fontSize: 20 }} aria-hidden="true">arrow_forward</span>
                        </button>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'hidden' }}>
                        {topApps.length === 0 && (
                            <p style={{ color: 'var(--on-surface-muted)', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>{t('dashboard.noAppsYet')}</p>
                        )}
                        {topApps.map((app) => (
                            <div key={app.name} className="premium-list-item db-app-row" style={{ padding: '8px 12px', marginBottom: 0, alignItems: 'center', borderRadius: '12px', gap: '12px' }}>
                                <AppIcon appName={app.name} size={32} />
                                <div className="list-info" style={{ flex: 1, minWidth: 0 }}>
                                    <div className="list-name" style={{ fontSize: '13px', marginBottom: '4px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={sanitizeText(app.displayName || app.name)}>{sanitizeText(app.displayName || app.name)}</div>
                                    <div className="progress-track" style={{ height: '4px', background: 'rgba(255,255,255,0.05)' }}>
                                        <div
                                            className="progress-bar"
                                            style={{
                                                width: `${(app.seconds / (stats.totalSeconds || 1)) * 100}%`,
                                                background: getAppColor(app.name)
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="list-meta" style={{ marginLeft: '14px' }}>
                                    <div className="list-time" style={{ fontSize: '13px', fontWeight: 600 }}>{formatTime(app.seconds)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 5. Categories */}
                <div className="refined-card area-cats db-cats" style={{ padding: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div className="list-header" style={{ marginBottom: '16px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="list-title">{t('dashboard.categories')}</div>
                        <button
                            onClick={() => onNavigate('categories')}
                            title="View All Categories"
                            aria-label="View All Categories"
                            className="btn-icon-ghost"
                        >
                            <span className="material-symbols-rounded" style={{ fontSize: 20 }} aria-hidden="true">arrow_forward</span>
                        </button>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'hidden' }}>
                        {topCategories.map((cat, idx) => {
                            const normalizedName = normalizeCategoryName(cat.name);
                            const catData = categories.find(c => normalizeCategoryName(c.name) === normalizedName);
                            const dotColor = getCategoryColor(catData, catData?.id) || CAT_DOT_COLORS[idx % CAT_DOT_COLORS.length];
                            const displayName = sanitizeText(cat.name);
                            return (
                            <div key={cat.name} className="premium-list-item db-app-row" style={{ padding: '8px 12px', marginBottom: 0, alignItems: 'center', borderRadius: '12px', gap: '12px' }}>
                                <div className="cat-dot" style={{ background: dotColor, width: '8px', height: '8px', marginRight: 0, flexShrink: 0 }} />
                                <div className="list-info" style={{ flex: 1, minWidth: 0 }}>
                                    <div className="list-name" style={{ fontSize: '13px', marginBottom: '4px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayName}>
                                        {displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : '—'}
                                    </div>
                                    <div className="progress-track" style={{ height: '4px', background: 'rgba(255,255,255,0.05)' }}>
                                        <div
                                            className="progress-bar"
                                            style={{
                                                width: `${(cat.seconds / (stats.totalSeconds || 1)) * 100}%`,
                                                background: dotColor
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="list-meta" style={{ marginLeft: '14px' }}>
                                    <div className="list-time" style={{ fontSize: '13px', fontWeight: 600 }}>{formatTime(cat.seconds)}</div>
                                </div>
                            </div>
                        );})}
                        {topCategories.length === 0 && (
                            <div className="empty-text" style={{ opacity: 0.4, fontSize: '12px' }}>
                                Categories appear as you use apps
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* Weekly Insight — below the grid, full-width */}
            <InsightCard />

            {/* Per-App Goals Today */}
            <GoalsTodayCard />

            {/* Milestone celebration */}
            {showMilestone && (
                <MilestoneModal
                    streakDays={streak.currentStreak}
                    onClose={() => {
                        safeSetItem('deskly_lastCelebratedStreak', String(streak.currentStreak));
                        setShowMilestone(false);
                    }}
                />
            )}
        </div>
    );
}

export default Dashboard;
