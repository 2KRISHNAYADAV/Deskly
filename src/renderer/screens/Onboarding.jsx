import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import logoUrl from '../../../assets/icons/icon.png';
import { AuroraBackground } from '../components/AuroraBackground';
import '../styles/onboarding.css';

function Onboarding({ onComplete, initialStep = 1, vaultAlreadyExists = false }) {
    const { t } = useTranslation();
    const [step, setStep] = useState(initialStep);
    const [vaultPath, setVaultPath] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState(null);
    const completedRef = useRef(false);
    const completeTimerRef = useRef(null);

    const completeOnce = () => {
        if (completedRef.current) return;
        completedRef.current = true;
        onComplete();
    };

    useEffect(() => {
        // If vault already exists, complete right away
        if (vaultAlreadyExists) {
            setStep(4);
            completeTimerRef.current = setTimeout(completeOnce, 1200);
        }

        return () => {
            clearTimeout(completeTimerRef.current);
        };
    }, [vaultAlreadyExists]);

    const handleSelectFolder = async () => {
        try {
            const result = await window.electronAPI.selectVaultFolder();
            if (result && result.path) {
                setVaultPath(result.path);
                setError(null);
            }
        } catch (err) {
            console.error('Failed to select folder:', err);
            setError('We could not open the folder picker. Please try again.');
        }
    };

    const handleUseDefault = async () => {
        try {
            const result = await window.electronAPI.getDefaultVaultPath();
            if (result) {
                setVaultPath(result);
                setError(null);
            }
        } catch (err) {
            console.error('Failed to get default path:', err);
        }
    };

    const handleCreateVault = async () => {
        if (!vaultPath) {
            setError('Please select a folder first');
            return;
        }

        setIsCreating(true);
        setError(null);

        try {
            const result = await window.electronAPI.createVault(vaultPath);
            if (result && result.success) {
                setStep(4);
                completeTimerRef.current = setTimeout(completeOnce, 1800);
            } else {
                setError(result?.error || 'Deskly could not finish setup right now. Please try again.');
            }
        } catch (err) {
            console.error('Setup failed:', err);
            setError('Deskly could not finish setup right now. Please try again.');
        } finally {
            setIsCreating(false);
        }
    };

    const pageVariants = {
        initial: { opacity: 0, y: 20, scale: 0.98 },
        in: { opacity: 1, y: 0, scale: 1 },
        out: { opacity: 0, y: -20, scale: 0.98 }
    };

    const pageTransition = {
        type: 'spring',
        stiffness: 300,
        damping: 30
    };

    return (
        <AuroraBackground className="onboarding-container">
            <motion.div
                className="onboarding-card"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
                <AnimatePresence mode="wait">
                    {step === 1 && (
                        <motion.div
                            key="step1"
                            className="onboarding-step"
                            initial="initial"
                            animate="in"
                            exit="out"
                            variants={pageVariants}
                            transition={pageTransition}
                        >


                            <div className="onboarding-icon-wrapper logo-wrapper">
                                <img src={logoUrl} alt="Deskly Logo" className="onboarding-logo" />
                            </div>
                            <h1>Welcome to Deskly Academic Edition</h1>
                            <p className="onboarding-subtitle">
                                Standalone local-first digital wellbeing companion. Your habits, timeline, and focus metrics remain entirely private on your device.
                            </p>
                            <button
                                className="onboarding-btn primary"
                                onClick={() => setStep(3)}
                            >
                                Setup Local Vault
                                <span className="material-symbols-rounded" style={{ fontSize: 18 }} aria-hidden="true">arrow_forward</span>
                            </button>
                        </motion.div>
                    )}

                    {step === 3 && (
                        <motion.div
                            key="step3"
                            className="onboarding-step"
                            initial="initial"
                            animate="in"
                            exit="out"
                            variants={pageVariants}
                            transition={pageTransition}
                        >
                            <div className="onboarding-icon-wrapper">
                                <span className="material-symbols-rounded onboarding-icon" aria-hidden="true">folder_managed</span>
                            </div>
                            <h1>{t('onboarding.step3Title')}</h1>
                            <p className="onboarding-subtitle">
                                Confirm the local storage directory where your encrypted activity history and SQLite database will be saved.
                            </p>

                            <div className="vault-path-section">
                                {vaultPath ? (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="vault-path-display">
                                        <span className="material-symbols-rounded vault-path-icon" aria-hidden="true">folder_open</span>
                                        <span className="vault-path-text">{vaultPath}</span>
                                    </motion.div>
                                ) : (
                                    <div className="vault-path-empty">
                                        {t('onboarding.noLocation')}
                                    </div>
                                )}

                                <div className="vault-buttons">
                                    <button
                                        className="onboarding-btn secondary"
                                        onClick={handleSelectFolder}
                                    >
                                        <span className="material-symbols-rounded" style={{ fontSize: 18 }} aria-hidden="true">search</span>
                                        {t('onboarding.browse')}
                                    </button>
                                    <button
                                        className="onboarding-btn secondary"
                                        onClick={handleUseDefault}
                                    >
                                        {t('onboarding.useDefault')}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="onboarding-error" role="alert">
                                    {error}
                                </motion.div>
                            )}

                            <button
                                className="onboarding-btn primary"
                                onClick={handleCreateVault}
                                disabled={!vaultPath || isCreating}
                            >
                                {isCreating ? t('onboarding.finalizing') : t('onboarding.confirmFinish')}
                            </button>
                        </motion.div>
                    )}

                    {step === 4 && (
                        <motion.div
                            key="step4"
                            className="onboarding-step"
                            initial="initial"
                            animate="in"
                            exit="out"
                            variants={pageVariants}
                            transition={pageTransition}
                        >
                            <div className="onboarding-icon-wrapper success-wrapper logo-wrapper">
                                <img src={logoUrl} alt="Deskly Logo" className="onboarding-logo" />
                            </div>
                            <h1>Ready for Use</h1>
                            <p className="onboarding-subtitle">
                                Deskly Academic Edition is configured. Launching your private dashboard now...
                            </p>
                            <div className="setup-loading-spinner" />
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="onboarding-dots">
                    {[1, 3, 4].map(i => (
                        <span
                            key={i}
                            className={`dot ${step >= i ? 'active' : ''}`}
                        />
                    ))}
                </div>
            </motion.div>
        </AuroraBackground>
    );
}

export default Onboarding;
