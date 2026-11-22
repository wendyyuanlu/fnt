# Icon styling

Keep icon styling consistent throughout fnt, including UI previews. Use the existing custom inline SVG mechanism (`toolbarIcon` and `toolbarIconPaths` in `src/icons.ts`) as the reference, not a separate icon family.

Use 14px by 14px glyphs for row/column header icons and 18px by 18px glyphs for toolbar icons such as Bold/Italic. Header icons are a contextual size exception, not a different style: retain the same custom SVG rendering, `0 0 24 24` viewBox, `fill="none"`, `stroke="currentColor"`, 1px non-scaling strokes, and rounded line caps and joins.

Reuse shared header and toolbar styles rather than adding per-icon size, stroke, or color overrides. Button hit areas can differ for their layout or touch target independently of the glyph size.

# Scrollbars

Reuse the shared slim-scrollbar rules in `src/style.css` for scrollable surfaces. Preserve explicit scrollbar-free cases, including both `scrollbar-width: none` and hidden WebKit scrollbars for in-cell editors and cell displays.
