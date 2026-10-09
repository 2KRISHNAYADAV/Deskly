import React, { useState } from 'react';
import logoUrl from '../../../assets/icons/icon.png';
import '../styles/account.css';

function Account() {
    const [copied, setCopied] = useState(false);

    const handleCopySpecs = () => {
        const specs = `Deskly Academic Edition v1.0.0
Architecture: Local-First Desktop Application
Storage Engine: Local Encrypted SQLite Vault & JSON Filesystem
Mode: Completely Autonomous / Offline
Distribution: Academic Edition - Engineering Final Year Project`;
        navigator.clipboard.writeText(specs);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="account-container" style={{ padding: '32px 40px', maxWidth: '880px', margin: '0 auto' }}>
            <div className="account-header page-header page-header-animated">
                <h1 className="page-title">About Academic Edition</h1>
                <p className="page-subtitle">Deskly Standalone Research &amp; College Project Distribution</p>
            </div>

            <div className="account-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '24px' }}>
                <div className="account-card profile-card" style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '24px', background: 'var(--surface-container)', borderRadius: '16px', border: '1px solid var(--outline-variant)' }}>
                    <div style={{ width: '64px', height: '64px', borderRadius: '14px', background: 'rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <img src={logoUrl} alt="Deskly Logo" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 4px', color: 'var(--on-surface)' }}>Deskly Academic Edition</h2>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--on-surface-variant)' }}>Version 1.0.0 · Local-First Architecture</p>
                        <span style={{ display: 'inline-block', marginTop: '8px', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                            100% Offline &amp; Privacy-Preserving
                        </span>
                    </div>
                    <button className="refined-btn" onClick={handleCopySpecs}>
                        {copied ? '✓ Copied' : 'Copy System Info'}
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                    <div style={{ background: 'var(--surface-container)', padding: '20px', borderRadius: '14px', border: '1px solid var(--outline-variant)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', color: 'var(--primary)' }}>
                            <span className="material-symbols-rounded">offline_bolt</span>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Local-First Privacy</h3>
                        </div>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
                            Engineered from the ground up to operate completely without internet, remote accounts, or cloud telemetry.
                        </p>
                    </div>

                    <div style={{ background: 'var(--surface-container)', padding: '20px', borderRadius: '14px', border: '1px solid var(--outline-variant)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', color: 'var(--primary)' }}>
                            <span className="material-symbols-rounded">folder_supervised</span>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Self-Contained Vault</h3>
                        </div>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
                            Activity tracking, timelines, app limits, and focus statistics persist solely in your local SQLite &amp; encrypted vault folders.
                        </p>
                    </div>

                    <div style={{ background: 'var(--surface-container)', padding: '20px', borderRadius: '14px', border: '1px solid var(--outline-variant)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', color: 'var(--primary)' }}>
                            <span className="material-symbols-rounded">school</span>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Project Attribution</h3>
                        </div>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
                            Maintained as part of the college final-year engineering digital wellbeing and human-computer interaction study.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Account;
