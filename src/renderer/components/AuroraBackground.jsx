import React from 'react';
import '../styles/AuroraBackground.css';

/**
 * Aurora Background Component
 * Ported from Aceternity UI to Vanilla CSS/React
 * 
 * Provides an animated foreground gradient effect that moves underneath
 * the child elements. Perfect for the Setup Wizard background.
 */
export const AuroraBackground = ({
    className = '',
    children,
    showRadialGradient = true,
    ...props
}) => {
    return (
        <div
            className={`aurora-wrapper ${className}`}
            {...props}
        >
            <div className="aurora-container">
                <div
                    className={`aurora-effect ${showRadialGradient ? 'show-radial-gradient' : ''}`}
                ></div>
            </div>

            {/* Children content wrapper to ensure z-index stays above background */}
            <div className="aurora-content">
                {children}
            </div>
        </div>
    );
};
