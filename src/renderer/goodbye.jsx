import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import { AuroraBackground } from './components/AuroraBackground';
import logoUrl from '../../assets/icons/icon.png';
import './styles/onboarding.css';

function GoodbyeScreen() {
    const [phase, setPhase] = useState('in'); // 'in' | 'out'

    useEffect(() => {
        // Start fade-out after 3s, let animation run for 1s, then close
        const fadeTimer = setTimeout(() => setPhase('out'), 3000);
        const closeTimer = setTimeout(() => {
            if (window.electronAPI?.closeGoodbyeWindow) {
                window.electronAPI.closeGoodbyeWindow();
            }
        }, 4200);
        return () => { clearTimeout(fadeTimer); clearTimeout(closeTimer); };
    }, []);

    return (
        <AuroraBackground className="onboarding-container">
            <AnimatePresence>
                {phase === 'in' && (
                    <motion.div
                        className="onboarding-card"
                        key="goodbye-card"
                        initial={{ opacity: 0, scale: 0.92, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -12 }}
                        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className="onboarding-step">
                            <motion.div
                                className="onboarding-icon-wrapper logo-wrapper"
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                            >
                                <img src={logoUrl} alt="Deskly" className="onboarding-logo" />
                            </motion.div>

                            <motion.h1
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.25, duration: 0.45 }}
                            >
                                See you soon
                            </motion.h1>

                            <motion.p
                                className="onboarding-subtitle"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.35, duration: 0.45 }}
                            >
                                Deskly has been uninstalled. Your local vault data has been preserved.
                                We hope to see you back.
                            </motion.p>

                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.5, duration: 0.4 }}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginTop: '8px',
                                }}
                            >
                                <UninstallProgressBar />
                                <p style={{
                                    fontSize: '0.72rem',
                                    color: 'var(--text-secondary)',
                                    opacity: 0.5,
                                    letterSpacing: '0.02em',
                                }}>
                                    Cleaning up…
                                </p>
                            </motion.div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </AuroraBackground>
    );
}

function UninstallProgressBar() {
    const [width, setWidth] = useState(0);

    useEffect(() => {
        // Animate from 0 to ~85% over 2.8s, then hold (real cleanup hasn't run yet)
        const start = Date.now();
        const duration = 2800;
        const raf = (id) => {
            const elapsed = Date.now() - start;
            const p = Math.min(elapsed / duration, 1);
            // easeOutQuart
            const eased = 1 - Math.pow(1 - p, 4);
            setWidth(Math.round(eased * 85));
            if (p < 1) id = requestAnimationFrame(() => raf(id));
        };
        let rafId = requestAnimationFrame(() => raf(rafId));
        return () => cancelAnimationFrame(rafId);
    }, []);

    return (
        <div style={{
            width: '240px',
            height: '3px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '999px',
            overflow: 'hidden',
        }}>
            <div style={{
                height: '100%',
                width: `${width}%`,
                background: 'var(--accent, #7c6af5)',
                borderRadius: '999px',
                transition: 'width 80ms linear',
            }} />
        </div>
    );
}

const root = createRoot(document.getElementById('root'));
root.render(<GoodbyeScreen />);
