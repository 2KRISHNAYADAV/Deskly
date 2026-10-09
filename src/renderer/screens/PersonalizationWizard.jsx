import React, { useState } from 'react';
import { SafeAPI } from '../utils/safeApi';
import './PersonalizationWizard.css';

const TOTAL_STEPS = 5;

function formatGoalHours(h) {
    const whole = Math.floor(h);
    const mins = Math.round((h - whole) * 60);
    if (mins === 0) return `${whole}h`;
    return `${whole}h ${mins}m`;
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function WizardProgress({ step }) {
    return (
        <div className="wz-progress">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <div
                    key={i}
                    className={
                        `wz-progress-segment` +
                        (i < step - 1 ? ' done' : '') +
                        (i === step - 1 ? ' active' : '')
                    }
                />
            ))}
        </div>
    );
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────
function StepWelcome({ userName, onNext }) {
    const firstName = userName?.split(' ')[0] || null;
    return (
        <div className="wz-step wz-step--welcome">
            <div className="wz-welcome-icon">
                <span className="material-symbols-rounded" aria-hidden="true">waving_hand</span>
            </div>

            <h1 className="wz-welcome-title">
                {firstName ? `Welcome, ${firstName}` : 'Welcome'}<br />
                to Deskly Academic Edition
            </h1>

            <p className="wz-welcome-headline">
                Tracking is already running in the background.
            </p>
            <p className="wz-welcome-sub">
                Let's take 2 minutes to make Deskly work specifically for you —
                your goals, your habits, your pace. Everything is adjustable later.
            </p>

            <div className="wz-welcome-pills">
                <span className="wz-welcome-pill">
                    <span className="material-symbols-rounded" aria-hidden="true">insights</span>
                    Weekly insights after 7 days
                </span>
                <span className="wz-welcome-pill">
                    <span className="material-symbols-rounded" aria-hidden="true">timer</span>
                    ~2 min
                </span>
            </div>

            <div className="wz-welcome-actions">
                <button className="wz-primary-btn" onClick={() => onNext()}>
                    Get started
                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </button>
                <button className="wz-skip-all" onClick={() => onNext(true)}>
                    Skip for now
                </button>
            </div>
        </div>
    );
}

// ── Step 2: Daily screen time goal ────────────────────────────────────────────
const GOAL_PRESETS = [
    { hours: 2, label: 'Focused',    icon: 'filter_center_focus', desc: 'Minimal screen time, max deep work' },
    { hours: 4, label: 'Balanced',   icon: 'balance',             desc: 'Work done, room to breathe' },
    { hours: 6, label: 'Productive', icon: 'trending_up',         desc: 'Typical knowledge worker schedule' },
    { hours: 8, label: 'Flexible',   icon: 'waves',               desc: 'Heavy user, awareness without hard caps' },
];

function StepGoal({ onNext, onBack }) {
    const [goalHours, setGoalHours] = useState(6);
    const [saving, setSaving] = useState(false);

    const handleNext = async () => {
        setSaving(true);
        await SafeAPI.setDailyGoal(goalHours);
        setSaving(false);
        onNext({ goalHours });
    };

    return (
        <div className="wz-step">
            <div className="wz-step-icon">
                <span className="material-symbols-rounded" aria-hidden="true">timer</span>
            </div>
            <h2 className="wz-step-title">Set your daily screen time goal</h2>
            <p className="wz-step-sub">
                Deskly tracks progress against this every day. No hard blocks — just genuine awareness.
            </p>

            <div className="wz-goal-presets">
                {GOAL_PRESETS.map(p => (
                    <button
                        key={p.hours}
                        className={`wz-goal-preset${goalHours === p.hours ? ' active' : ''}`}
                        onClick={() => setGoalHours(p.hours)}
                    >
                        <span className="material-symbols-rounded wz-goal-preset-icon" aria-hidden="true">{p.icon}</span>
                        <span className="wz-goal-preset-label">{p.label}</span>
                        <span className="wz-goal-preset-hours">{p.hours}h</span>
                        <span className="wz-goal-preset-desc">{p.desc}</span>
                    </button>
                ))}
            </div>

            <div className="wz-goal-slider-row">
                <span className="wz-goal-slider-label">1h</span>
                <input
                    className="wz-slider"
                    type="range"
                    min={1}
                    max={12}
                    step={0.5}
                    value={goalHours}
                    onChange={e => setGoalHours(Number(e.target.value))}
                />
                <span className="wz-goal-slider-label">12h</span>
            </div>

            <div className="wz-goal-display">
                {formatGoalHours(goalHours)} per day
            </div>

            <div className="wz-step-actions">
                <button className="wz-back-btn" onClick={onBack}>Back</button>
                <button className="wz-primary-btn" onClick={handleNext} disabled={saving}>
                    {saving ? 'Saving…' : 'Next'}
                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </button>
            </div>
        </div>
    );
}

