import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ReactDOM from 'react-dom';
import AppIcon from '../components/AppIcon';
import Modal from '../components/Modal';
import { formatDuration } from '../utils/formatDuration';
import { hashString, CATEGORY_FALLBACK_PALETTE } from '../utils/colors';
import './CategoriesPage.css';

const PRESET_COLORS = [
    '#0D9488', '#2DD4BF', '#34d399', '#38bdf8',
    '#60a5fa', '#f472b6', '#fb7185', '#fbbf24',
    '#f97316', '#e879f9',
];
const PRESET_ICONS = [
    'work', 'sports_esports', 'chat', 'music_note',
    'menu_book', 'build', 'palette', 'computer', 'language', 'folder',
];
const formatTime = formatDuration;
const INBOX_PER_PAGE = 8;

const CATEGORY_TEMPLATES = [
    { id: 'work',          name: 'Work',          icon: 'computer',        color: '#60a5fa' },
    { id: 'entertainment', name: 'Entertainment', icon: 'sports_esports',  color: '#f472b6' },
    { id: 'social',        name: 'Social',        icon: 'chat',            color: '#34d399' },
    { id: 'learning',      name: 'Learning',      icon: 'menu_book',       color: '#fbbf24' },
    { id: 'gaming',        name: 'Gaming',        icon: 'videogame_asset', color: '#e879f9' },
    { id: 'utilities',     name: 'Utilities',     icon: 'build',           color: '#0D9488' },
];

function paletteFromId(id) {
    return CATEGORY_FALLBACK_PALETTE[hashString(id) % CATEGORY_FALLBACK_PALETTE.length];
}
const colorFor = (storedColor, id) => {
    if (id === 'uncategorized') return '#8b8b9e';
    return storedColor || paletteFromId(id);
};

