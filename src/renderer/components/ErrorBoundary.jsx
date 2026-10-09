import React from 'react';

/**
 * ErrorBoundary — catches React render errors and shows a recoverable fallback.
 *
 * Key behaviours:
 *  - "Try Again" actually recovers: it bumps an internal `resetTick` used as a `key`
 *    on the children wrapper, forcing a full remount of the subtree instead of
 *    re-rendering the same failed elements (which would immediately re-throw).
 *  - `resetKeys`: when any value in this array changes, the boundary auto-clears
 *    (e.g. pass the current route so navigating away from a broken screen recovers).
 *  - Errors are logged in ALL environments (a no-op logger only in dev hides exactly
 *    the production failures that matter). Falls back to console if no reporter exists.
 *  - `level="root"` renders a full-window fallback with a Reload affordance; the
 *    default renders an inline section fallback.
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, resetTick: 0 };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // Report everywhere. In production this is the only signal we get that a user
        // hit a crash — swallowing it (dev-only logging) makes real failures invisible.
        try {
            const payload = {
                message: error?.message || String(error),
                stack: error?.stack,
                componentStack: errorInfo?.componentStack,
                boundary: this.props.name || this.props.level || 'section',
            };
            if (window.electronAPI?.reportRendererError) {
                window.electronAPI.reportRendererError(payload);
            } else {
                console.error('[ErrorBoundary]', payload);
            }
        } catch {
            console.error('ErrorBoundary caught:', error, errorInfo);
        }
    }

    componentDidUpdate(prevProps) {
        // Auto-reset when any resetKey changes (e.g. route change) so a user isn't
        // stuck on the error card after navigating away from the broken screen.
        if (!this.state.hasError) return;
        const prev = prevProps.resetKeys || [];
        const next = this.props.resetKeys || [];
        if (prev.length !== next.length || next.some((k, i) => k !== prev[i])) {
            this.reset();
        }
    }

    reset = () => {
        this.props.onReset?.();
        this.setState(s => ({ hasError: false, error: null, resetTick: s.resetTick + 1 }));
    };

    render() {
        if (this.state.hasError) {
            const isRoot = this.props.level === 'root';
            return (
                <div className={`error-boundary-fallback${isRoot ? ' error-boundary-root' : ''}`}>
                    <div className="error-content">
                        <span className="material-symbols-rounded error-icon" aria-hidden="true">error</span>
                        <h2>Something went wrong</h2>
                        <p>{isRoot
                            ? 'Deskly hit an unexpected error. You can try to recover, or reload the app.'
                            : 'This section encountered an error.'}</p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button className="btn btn-primary" onClick={this.reset}>
                                Try Again
                            </button>
                            {isRoot && (
                                <button className="btn" onClick={() => window.location.reload()}>
                                    Reload Deskly
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        // The key forces a fresh subtree on reset so previously-thrown children remount.
        return <React.Fragment key={this.state.resetTick}>{this.props.children}</React.Fragment>;
    }
}

export default ErrorBoundary;