// ── Step 3: Apps to watch ─────────────────────────────────────────────────────
// Uses popular apps everyone knows — no tracked-usage data needed.
// Limits activate the moment Deskly detects the app being used.
const WATCH_APPS = [
    { name: 'YouTube',   icon: 'play_circle',    limitMins: 60,  color: '#FF4444' },
    { name: 'Instagram', icon: 'photo_camera',   limitMins: 45,  color: '#E1306C' },
    { name: 'Twitter',   icon: 'tag',            limitMins: 30,  color: '#1DA1F2' },
    { name: 'TikTok',    icon: 'music_video',    limitMins: 45,  color: '#9B59B6' },
    { name: 'Reddit',    icon: 'forum',          limitMins: 45,  color: '#FF6314' },
    { name: 'Netflix',   icon: 'movie',          limitMins: 90,  color: '#E50914' },
    { name: 'Facebook',  icon: 'thumb_up',       limitMins: 30,  color: '#1877F2' },
    { name: 'Discord',   icon: 'headset_mic',    limitMins: 60,  color: '#5865F2' },
    { name: 'Steam',     icon: 'sports_esports', limitMins: 90,  color: '#1B9ACF' },
    { name: 'Twitch',    icon: 'live_tv',        limitMins: 60,  color: '#9146FF' },
    { name: 'WhatsApp',  icon: 'chat',           limitMins: 30,  color: '#25D366' },
    { name: 'Slack',     icon: 'chat_bubble',    limitMins: 90,  color: '#611F69' },
];

function StepWatch({ onNext, onBack }) {
    const [selected, setSelected] = useState(new Set());
    const [limits, setLimits]     = useState({});
    const [saving, setSaving]     = useState(false);

    const toggle = (name, defaultLimitMins) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else if (next.size < 5) {
                next.add(name);
                if (!limits[name]) {
                    setLimits(l => ({ ...l, [name]: defaultLimitMins }));
                }
            }
            return next;
        });
    };

    const handleNext = async () => {
        if (selected.size === 0) { onNext({ watchedApps: [] }); return; }
        setSaving(true);
        try {
            // allSettled so one failed limit doesn't abort the loop, leave "Saving…" stuck
            // forever, and lose the remaining apps. Partial success still advances.
            await Promise.allSettled(
                [...selected].map(appName => SafeAPI.setAppLimit(appName, limits[appName] || 60, 'warn'))
            );
        } catch (e) {
            console.error('Wizard limit save failed:', e);
        } finally {
            setSaving(false);
        }
        onNext({ watchedApps: [...selected] });
    };

    return (
        <div className="wz-step">
            <div className="wz-step-icon">
                <span className="material-symbols-rounded" aria-hidden="true">visibility</span>
            </div>
            <h2 className="wz-step-title">Any apps you want to be mindful of?</h2>
            <p className="wz-step-sub">
                Pick up to 5. We'll send a gentle nudge when you approach your limit.
            </p>

            <div className="wz-watch-grid">
                {WATCH_APPS.map(app => {
                    const isSel  = selected.has(app.name);
                    const isDis  = !isSel && selected.size >= 5;
                    const limitH = limits[app.name] || app.limitMins;
                    const badge  = limitH >= 60 ? `${limitH / 60}h` : `${limitH}m`;
                    return (
                        <button
                            key={app.name}
                            className={`wz-watch-tile${isSel ? ' selected' : ''}${isDis ? ' dimmed' : ''}`}
                            onClick={() => !isDis && toggle(app.name, app.limitMins)}
                            style={{ '--app-color': app.color }}
                        >
                            <span
                                className="material-symbols-rounded wz-watch-icon"
                                style={{ color: isSel ? app.color : undefined }}
                                aria-hidden="true"
                            >
                                {app.icon}
                            </span>
                            <span className="wz-watch-name">{app.name}</span>
                            {isSel && (
                                <>
                                    <span className="wz-watch-check material-symbols-rounded" aria-hidden="true">check_circle</span>
                                    <span className="wz-watch-badge">{badge}</span>
                                </>
                            )}
                        </button>
                    );
                })}
            </div>

            <p className="wz-step-note">
                <span className="material-symbols-rounded" aria-hidden="true">info</span>
                Limits are soft — you get a notification, not a hard block. Deskly starts tracking these the moment you open them.
            </p>

            <div className="wz-step-actions">
                <button className="wz-back-btn" onClick={onBack}>Back</button>
                <button className="wz-secondary-btn" onClick={() => onNext({ watchedApps: [] })}>Skip</button>
                <button className="wz-primary-btn" onClick={handleNext} disabled={saving}>
                    {saving ? 'Saving…'
                        : selected.size > 0 ? `Watch ${selected.size} app${selected.size > 1 ? 's' : ''}`
                        : 'Next'}
                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </button>
            </div>
        </div>
    );
}

