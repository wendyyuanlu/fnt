# Icon styling

Keep icon styling consistent throughout fnt, including UI previews. Use the existing custom inline SVG mechanism (`toolbarIcon` and `toolbarIconPaths` in `src/icons.ts`) as the reference, not a separate icon family.

Use 14px by 14px glyphs for row/column header icons and 18px by 18px glyphs for toolbar icons such as Bold/Italic. Header icons are a contextual size exception, not a different style: retain the same custom SVG rendering, `0 0 24 24` viewBox, `fill="none"`, `stroke="currentColor"`, 1px non-scaling strokes, and rounded line caps and joins.

Reuse shared header and toolbar styles rather than adding per-icon size, stroke, or color overrides. Button hit areas can differ for their layout or touch target independently of the glyph size.

Every toolbar button, including new group controls, must reuse `.icon-button` styling.
The summary-group split control uses `toolbarIcon('add')` at 14px by 14px on
its right side, matching the shared chevron glyph size.
Use the shared toggle tokens for the whole split control's active styling.
Enable its plus action only while the summary toggle is on, retaining the
standard disabled opacity. Reuse the table-selection split divider; do not add
a permanently bordered outer shell. Plus and caret SVGs share their sizing rule.

All `span.format-caret` chevrons reuse `dropdownArrowHtml` from
`src/dropdown-ui.ts`, rendered at 14px by 14px. Keep its existing `0 0 12 12`
viewBox and path, `fill="none"`, `stroke="currentColor"` and 1px non-scaling
stroke. Do not replace this shared SVG with CSS-border chevrons.
Workbook and DD tab categories share `categoryTabHtml` and `.tab-category`
presentation, including the same 14px SVG, padding and expanded/collapsed arrows;
only their mode/depth colors differ.

# Dialogs

All dialogs, including the nonmodal group manager, reuse `.dialog-surface` and the
shared tokens in `src/dialog.css`. Do not add independent shell padding, corner
radii, heading typography or widths to feature-specific dialog selectors.
The default width is 600px; `.popover` is the 336px variant and uses an H2 title.
Other dialog titles use the shared H1 styling based on Find and replace.
H2 styling follows Dropdown settings. The manual-tag overwrite comparison is
the explicit 1950px width exception. Preserve responsive 10px viewport gutters.

The workbook grid and Find previews share `.spreadsheet-grid` cell presentation.
Keep cell strokes, spacing and typography in that shared CSS rather than copying
them into the result preview.

# Scrollbars

Reuse the shared slim-scrollbar rules in `src/style.css` for scrollable surfaces. Preserve explicit scrollbar-free cases, including both `scrollbar-width: none` and hidden WebKit scrollbars for in-cell editors and cell displays.
