import React from 'react';

// Optimized CircularReveal - Matches refined-card background
const sizeConfig = {
    sm: { size: 180, radius: 70, fontSize: 9,  gap: 40 },
    md: { size: 220, radius: 85, fontSize: 10, gap: 35 },
    lg: { size: 280, radius: 110, fontSize: 11, gap: 30 }
};

export const CircularReveal = ({
    items = [],
    centerContent,
    size = 'md',
    style = {}
}) => {
    const config = sizeConfig[size];

    const createTextSegments = () => {
        const totalItems = items.length;
        const totalGapDegrees = config.gap * totalItems;
        const availableDegrees = 360 - totalGapDegrees;
        const segmentDegrees = availableDegrees / totalItems;

        return items.map((item, index) => {
            const startPosition = index * (segmentDegrees + config.gap);
            const startOffset = `${(startPosition / 360) * 100}%`;

            return (
                <text
                    key={index}
                    style={{
                        fontSize: `${config.fontSize}px`,
                        fontWeight: 700,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase'
                    }}
                >
                    <textPath
                        href="#curve"
                        fill={item.color}
                        startOffset={startOffset}
                        textLength={`${segmentDegrees * 1.8}`}
                        lengthAdjust="spacingAndGlyphs"
                    >
                        {item.text}
                    </textPath>
                </text>
            );
        });
    };

    return (
        <div
            style={{
                position: 'relative',
                width: config.size,
                height: config.size,
                borderRadius: '50%',
                background: 'var(--surface-container)',
                border: '1px solid var(--outline-variant)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                ...style
            }}
        >
            {/* Static center content */}
            <div style={{
                position: 'relative',
                zIndex: 10,
                textAlign: 'center',
                padding: '16px'
            }}>
                {centerContent}
            </div>

            {/* Pure CSS rotation — compositor thread, zero JS overhead.
                animation-delay holds the spin until after the dashboard entrance
                settles, so it doesn't add an animating layer during first paint. */}
            <div style={{
                position: 'absolute',
                inset: 0,
                animation: 'cr-spin 60s linear infinite',
                animationDelay: '0.7s',
            }}>
                <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%', textRendering: 'geometricPrecision' }}>
                    <defs>
                        <path
                            id="curve"
                            fill="none"
                            d={`M 100,100 m -${config.radius},0 a ${config.radius},${config.radius} 0 1,1 ${config.radius * 2},0 a ${config.radius},${config.radius} 0 1,1 -${config.radius * 2},0`}
                        />
                    </defs>
                    {createTextSegments()}
                </svg>
            </div>
        </div>
    );
};

export default CircularReveal;