// ── Step 4: Habits to build ───────────────────────────────────────────────────
// Category-based — user picks habit categories and customises which app
// maps to each. Editable app name field avoids the hardcoded-app problem.
const HABIT_CATEGORIES = [
    { id: 'reading',  label: 'Reading',     icon: 'menu_book',        color: '#22C55E', appHint: 'Kindle',    targetMins: 20, desc: 'Books, articles, docs' },
    { id: 'creative', label: 'Creative',    icon: 'palette',          color: '#F59E0B', appHint: 'Figma',     targetMins: 30, desc: 'Design, art, making' },
    { id: 'learning', label: 'Learning',    icon: 'school',           color: '#60A5FA', appHint: 'Coursera',  targetMins: 30, desc: 'Courses, tutorials' },
    { id: 'writing',  label: 'Writing',     icon: 'edit_note',        color: '#34D399', appHint: 'Notion',    targetMins: 20, desc: 'Notes, journaling' },
    { id: 'focus',    label: 'Deep Focus',  icon: 'self_improvement', color: '#A78BFA', appHint: 'VS Code',   targetMins: 60, desc: 'Long uninterrupted sessions' },
    { id: 'music',    label: 'Music',       icon: 'headphones',       color: '#F87171', appHint: 'Spotify',   targetMins: 30, desc: 'Mindful listening' },
];