// ── Inline category picker — rendered via React Portal so it's NEVER clipped
// by overflow:auto/hidden ancestors (main-content scroll container, etc.)
// Position is computed from the anchor button's getBoundingClientRect().
function InlinePicker({ anchorRef, appName, categories, suggestions, onAssign, onClose }) {
    const [pos, setPos] = useState(null);
    const [query, setQuery] = useState('');
    const inputRef = useRef(null);
    const pickerRef = useRef(null);
    const suggIds = new Set((suggestions || []).map(s => s.categoryId));

    // Compute fixed position from the anchor button
    useEffect(() => {
        const update = () => {
            if (!anchorRef?.current) return;
            const rect = anchorRef.current.getBoundingClientRect();
            const pickerW = 280;
            const viewH = window.innerHeight;
            const spaceBelow = viewH - rect.bottom;
            const spaceAbove = rect.top;
            // Prefer dropping down; flip up if not enough room
            const dropDown = spaceBelow >= 260 || spaceBelow >= spaceAbove;
            setPos(dropDown
                ? { top: rect.bottom + 6, right: window.innerWidth - rect.right }
                : { bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right }
            );
        };
        update();
        // Re-position on any scroll (capture phase covers nested scroll containers)
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [anchorRef]);

    // Auto-focus the search input
    useEffect(() => { inputRef.current?.focus(); }, []);

    // Click-outside closes the picker
    useEffect(() => {
        const handler = (e) => {
            if (
                pickerRef.current && !pickerRef.current.contains(e.target) &&
                anchorRef?.current && !anchorRef.current.contains(e.target)
            ) { onClose(); }
        };
        document.addEventListener('mousedown', handler, true);
        return () => document.removeEventListener('mousedown', handler, true);
    }, [onClose, anchorRef]);

    const filtered = useMemo(() => {
        const q = query.toLowerCase().trim();
        const cats = categories.filter(c => c.id !== 'uncategorized');
        if (!q) return [
            ...cats.filter(c => suggIds.has(c.id)),
            ...cats.filter(c => !suggIds.has(c.id)),
        ];
        return cats.filter(c => c.name.toLowerCase().includes(q));
    }, [categories, query, suggIds]);

    // Don't render until position is computed
    if (!pos) return null;

    const style = {
        position: 'fixed',
        right: pos.right,
        zIndex: 9999,
        ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
    };

    return ReactDOM.createPortal(
        <div ref={pickerRef} className="cats-picker" style={style} onClick={e => e.stopPropagation()}>
            <div className="cats-picker-header">
                <span className="cats-picker-label">Move <strong>{appName}</strong> to…</span>
                <button className="cats-picker-close" onClick={onClose} aria-label="Close">
                    <span className="material-symbols-rounded" aria-hidden="true">close</span>
                </button>
            </div>
            <div className="cats-picker-search-wrap">
                <span className="material-symbols-rounded cats-picker-search-icon" aria-hidden="true">search</span>
                <input
                    ref={inputRef}
                    className="cats-picker-search"
                    placeholder="Search categories…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
            </div>
            <div className="cats-picker-list">
                {filtered.length === 0 && (
                    <div className="cats-picker-empty">No categories match "{query}"</div>
                )}
                {filtered.map(cat => {
                    const color = colorFor(cat.color, cat.id);
                    const isSugg = suggIds.has(cat.id);
                    return (
                        <button
                            key={cat.id}
                            className={`cats-picker-row${isSugg ? ' suggested' : ''}`}
                            style={{ '--pc': color }}
                            onClick={() => onAssign(cat.id)}
                        >
                            <span className="material-symbols-rounded cats-picker-row-icon" style={{ color }} aria-hidden="true">
                                {cat.icon || 'folder'}
                            </span>
                            <span className="cats-picker-row-name">{cat.name}</span>
                            {isSugg && (
                                <span className="cats-picker-row-sugg">
                                    <span className="material-symbols-rounded" style={{ fontSize: 13 }} aria-hidden="true">auto_awesome</span>
                                    suggested
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>,
        document.body
    );
}

// ── Each inbox row owns its own button ref so InlinePicker can position itself ─
function InboxRow({ app, isExiting, isOpen, sugg, assignableCategories, onToggle, onAssign, animDelay }) {
    const btnRef = useRef(null);
    const { name, seconds } = app;

    return (
        <div
            className={`inbox-row-wrap list-item-animated${isExiting ? ' exiting' : ''}`}
            style={{ animationDelay: animDelay || '0s' }}
        >
            <div className={`inbox-row${isOpen ? ' picker-open' : ''}`}>
                <AppIcon appName={name} size={34} />
                <div className="inbox-app">
                    <span className="inbox-app-name" title={name}>{name}</span>
                    <span className="inbox-app-time">
                        {seconds > 0 ? formatDuration(seconds) : 'Not used today'}
                    </span>
                </div>
                <button
                    ref={btnRef}
                    className={`inbox-assign-btn${isOpen ? ' active' : ''}`}
                    onClick={() => onToggle(name)}
                >
                    <span className="material-symbols-rounded" aria-hidden="true">
                        {isOpen ? 'keyboard_arrow_up' : 'drive_file_move'}
                    </span>
                    Assign
                </button>
            </div>
            {isOpen && (
                <InlinePicker
                    anchorRef={btnRef}
                    appName={name}
                    categories={assignableCategories}
                    suggestions={sugg}
                    onAssign={catId => onAssign(name, catId)}
                    onClose={() => onToggle(null)}
                />
            )}
        </div>
    );
}

export default function CategoriesPage() {
    const { t } = useTranslation();
    const [categories, setCategories]     = useState([]);
    const [categoryStats, setCategoryStats] = useState([]);
    const [appsByCategory, setAppsByCategory] = useState([]);
    const [loading, setLoading]           = useState(true);
    const [error, setError]               = useState(null);

    // Create modal
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName]       = useState('');
    const [newColor, setNewColor]     = useState(PRESET_COLORS[0]);
    const [newIcon, setNewIcon]       = useState('folder');

    // Legacy assign modal (used from inside expanded category cards)
    const [showAssign, setShowAssign]             = useState(false);
    const [selectedApp, setSelectedApp]           = useState(null);
    const [appSuggestions, setAppSuggestions]     = useState(null);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    // Category grid
    const [viewMode, setViewMode]             = useState('grid');
    const [expandedCategory, setExpandedCategory] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId]   = useState(null);
    const [catSearch, setCatSearch]           = useState('');

    // Inbox
    const [inboxSuggestions, setInboxSuggestions] = useState({});
    const [assigningApps, setAssigningApps]       = useState({});
    const [inboxSearch, setInboxSearch]           = useState('');
    const [inboxPage, setInboxPage]               = useState(0);
    const [openPickerApp, setOpenPickerApp]       = useState(null); // app name with picker open

    // Onboarding intro state
    const [selectedTemplates, setSelectedTemplates] = useState(() => new Set(['work', 'entertainment', 'social']));
    const [isCreating, setIsCreating]               = useState(false);

    const [actionError, setActionError] = useState(null);
    const [savingCreate, setSavingCreate] = useState(false);
    const showActionError = (msg) => { setActionError(msg); setTimeout(() => setActionError(null), 4000); };

    // ── Data loading ──────────────────────────────────────────────────────────
    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [cats, stats, apps] = await Promise.all([
                window.electronAPI.getCategories(),
                window.electronAPI.getCategoryStats(),
                window.electronAPI.getAppsByCategory(),
            ]);
            setCategories(cats || []);
            setCategoryStats(stats || []);
            setAppsByCategory(apps || []);
        } catch (e) {
            setError('Could not load categories. Please try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    // Body scroll lock — only for the inline picker. The <Modal> dialogs
    // (create / assign / confirm-delete) manage their own scroll lock and ESC
    // internally, so handling them here too would race the modal's own cleanup.
    useEffect(() => {
        if (!openPickerApp) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [openPickerApp]);

    // ESC closes the inline picker (Modal owns ESC for the dialogs)
    useEffect(() => {
        if (!openPickerApp) return;
        const handler = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setOpenPickerApp(null);
        };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [openPickerApp]);

    // ── Derived data ──────────────────────────────────────────────────────────
    const totalTime = useMemo(() =>
        categoryStats.reduce((s, c) => s + c.totalSeconds, 0), [categoryStats]);
    const totalApps = useMemo(() =>
        appsByCategory.reduce((s, c) => s + c.apps.length, 0), [appsByCategory]);
    const topCategory = useMemo(() =>
        categoryStats.length > 0
            ? categoryStats.reduce((mx, c) => c.totalSeconds > mx.totalSeconds ? c : mx)
            : null, [categoryStats]);
    const statMap = useMemo(() => new Map(categoryStats.map(s => [s.id, s])), [categoryStats]);
    const catMap  = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

    const sortedDistribution = useMemo(() =>
        categoryStats.filter(c => c.totalSeconds > 0)
            .sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, 6),
        [categoryStats]);

    const assignableCategories = useMemo(() =>
        categories.filter(c => c.id !== 'uncategorized'), [categories]);

    const uncategorizedApps = useMemo(() => {
        const bucket = appsByCategory.find(c => c.id === 'uncategorized');
        if (!bucket) return [];
        const stat   = statMap.get('uncategorized') || { apps: [] };
        const timeOf = n => stat.apps?.find(a => a.name === n)?.seconds || 0;
        return [...bucket.apps]
            .map(app => ({ ...app, seconds: timeOf(app.name) }))
            .sort((a, b) => b.seconds - a.seconds);
    }, [appsByCategory, statMap]);

    // Inbox filtering + pagination
    const filteredInbox = useMemo(() => {
        const q = inboxSearch.toLowerCase().trim();
        return q ? uncategorizedApps.filter(a => a.name.toLowerCase().includes(q)) : uncategorizedApps;
    }, [uncategorizedApps, inboxSearch]);

    const inboxTotalPages = Math.max(1, Math.ceil(filteredInbox.length / INBOX_PER_PAGE));
    const safePage        = Math.min(inboxPage, inboxTotalPages - 1);
    const pagedInbox      = filteredInbox.slice(safePage * INBOX_PER_PAGE, (safePage + 1) * INBOX_PER_PAGE);

    // Reset page when search changes
    useEffect(() => { setInboxPage(0); }, [inboxSearch]);

    // Batch-fetch suggestions for visible inbox apps
    useEffect(() => {
        if (!window.electronAPI?.getCategorySuggestionsForApp) return;
        const targets = pagedInbox.filter(a => !(a.name in inboxSuggestions));
        if (!targets.length) return;
        let cancelled = false;
        (async () => {
            const updates = {};
            for (const app of targets) {
                try {
                    const res = await window.electronAPI.getCategorySuggestionsForApp(app.name);
                    updates[app.name] = res?.suggestions || [];
                } catch { updates[app.name] = []; }
            }
            if (!cancelled) setInboxSuggestions(prev => ({ ...prev, ...updates }));
        })();
        return () => { cancelled = true; };
    }, [pagedInbox]); // eslint-disable-line react-hooks/exhaustive-deps

    // Category grid filtering
    const filteredCatGrid = useMemo(() => {
        const q = catSearch.toLowerCase().trim();
        return appsByCategory.filter(c => {
            if (c.id === 'uncategorized' && uncategorizedApps.length > 0 && assignableCategories.length > 0) return false;
            if (!q) return true;
            return c.name.toLowerCase().includes(q);
        });
    }, [appsByCategory, catSearch, uncategorizedApps.length, assignableCategories.length]);

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleCreate = async () => {
        if (savingCreate) return;
        // Normalize: trim + collapse internal whitespace, cap length.
        const name = newName.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!name) return;
        // Reject duplicates (case-insensitive) rather than silently creating a second
        // category with the same name.
        const dupe = categories.some(c => (c.name || '').trim().toLowerCase() === name.toLowerCase());
        if (dupe) {
            showActionError(`A category named "${name}" already exists.`);
            return;
        }
        setSavingCreate(true);
        try {
            await window.electronAPI.createCategory(name, newColor, newIcon);
            // Only clear + close the modal AFTER the write succeeds, so a failure keeps
            // the user's input rather than pretending it worked.
            setShowCreate(false); setNewName(''); setNewColor(PRESET_COLORS[0]); setNewIcon('folder');
            loadData();
        } catch (e) {
            console.error('Create category failed:', e);
            showActionError('Could not create the category. Please try again.');
        } finally {
            setSavingCreate(false);
        }
    };

    const handleDelete = (id) => { if (id !== 'uncategorized') setConfirmDeleteId(id); };
    const handleConfirmDelete = async () => {
        const id = confirmDeleteId;
        setConfirmDeleteId(null);
        // Snapshot for rollback — if the delete fails we restore rather than leave the
        // user thinking it vanished then silently reappeared.
        const prevCats  = categories;
        const prevByCat = appsByCategory;
        const prevStats = categoryStats;
        setCategories(p => p.filter(c => c.id !== id));
        setAppsByCategory(p => p.filter(c => c.id !== id));
        setCategoryStats(p => p.filter(c => c.id !== id));
        try {
            await window.electronAPI.deleteCategory(id);
            loadData();
        } catch (e) {
            console.error('Delete category failed:', e);
            setCategories(prevCats);
            setAppsByCategory(prevByCat);
            setCategoryStats(prevStats);
            showActionError('Could not delete the category. It has been restored.');
        }
    };

    const triageAssign = async (appName, categoryId) => {
        setOpenPickerApp(null);
        setAssigningApps(p => ({ ...p, [appName]: categoryId }));
        try { await window.electronAPI.assignAppToCategory(appName, categoryId); }
        catch { showActionError('Could not assign app to category. Please try again.'); }
        setTimeout(() => {
            loadData();
            setAssigningApps(p => { const n = { ...p }; delete n[appName]; return n; });
        }, 350);
    };

    const handleAssign = async (categoryId) => {
        if (!selectedApp) return;
        const app = selectedApp;
        try {
            await window.electronAPI.assignAppToCategory(app, categoryId);
            setShowAssign(false); setSelectedApp(null);
            loadData();
        } catch (e) {
            console.error('Assign app failed:', e);
            showActionError('Could not assign the app. Please try again.');
        }
    };

    const openAssignModal = async (appName, e) => {
        e?.stopPropagation();
        setSelectedApp(appName); setShowAssign(true); setAppSuggestions(null);
        if (!window.electronAPI?.getCategorySuggestionsForApp) return;
        try {
            setLoadingSuggestions(true);
            const res = await window.electronAPI.getCategorySuggestionsForApp(appName);
            setAppSuggestions(res || null);
        } catch { /* silent */ } finally { setLoadingSuggestions(false); }
    };

    const toggleTemplate = useCallback((id) => {
        setSelectedTemplates(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const handleQuickStart = async () => {
        const toCreate = CATEGORY_TEMPLATES.filter(t => selectedTemplates.has(t.id));
        if (!toCreate.length) return;
        setIsCreating(true);
        try {
            await Promise.all(toCreate.map(t =>
                window.electronAPI.createCategory(t.name, t.color, t.icon)
            ));
        } catch { showActionError('Could not create categories. Please try again.'); }
        await loadData();
        setIsCreating(false);
    };

    const getStatForCategory = id => statMap.get(id) || { totalSeconds: 0, apps: [] };

    // ── Loading / error ───────────────────────────────────────────────────────
    if (loading) return (
        <div className="categories-page-v2">
            <div className="loading-state-animated">
                <div className="loading-spinner-smooth" />
                <p className="loading-text-animated">Loading categories…</p>
            </div>
        </div>
    );
    if (error) return (
        <div className="categories-page-v2">
            <div className="error-state-animated">
                <span className="material-symbols-rounded error-icon-animated" aria-hidden="true">error</span>
                <h3>Could not load categories</h3>
                <p>{error}</p>
                <button onClick={loadData} className="btn-primary">Retry</button>
            </div>
        </div>
    );

    const inboxShown = uncategorizedApps.length > 0 && assignableCategories.length > 0;

    // ── Onboarding intro — shown when no custom categories have been created yet ──
    if (!loading && assignableCategories.length === 0) {
        const selectedCount = selectedTemplates.size;
        return (
            <div className="categories-page-v2">
                <div className="cat-intro-wrap">

                    {/* Live distribution preview bar — reacts to template toggle */}
                    <div className="cat-intro-preview-wrap">
                        <div className="cat-intro-preview">
                            {CATEGORY_TEMPLATES.map(t => (
                                <div
                                    key={t.id}
                                    className={`cat-intro-seg${selectedTemplates.has(t.id) ? '' : ' unselected'}`}
                                    style={{ background: t.color }}
                                />
                            ))}
                        </div>
                        <div className="cat-intro-preview-legend">
                            {CATEGORY_TEMPLATES.filter(t => selectedTemplates.has(t.id)).map(t => (
                                <span key={t.id} className="cat-intro-preview-dot" style={{ background: t.color }} title={t.name} />
                            ))}
                        </div>
                    </div>

                    {/* Heading */}
                    <h1 className="cat-intro-title">Your time, organized</h1>
                    <p className="cat-intro-sub">
                        {uncategorizedApps.length > 0
                            ? `${uncategorizedApps.length} app${uncategorizedApps.length !== 1 ? 's' : ''} are being tracked — group them into categories to see exactly where your day goes.`
                            : 'Group your apps into categories to see exactly where your day goes.'}
                    </p>

                    {/* Real app chips — personalized with the user's actual tracked apps */}
                    {uncategorizedApps.length > 0 && (
                        <div className="cat-intro-apps">
                            {uncategorizedApps.slice(0, 7).map((app, i) => (
                                <div
                                    key={app.name}
                                    className="cat-intro-app-chip"
                                    style={{ animationDelay: `${0.18 + i * 0.045}s` }}
                                >
                                    <AppIcon appName={app.name} size={18} />
                                    <span>{app.name}</span>
                                </div>
                            ))}
                            {uncategorizedApps.length > 7 && (
                                <span
                                    className="cat-intro-more"
                                    style={{ animationDelay: `${0.18 + 7 * 0.045}s` }}
                                >
                                    +{uncategorizedApps.length - 7} more
                                </span>
                            )}
                        </div>
                    )}

                    {/* Template picker — toggle which categories to create */}
                    <div className="cat-intro-templates-wrap">
                        <span className="cat-intro-templates-label">Quick start with templates</span>
                        <div className="cat-intro-templates">
                            {CATEGORY_TEMPLATES.map(t => {
                                const on = selectedTemplates.has(t.id);
                                return (
                                    <button
                                        key={t.id}
                                        className={`cat-tmpl-chip${on ? ' selected' : ''}`}
                                        style={{ '--tc': t.color }}
                                        onClick={() => toggleTemplate(t.id)}
                                    >
                                        <span className="material-symbols-rounded cat-tmpl-chip-ic" aria-hidden="true">{t.icon}</span>
                                        {t.name}
                                        {on && (
                                            <span className="material-symbols-rounded cat-tmpl-chip-check" aria-hidden="true">check</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* CTAs */}
                    <div className="cat-intro-actions">
                        <button
                            className="cat-intro-cta"
                            onClick={handleQuickStart}
                            disabled={selectedCount === 0 || isCreating}
                        >
                            {isCreating ? (
                                <>
                                    <span className="cat-intro-cta-spinner" />
                                    Setting up…
                                </>
                            ) : selectedCount === 0 ? (
                                'Select categories above'
                            ) : (
                                <>
                                    Create {selectedCount} Categor{selectedCount !== 1 ? 'ies' : 'y'}
                                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                                </>
                            )}
                        </button>
                        <button className="cat-intro-link" onClick={() => setShowCreate(true)}>
                            or build your own
                        </button>
                    </div>
                </div>

                {/* Create modal — for the "build your own" path */}
                {showCreate && (
                    <Modal
                        title="New Category"
                        onClose={() => setShowCreate(false)}
                        footer={
                            <>
                                <button className="dm-btn dm-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                                <button className="dm-btn dm-primary" onClick={handleCreate} disabled={!newName.trim()}>
                                    Create
                                </button>
                            </>
                        }
                    >
                        <div className="dm-body">
                            <div className="dm-cat-preview dm-form-group">
                                <div className="dm-preview-icon-wrap" style={{ background: `${newColor}20`, color: newColor }}>
                                    <span className="material-symbols-rounded" aria-hidden="true">{newIcon}</span>
                                </div>
                                <span className={`dm-preview-name${!newName ? ' dm-placeholder' : ''}`}>
                                    {newName || 'Category name'}
                                </span>
                            </div>
                            <div className="dm-form-group">
                                <label className="dm-label" htmlFor="new-cat-name-intro">Name</label>
                                <input
                                    id="new-cat-name-intro"
                                    className="dm-input"
                                    type="text"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder={t('categories.namePlaceholder')}
                                    maxLength={40}
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) handleCreate(); }}
                                />
                            </div>
                            <div className="dm-form-group">
                                <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                                    <legend className="dm-label">{t('categories.iconLabel')}</legend>
                                    <div className="dm-icon-grid">
                                        {PRESET_ICONS.map(icon => (
                                            <button
                                                key={icon}
                                                className={`dm-icon-btn${newIcon === icon ? ' dm-selected' : ''}`}
                                                onClick={() => setNewIcon(icon)}
                                                aria-label={icon}
                                                aria-pressed={newIcon === icon}
                                                data-no-active
                                            >
                                                <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
                                            </button>
                                        ))}
                                    </div>
                                </fieldset>
                            </div>
                            <div className="dm-form-group">
                                <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                                    <legend className="dm-label">{t('categories.colorLabel')}</legend>
                                    <div className="dm-color-grid">
                                        {PRESET_COLORS.map(color => (
                                            <button
                                                key={color}
                                                className={`dm-color-btn${newColor === color ? ' dm-selected' : ''}`}
                                                style={{ background: color }}
                                                onClick={() => setNewColor(color)}
                                                aria-label={color}
                                                aria-pressed={newColor === color}
                                                data-no-active
                                            />
                                        ))}
                                    </div>
                                </fieldset>
                            </div>
                        </div>
                    </Modal>
                )}
            </div>
        );
    }

    return (
        <div className="categories-page-v2">

            {/* ── Header ─────────────────────────────────────────────────── */}
            <header className="page-header page-header-animated cats-header">
                <div>
                    <h1 className="page-title">{t('categories.title')}</h1>
                    <p className="page-subtitle">{t('categories.subtitle')}</p>
                </div>
                <button className="btn-create" onClick={() => setShowCreate(true)}>
                    <span className="material-symbols-rounded" aria-hidden="true">add</span>
                    {t('categories.newCategory')}
                </button>
            </header>

            {actionError && (
                <div role="alert" style={{ background: 'var(--error-container)', color: 'var(--error)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden="true">error</span>
                    {actionError}
                </div>
            )}

            {/* Stats row */}
            <section className="cats-stats page-section">
                {/* 01 - Total Time (hero) */}
                <div className="cats-stat cats-stat--hero">
                    <span className="cats-stat-ordinal">01</span>
                    <div className="cats-stat-body">
                        <span className="cats-stat-value cats-stat-value--hero">{formatTime(totalTime)}</span>
                        <span className="cats-stat-divider" aria-hidden="true" />
                        <span className="cats-stat-label">Total Time<i className="cats-stat-label-em"> · today</i></span>
                    </div>
                </div>

                {/* 02 - Categories (count + category-colored dots) */}
                <div className="cats-stat">
                    <span className="cats-stat-ordinal">02</span>
                    <div className="cats-stat-body">
                        <span className="cats-stat-value">{categories.filter(c => c.id !== 'uncategorized').length}</span>
                        <span className="cats-stat-cat-dots" aria-hidden="true">
                            {categories.filter(c => c.id !== 'uncategorized').slice(0, 6).map((c, i) => (
                                <span
                                    key={c.id}
                                    className="cats-stat-cat-dot"
                                    style={{
                                        background: colorFor(c.color, c.id),
                                        animationDelay: `${i * 0.06}s`,
                                    }}
                                    title={c.name}
                                />
                            ))}
                        </span>
                        <span className="cats-stat-divider" aria-hidden="true" />
                        <span className="cats-stat-label">Categories</span>
                    </div>
                </div>

                {/* 03 - Apps Tracked (count + sub-meta) */}
                <div className="cats-stat">
                    <span className="cats-stat-ordinal">03</span>
                    <div className="cats-stat-body">
                        <span className="cats-stat-value">{totalApps}</span>
                        <span className="cats-stat-subline">
                            <span className="cats-stat-submeta">
                                across {categories.filter(c => c.id !== 'uncategorized').length} categor{categories.filter(c => c.id !== 'uncategorized').length !== 1 ? 'ies' : 'y'}
                            </span>
                        </span>
                        <span className="cats-stat-divider" aria-hidden="true" />
                        <span className="cats-stat-label">Apps Tracked</span>
                    </div>
                </div>

                {/* 04 - Most Active (italic category name + sub-meta) */}
                <div className="cats-stat">
                    <span className="cats-stat-ordinal">04</span>
                    <div className="cats-stat-body">
                        <span
                            className="cats-stat-value cats-stat-value--app"
                            style={topCategory ? { color: colorFor((catMap.get(topCategory.id) || {}).color, topCategory.id) } : undefined}
                        >
                            {topCategory?.name || '—'}
                        </span>
                        {topCategory && (
                            <span className="cats-stat-subline">
                                <span className="cats-stat-subtime">{formatTime(topCategory.totalSeconds)}</span>
                                <span className="cats-stat-submeta">
                                    {' · '}{totalTime > 0 ? Math.round((topCategory.totalSeconds / totalTime) * 100) : 0}% of today
                                </span>
                            </span>
                        )}
                        <span className="cats-stat-divider" aria-hidden="true" />
                        <span className="cats-stat-label">Most Active</span>
                    </div>
                </div>
            </section>

            {/* ── Time Distribution ──────────────────────────────────────── */}
            {sortedDistribution.length > 0 && (
                <section className="distribution-section page-section">
                    <div className="section-header">
                        <h2>Time Distribution</h2>
                        <span className="section-sub">Today's breakdown by category</span>
                    </div>
                    <div className="dist-stacked">
                        {sortedDistribution.map((cat, i) => {
                            const pct   = totalTime > 0 ? (cat.totalSeconds / totalTime) * 100 : 0;
                            const color = colorFor((catMap.get(cat.id) || {}).color, cat.id);
                            return (
                                <div key={cat.id} className="dist-seg"
                                    style={{ width: `${pct}%`, background: color, animationDelay: `${i * 0.06}s` }}
                                    title={`${cat.name} · ${Math.round(pct)}%`} />
                            );
                        })}
                    </div>
                    <div className="dist-legend">
                        {sortedDistribution.map((cat, i) => {
                            const pct   = totalTime > 0 ? (cat.totalSeconds / totalTime) * 100 : 0;
                            const color = colorFor((catMap.get(cat.id) || {}).color, cat.id);
                            return (
                                <div key={cat.id} className="legend-item">
                                    <span className="legend-dot" style={{ background: color }} />
                                    <span className="legend-name" title={cat.name}>{cat.name}</span>
                                    <span className="legend-time">{formatTime(cat.totalSeconds)}</span>
                                    <span className="legend-pct">{Math.round(pct)}%</span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ── Needs Sorting inbox ────────────────────────────────────── */}
            {inboxShown && (
                <section className="inbox-section page-section">
                    {/* Inbox header */}
                    <div className="inbox-head">
                        <div className="inbox-title-wrap">
                            <span className="inbox-badge">{uncategorizedApps.length}</span>
                            <div>
                                <h2 className="inbox-title">Needs Sorting</h2>
                                <span className="inbox-sub">Most-used first — click Assign to file each app</span>
                            </div>
                        </div>
                        {/* Inline search */}
                        <div className="inbox-search-wrap">
                            <span className="material-symbols-rounded inbox-search-icon" aria-hidden="true">search</span>
                            <input
                                className="inbox-search"
                                placeholder={t('categories.filterAppsPlaceholder')}
                                value={inboxSearch}
                                onChange={e => setInboxSearch(e.target.value)}
                            />
                            {inboxSearch && (
                                <button className="inbox-search-clear" aria-label="Clear search" onClick={() => setInboxSearch('')}>
                                    <span className="material-symbols-rounded" aria-hidden="true">close</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* App rows — key on search only; pagination doesn't remount to avoid AppIcon re-fetch */}
                    <div key={`inbox-${inboxSearch}`} className="inbox-list">
                        {pagedInbox.length === 0 ? (
                            <div className="inbox-empty">
                                <span className="material-symbols-rounded" aria-hidden="true">manage_search</span>
                                <p>No apps match "{inboxSearch}"</p>
                            </div>
                        ) : pagedInbox.map((app, idx) => (
                            <InboxRow
                                key={app.name}
                                app={app}
                                isExiting={!!assigningApps[app.name]}
                                isOpen={openPickerApp === app.name}
                                sugg={inboxSuggestions[app.name] || []}
                                assignableCategories={assignableCategories}
                                onToggle={name => setOpenPickerApp(prev => prev === name ? null : name)}
                                onAssign={triageAssign}
                                animDelay={`${Math.min(idx * 0.025, 0.2)}s`}
                            />
                        ))}
                    </div>

                    {/* Pagination */}
                    {inboxTotalPages > 1 && (
                        <div className="inbox-pagination">
                            <button
                                className="inbox-page-btn"
                                disabled={safePage === 0}
                                onClick={() => setInboxPage(p => Math.max(0, p - 1))}
                            >
                                <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
                            </button>
                            <span className="inbox-page-label">
                                {safePage + 1} of {inboxTotalPages}
                                <span className="inbox-page-count"> · {filteredInbox.length} apps</span>
                            </span>
                            <button
                                className="inbox-page-btn"
                                disabled={safePage >= inboxTotalPages - 1}
                                onClick={() => setInboxPage(p => Math.min(inboxTotalPages - 1, p + 1))}
                            >
                                <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                            </button>
                        </div>
                    )}
                </section>
            )}

            {/* ── All Categories ─────────────────────────────────────────── */}
            <section className="categories-section page-section">
                <div className="section-header">
                    <h2>All Categories</h2>
                    <div className="cats-grid-controls">
                        {/* Category search */}
                        <div className="cat-grid-search-wrap">
                            <span className="material-symbols-rounded cat-grid-search-icon" aria-hidden="true">search</span>
                            <input
                                className="cat-grid-search"
                                placeholder={t('categories.searchPlaceholder')}
                                value={catSearch}
                                onChange={e => setCatSearch(e.target.value)}
                            />
                            {catSearch && (
                                <button className="inbox-search-clear" aria-label="Clear search" onClick={() => setCatSearch('')}>
                                    <span className="material-symbols-rounded" aria-hidden="true">close</span>
                                </button>
                            )}
                        </div>
                        {/* View toggle */}
                        <div className="view-toggle">
                            {['grid_view', 'view_list'].map((icon, i) => {
                                const mode = i === 0 ? 'grid' : 'list';
                                return (
                                    <button key={mode}
                                        className={`toggle-btn${viewMode === mode ? ' active' : ''}`}
                                        onClick={() => setViewMode(mode)}
                                    >
                                        <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {filteredCatGrid.length === 0 && catSearch ? (
                    <div className="empty-distribution">
                        <span className="material-symbols-rounded" aria-hidden="true">manage_search</span>
                        <p>No categories match "{catSearch}"</p>
                    </div>
                ) : filteredCatGrid.length === 0 ? (
                    <div className="empty-distribution">
                        <span className="material-symbols-rounded" aria-hidden="true">category</span>
                        <p>Create a category to get started</p>
                    </div>
                ) : (
                    <div key={`cats-${viewMode}-${catSearch}`} className={`categories-container ${viewMode}`}>
                        {filteredCatGrid.map((category, catIdx) => {
                            const stat          = getStatForCategory(category.id);
                            const catData       = categories.find(c => c.id === category.id) || {};
                            const isUncategorized = category.id === 'uncategorized';
                            const isExpanded    = expandedCategory === category.id;
                            const pct           = totalTime > 0 ? (stat.totalSeconds / totalTime) * 100 : 0;
                            const color         = colorFor(catData.color, category.id);
                            // First 3 apps for the preview row shown in collapsed state
                            const previewApps   = category.apps.slice(0, 3);

                            return (
                                <div
                                    key={category.id}
                                    className={`category-card-v2 list-item-animated${isExpanded ? ' expanded' : ''}`}
                                    style={{
                                        '--cat-color': color,
                                        animationDelay: `${Math.min(catIdx * 0.015, 0.10)}s`,
                                    }}
                                    role="button" tabIndex={0}
                                    aria-expanded={isExpanded}
                                    onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setExpandedCategory(isExpanded ? null : category.id);
                                        }
                                    }}
                                >
                                    {/* Left accent bar */}
                                    <div className="card-accent" />

                                    <div className="card-header">
                                        <div className="card-icon-wrap">
                                            <span className="card-icon material-symbols-rounded" aria-hidden="true">{catData.icon || 'folder'}</span>
                                        </div>
                                        <div className="card-info">
                                            <h3 className="card-title" title={category.name}>{category.name}</h3>
                                            <span className="card-meta">
                                                {category.apps.length} app{category.apps.length !== 1 ? 's' : ''}
                                                {stat.totalSeconds > 0 && <> · <strong>{formatTime(stat.totalSeconds)}</strong></>}
                                            </span>
                                        </div>

                                        {/* Mini app icon preview — visible when collapsed */}
                                        {!isExpanded && previewApps.length > 0 && (
                                            <div className="card-preview-icons">
                                                {previewApps.map((app, i) => (
                                                    <div key={app.name} className="card-preview-icon" style={{ zIndex: 3 - i }}>
                                                        <AppIcon appName={app.name} size={22} />
                                                    </div>
                                                ))}
                                                {category.apps.length > 3 && (
                                                    <div className="card-preview-more">+{category.apps.length - 3}</div>
                                                )}
                                            </div>
                                        )}

                                        <div className="card-actions">
                                            {!isUncategorized && (
                                                <button
                                                    className="card-action-btn delete"
                                                    onClick={e => { e.stopPropagation(); handleDelete(category.id); }}
                                                    aria-label={`Delete ${category.name}`}
                                                >
                                                    <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                                                </button>
                                            )}
                                            <span className={`expand-arrow material-symbols-rounded${isExpanded ? ' rotated' : ''}`} aria-hidden="true">
                                                expand_more
                                            </span>
                                        </div>
                                    </div>

                                    {/* Usage bar */}
                                    <div className="card-progress">
                                        <div className="card-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
                                    </div>

                                    {/* Apps list — always in DOM, animated with CSS grid trick */}
                                    <div className={`card-apps-shell${isExpanded ? ' open' : ''}`}>
                                        <div className="card-apps-inner">
                                            <div className="card-apps">
                                                {category.apps.length === 0 ? (
                                                    <div className="no-apps">
                                                        <span className="material-symbols-rounded" aria-hidden="true">inbox</span>
                                                        <p>No apps yet</p>
                                                    </div>
                                                ) : category.apps.map(app => {
                                                    const appStat = stat.apps?.find(a => a.name === app.name);
                                                    const appSec  = appStat?.seconds || 0;
                                                    return (
                                                        <div key={app.name} className="app-row-v2">
                                                            <AppIcon appName={app.name} size={30} />
                                                            <div className="app-row-info">
                                                                <span className="app-row-name" title={app.name}>{app.name}</span>
                                                                <span className="app-row-time">
                                                                    {appSec > 0 ? formatTime(appSec) : 'Not used today'}
                                                                </span>
                                                            </div>
                                                            <button
                                                                className="app-move-btn"
                                                                onClick={e => { e.stopPropagation(); setOpenPickerApp(prev => prev === app.name ? null : app.name); }}
                                                                title="Move to another category"
                                                            >
                                                                <span className="material-symbols-rounded" aria-hidden="true">drive_file_move</span>
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ── Create modal ───────────────────────────────────────────── */}
            {showCreate && (
                <Modal
                    title="New Category"
                    onClose={() => setShowCreate(false)}
                    footer={
                        <>
                            <button className="dm-btn dm-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button className="dm-btn dm-primary" onClick={handleCreate} disabled={!newName.trim()}>
                                Create
                            </button>
                        </>
                    }
                >
                    <div className="dm-body">
                        {/* Live preview */}
                        <div className="dm-cat-preview dm-form-group">
                            <div
                                className="dm-preview-icon-wrap"
                                style={{ background: `${newColor}20`, color: newColor }}
                            >
                                <span className="material-symbols-rounded" aria-hidden="true">{newIcon}</span>
                            </div>
                            <span className={`dm-preview-name${!newName ? ' dm-placeholder' : ''}`}>
                                {newName || 'Category name'}
                            </span>
                        </div>

                        <div className="dm-form-group">
                            <label className="dm-label" htmlFor="new-cat-name">Name</label>
                            <input
                                id="new-cat-name"
                                className="dm-input"
                                type="text"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="e.g. Development, Entertainment"
                                maxLength={40}
                                autoFocus
                                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) handleCreate(); }}
                            />
                        </div>

                        <div className="dm-form-group">
                            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                                <legend className="dm-label">Icon</legend>
                                <div className="dm-icon-grid">
                                    {PRESET_ICONS.map(icon => (
                                        <button
                                            key={icon}
                                            className={`dm-icon-btn${newIcon === icon ? ' dm-selected' : ''}`}
                                            onClick={() => setNewIcon(icon)}
                                            aria-label={icon}
                                            aria-pressed={newIcon === icon}
                                            data-no-active
                                        >
                                            <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        </div>

                        <div className="dm-form-group">
                            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                                <legend className="dm-label">Color</legend>
                                <div className="dm-color-grid">
                                    {PRESET_COLORS.map(color => (
                                        <button
                                            key={color}
                                            className={`dm-color-btn${newColor === color ? ' dm-selected' : ''}`}
                                            style={{ background: color }}
                                            onClick={() => setNewColor(color)}
                                            aria-label={color}
                                            aria-pressed={newColor === color}
                                            data-no-active
                                        />
                                    ))}
                                </div>
                            </fieldset>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Assign modal (from inside category cards) ──────────────── */}
            {showAssign && (
                <Modal
                    title="Move App"
                    onClose={() => { setShowAssign(false); setSelectedApp(null); }}
                    maxWidth={400}
                >
                    <div className="dm-body">
                        <div className="dm-selected-app">
                            <AppIcon appName={selectedApp} size={36} />
                            <span className="dm-selected-app-name">{selectedApp}</span>
                        </div>

                        {(loadingSuggestions || appSuggestions?.suggestions?.length > 0) && (
                            <p className="dm-assign-hint">
                                {loadingSuggestions
                                    ? 'Analyzing app…'
                                    : `Suggested: ${appSuggestions.suggestions.map(s => s.categoryName).join(', ')}`}
                            </p>
                        )}

                        <div className="dm-cat-grid">
                            {categories.map(cat => {
                                const color  = colorFor(cat.color, cat.id);
                                const isSugg = appSuggestions?.suggestions?.some(s => s.categoryId === cat.id);
                                return (
                                    <button
                                        key={cat.id}
                                        className={`dm-cat-btn${isSugg ? ' dm-suggested' : ''}`}
                                        onClick={() => handleAssign(cat.id)}
                                    >
                                        <span className="material-symbols-rounded dm-cat-icon" style={{ color }} aria-hidden="true">
                                            {cat.icon || 'folder'}
                                        </span>
                                        <span className="dm-cat-name">{cat.name}</span>
                                        {isSugg && <span className="dm-cat-sugg-tag">Suggested</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Delete confirm ─────────────────────────────────────────── */}
            {confirmDeleteId && (
                <Modal
                    onClose={() => setConfirmDeleteId(null)}
                    maxWidth={380}
                    footer={
                        <>
                            <button className="dm-btn dm-ghost" autoFocus onClick={() => setConfirmDeleteId(null)}>
                                Keep it
                            </button>
                            <button className="dm-btn dm-danger" onClick={handleConfirmDelete}>
                                Delete
                            </button>
                        </>
                    }
                >
                    <div className="dm-body">
                        <div className="dm-danger-head">
                            <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                            <h2 className="dm-danger-title">Delete Category</h2>
                        </div>
                        <p className="dm-danger-body">
                            Apps in this category will be moved to Uncategorized.
                        </p>
                        <p className="dm-hint-text">This cannot be undone.</p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
