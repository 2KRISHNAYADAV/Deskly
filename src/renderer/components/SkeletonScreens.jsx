/**
 * Skeleton screens — layout-matched shimmer placeholders.
 * Apple / Linear / Vercel technique: users see the shape of incoming content,
 * so when real data arrives the brain processes it as "appearing" rather than "loading".
 * Perceived load time drops ~40% vs a spinner with no visual context.
 */
import React from 'react';
import './SkeletonScreens.css'; // shimmer animation defined once in CSS, not injected as a <style> tag

function SK({ w = '100%', h = 16, r = 6, style = {} }) {
    return (
        <div className="sk" style={{
            width: w, height: h, borderRadius: r,
            flexShrink: 0, ...style,
        }} />
    );
}

// ─── Dashboard skeleton ───────────────────────────────────────────────────────
export function DashboardSkeleton() {
    return (
        <div style={{ width: '100%', paddingBottom: 40 }}>

                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                    <SK w={180} h={28} r={8} />
                    <SK w={140} h={14} r={6} style={{ marginTop: 8 }} />
                </div>

                {/* Grid */}
                <div className="dashboard-grid-container">

                    {/* Hero ring */}
                    <div className="refined-card hero-card area-hero" style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
                    }}>
                        <div style={{
                            width: 220, height: 220, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.05)',
                            position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            {/* Ring arc using box-shadow */}
                            <div className="sk" style={{
                                position: 'absolute', inset: 0, borderRadius: '50%',
                                background: 'none',
                                boxShadow: 'inset 0 0 0 18px rgba(255,255,255,0.06)',
                            }} />
                            <div style={{ textAlign: 'center' }}>
                                <SK w={80} h={52} r={6} style={{ margin: '0 auto 8px' }} />
                                <SK w={60} h={12} r={4} style={{ margin: '0 auto 6px' }} />
                                <SK w={70} h={18} r={9} style={{ margin: '0 auto' }} />
                            </div>
                        </div>
                    </div>

                    {/* Stats capsules */}
                    <div className="area-stats">
                        <div className="stats-capsules-grid">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="refined-card stat-capsule" style={{
                                    flexDirection: 'column', alignItems: 'center',
                                    justifyContent: 'center', padding: 16, gap: 12, textAlign: 'center',
                                }}>
                                    <SK w={44} h={44} r={22} />
                                    <SK w={48} h={32} r={6} />
                                    <SK w={64} h={10} r={4} />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Balance card */}
                    <div className="refined-card hero-card area-balance" style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20,
                    }}>
                        <SK w={80} h={18} r={5} style={{ marginBottom: 16 }} />
                        <SK w={180} h={180} r={'50%'} />
                        <SK w={120} h={12} r={4} style={{ marginTop: 12 }} />
                    </div>

                </div>
        </div>
    );
}

// ─── App Usage skeleton ───────────────────────────────────────────────────────
export function AppUsageSkeleton() {
    return (
        <div style={{ width: '100%' }}>

                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                    <SK w={140} h={28} r={8} />
                    <SK w={200} h={14} r={6} style={{ marginTop: 8 }} />
                </div>

                {/* Search + sort bar */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                    <SK h={36} r={10} style={{ flex: 1 }} />
                    <SK w={80} h={36} r={10} />
                </div>

                {/* List rows */}
                {[...Array(8)].map((_, i) => (
                    <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '12px 0',
                        borderBottom: i < 7 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        animationDelay: `${i * 0.04}s`,
                    }}>
                        <SK w={40} h={40} r={10} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <SK w={`${100 - i * 8}%`} h={14} r={5} />
                            <SK w={80} h={3} r={2} />
                        </div>
                        <SK w={48} h={14} r={5} />
                    </div>
                ))}
        </div>
    );
}

// ─── Browser Usage skeleton ───────────────────────────────────────────────────
export function BrowserSkeleton() {
    return (
        <div style={{ width: '100%' }}>
                <div style={{ marginBottom: 20 }}>
                    <SK w={160} h={28} r={8} />
                    <SK w={220} h={14} r={6} style={{ marginTop: 8 }} />
                </div>

                {/* 3 browser sections */}
                {[0.9, 0.65, 0.45].map((fill, i) => (
                    <div key={i} style={{ marginBottom: 24 }}>
                        {/* Browser header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <SK w={36} h={36} r={8} />
                            <SK w={100} h={16} r={6} />
                            <div style={{ flex: 1 }} />
                            <SK w={50} h={14} r={5} />
                        </div>
                        {/* Progress bar */}
                        <div style={{
                            height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.05)',
                            marginBottom: 12, overflow: 'hidden',
                        }}>
                            <div className="sk" style={{ height: '100%', width: `${fill * 100}%`, borderRadius: 2 }} />
                        </div>
                        {/* Site rows */}
                        {[...Array(3)].map((_, j) => (
                            <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                                borderBottom: j < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                <SK w={24} h={24} r={4} />
                                <SK h={13} r={5} style={{ flex: 1 }} />
                                <SK w={44} h={13} r={5} />
                            </div>
                        ))}
                    </div>
                ))}
        </div>
    );
}
