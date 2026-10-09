// ─────────────────────────────────────────────────────────────────────────────
// sanitizeText — neutralise hostile Unicode in untrusted display strings.
//
// App names, window titles and website names all originate from processes and
// pages we don't control. A malicious value can embed:
//   • Bidi overrides (U+202A–U+202E, U+2066–U+2069) that visually reorder text,
//     e.g. making "gpj.exe" render as "exe.jpg" — a classic spoofing trick.
//   • Zero-width / invisible characters (U+200B–U+200F, U+FEFF, soft hyphen …)
//     used to smuggle look-alike strings past the eye.
//   • C0/C1 control characters that can corrupt layout.
//
// React already escapes HTML, so this is NOT about XSS — it's about making sure
// what the user *sees* is what the string actually *is*. We strip the invisible
// controls so surrounding UI can't be silently reordered or spoofed.
//
// Regexes are built from \u escapes (via RegExp) so the dangerous code points
// never appear literally in source — that keeps the file safe to edit and
// immune to editors that would silently drop or normalise them.
// ─────────────────────────────────────────────────────────────────────────────

// Bidi embeddings/overrides (U+202A–U+202E), isolates (U+2066–U+2069),
// LRM/RLM (U+200E/U+200F), and Arabic letter mark (U+061C).
const BIDI = new RegExp('[\\u202A-\\u202E\\u2066-\\u2069\\u200E\\u200F\\u061C]', 'g');
// Zero-width space/non-joiner/joiner (U+200B–U+200D), word joiner (U+2060),
// BOM / zero-width no-break space (U+FEFF), soft hyphen (U+00AD).
const INVISIBLE = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF\\u00AD]', 'g');
// C0 controls (U+0000–U+001F) except tab (U+0009) / LF (U+000A) / CR (U+000D),
// DEL (U+007F), and C1 controls (U+0080–U+009F).
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');

/**
 * Return a display-safe version of an untrusted string.
 * Non-strings coerce to '' so callers can use it unconditionally.
 */
export function sanitizeText(input) {
    if (typeof input !== 'string') {
        if (input == null) return '';
        input = String(input);
    }
    return input
        .replace(BIDI, '')
        .replace(INVISIBLE, '')
        .replace(CONTROL, '')
        .trim();
}

/**
 * Like sanitizeText, but also caps length with an ellipsis. Useful for titles
 * that feed into fixed-width UI where a pathologically long string would blow
 * out layout even after clamping via CSS (which some flex contexts ignore).
 */
export function sanitizeTitle(input, max = 200) {
    const clean = sanitizeText(input);
    if (clean.length <= max) return clean;
    return clean.slice(0, max - 1).trimEnd() + '…';
}