function StepHabits({ onNext, onBack }) {
    const [selected, setSelected] = useState(new Set());
    const [appNames, setAppNames] = useState({});
    const [saving, setSaving]     = useState(false);

    const toggle = (id) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else if (next.size < 3) next.add(id);
            return next;
        });
    };

    const handleNext = async () => {
        if (selected.size === 0) { onNext({ habitApps: [] }); return; }
        setSaving(true);
        // Build the (app, goal) list first, validating/normalizing each name.
        const targets = [];
        for (const id of selected) {
            const cat = HABIT_CATEGORIES.find(c => c.id === id);
            if (!cat) continue;
            const appName = (appNames[id] ?? cat.appHint).trim().slice(0, 60);
            if (appName) targets.push({ appName, cat });
        }
        try {
            // allSettled + finally so one failed goal doesn't strand "Saving…" or drop the rest.
            await Promise.allSettled(
                targets.map(t => SafeAPI.setAppGoal(t.appName, t.cat.targetMins, 'minimum', t.cat.label))
            );
        } catch (e) {
            console.error('Wizard goal save failed:', e);
        } finally {
            setSaving(false);
        }
        onNext({ habitApps: targets.map(t => t.appName) });
    };

    return (
        <div className="wz-step">
            <div className="wz-step-icon">
                <span className="material-symbols-rounded" aria-hidden="true">trending_up</span>
            </div>
            <h2 className="wz-step-title">Any habits you want to build?</h2>
            <p className="wz-step-sub">
                Pick up to 3. Deskly tracks daily minimums and shows your streak on the dashboard.
            </p>

            <div className="wz-habits-list">
                {HABIT_CATEGORIES.map(cat => {
                    const isSel = selected.has(cat.id);
                    const isDis = !isSel && selected.size >= 3;
                    const val   = appNames[cat.id] ?? cat.appHint;
                    return (
                        <div
                            key={cat.id}
                            className={`wz-habit-row${isSel ? ' selected' : ''}${isDis ? ' dimmed' : ''}`}
                            style={{ '--habit-color': cat.color }}
                        >
                            <button
                                className="wz-habit-row-main"
                                onClick={() => !isDis && toggle(cat.id)}
                            >
                                <div className="wz-habit-row-icon">
                                    <span className="material-symbols-rounded" aria-hidden="true">{cat.icon}</span>
                                </div>
                                <div className="wz-habit-row-info">
                                    <span className="wz-habit-row-name">{cat.label}</span>
                                    <span className="wz-habit-row-desc">
                                        {cat.desc} · {cat.targetMins}m/day
                                    </span>
                                </div>
                                <div className={`wz-habit-row-check${isSel ? ' vis' : ''}`}>
                                    <span className="material-symbols-rounded" aria-hidden="true">check_circle</span>
                                </div>
                            </button>

                            {isSel && (
                                <div className="wz-habit-app-row">
                                    <span className="material-symbols-rounded" aria-hidden="true">apps</span>
                                    <input
                                        className="wz-habit-app-input"
                                        value={val}
                                        placeholder="Which app?"
                                        onChange={e => setAppNames(n => ({ ...n, [cat.id]: e.target.value }))}
                                        onClick={e => e.stopPropagation()}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="wz-step-actions">
                <button className="wz-back-btn" onClick={onBack}>Back</button>
                <button className="wz-secondary-btn" onClick={() => onNext({ habitApps: [] })}>Skip</button>
                <button className="wz-primary-btn" onClick={handleNext} disabled={saving}>
                    {saving ? 'Saving…'
                        : selected.size > 0 ? `Set ${selected.size} habit${selected.size > 1 ? 's' : ''}`
                        : 'Next'}
                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </button>
            </div>
        </div>
    );
}

// ── Step 5: All set ───────────────────────────────────────────────────────────
function StepDone({ summary, onFinish }) {
    const configured = [
        summary.goalHours    && `Daily goal: ${formatGoalHours(summary.goalHours)}`,
        summary.watchedApps?.length > 0 && `${summary.watchedApps.length} app${summary.watchedApps.length > 1 ? 's' : ''} getting soft limits`,
        summary.habitApps?.length  > 0 && `${summary.habitApps.length} daily habit${summary.habitApps.length > 1 ? 's' : ''} to track`,
    ].filter(Boolean);

    return (
        <div className="wz-step wz-step--done">
            <div className="wz-done-icon">
                <span className="material-symbols-rounded" aria-hidden="true">
                    {configured.length > 0 ? 'celebration' : 'explore'}
                </span>
            </div>
            <h2 className="wz-step-title">
                {configured.length > 0 ? 'Looking good!' : "You're all set!"}
            </h2>
            <p className="wz-step-sub">
                Deskly is personalized and already tracking in the background.
            </p>

            {configured.length > 0 && (
                <div className="wz-done-summary">
                    {configured.map((item, i) => (
                        <div key={i} className="wz-done-summary-row">
                            <span className="material-symbols-rounded" aria-hidden="true">check_circle</span>
                            {item}
                        </div>
                    ))}
                </div>
            )}

            <div className="wz-done-expect">
                <div className="wz-done-expect-title">What to expect</div>
                <div className="wz-done-expect-row">
                    <span className="material-symbols-rounded" aria-hidden="true">bar_chart</span>
                    Dashboard updates with your screen time every few minutes
                </div>
                <div className="wz-done-expect-row">
                    <span className="material-symbols-rounded" aria-hidden="true">insights</span>
                    Weekly insights unlock after your first full week of data
                </div>
                <div className="wz-done-expect-row">
                    <span className="material-symbols-rounded" aria-hidden="true">tune</span>
                    Fine-tune limits and habits anytime from App Usage or Settings
                </div>
            </div>

            <button className="wz-primary-btn wz-finish-btn" onClick={onFinish}>
                Open Dashboard
                <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
            </button>
        </div>
    );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────
export default function PersonalizationWizard({ userName, topApps, onComplete }) {
    const [step, setStep]       = useState(1);
    const [summary, setSummary] = useState({});

    const next = (data = {}) => {
        if (data === true) { onComplete(); return; }
        setSummary(prev => ({ ...prev, ...data }));
        if (step < TOTAL_STEPS) setStep(s => s + 1);
        else onComplete();
    };

    const back = () => setStep(s => Math.max(1, s - 1));

    return (
        <div className="wz-overlay">
            <div className="wz-card">
                <WizardProgress step={step} />
                {step === 1 && <StepWelcome userName={userName} onNext={next} onBack={back} />}
                {step === 2 && <StepGoal    onNext={next} onBack={back} />}
                {step === 3 && <StepWatch   onNext={next} onBack={back} />}
                {step === 4 && <StepHabits  onNext={next} onBack={back} />}
                {step === 5 && <StepDone    summary={summary} onFinish={onComplete} />}
            </div>
        </div>
    );
}
