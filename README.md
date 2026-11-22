# Fnt

A custom, local-first spreadsheet for a personal nutrition workbook. No external
spreadsheet runtime, analytics, or backend account. Local development starts with
invented data. The published review build includes the owner-authorized testing
workbook, but not the original Excel attachment or private recovery archives.

**Review build, not a certified Excel replacement. Keep the original Excel file
authoritative until calculation compatibility and recovery are proven.**

## Run locally

Requires Node.js 22+.

```powershell
npm install
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173`. Development updates appear immediately.
For the offline-capable production build:

```powershell
npm run build
npm run preview
```

Open `http://127.0.0.1:4173` online once, then reload after the service worker
installs. Development mode deliberately has no service worker.
These are **local-computer URLs**, not internet deployments. Each origin/browser
has separate local storage; use backup/restore or explicit sync to move data.
Browser profiles (including isolated app preview tabs) also have separate
storage, even at the same address. Importing in the agent's shared preview does
not import into an unshared user tab. **File** shows that profile's origin,
Ingredients record count and whether an Excel source is attached; use
**Import Ingredients into this workbook** in the browser you actually use.
Save and wait for confirmation before refreshing to pick up a code update.
Refreshing does not sync edits from another browser profile. Production loads
`testing-workbook.json` into new profiles and upgrades untouched old starters,
preserving a full recovery checkpoint first. Existing edited, synced or imported
workbooks are never automatically replaced. **File > Load published testing
workbook** explicitly loads that snapshot while preserving the previous archive.
The authorized testing snapshot is the only published workbook data. Original
Excel packages, recovery histories, tokens and subsequent browser edits are not
automatically bundled or published.

## Use

- Select a cell and type, or edit in the formula bar. Both editors show the same
  live draft, committed once by Enter/Apply or selecting another cell. Escape
  cancels the draft; formulas display their results after commit. Enter/F2 starts
  in-cell editing; double-click or **Expand** opens a multiline textarea over the
  cell, not a dialog. It adapts to the visible viewport on mobile. Clicking outside
  applies changes; Escape cancels and Ctrl/Cmd+Enter applies from the keyboard.
  Cells never show horizontal or vertical scrollbars, including while typing.
  Long in-cell drafts still scroll to the caret; double-click opens the full editor.
  Editing notes does not change wrapping. Formula-column cells can be manually overridden.
  The formula bar marks **Calculated** versus **Manual**; **Restore** recovers
  the exact previous formula (or asks which existing column calculation to use).
  Overrides/default formulas survive save, copy/fill, moves and native backups.
  **Check units** opens a conversion diagnostic without altering formula text,
  XLOOKUP/IFERROR semantics, or a zero returned by an imported formula.
- Use Shift-click, row/column headers, or the cell-count button to select ranges
  on desktop or mobile. The cell-count menu also enables touch-drag selection
  without converting ordinary scrolling into edits.
  Ctrl/Cmd-click adds cells, rows or columns without losing a Shift-selected
  range. Formatting and clearing affect only the selection, not the gaps;
  operations requiring one rectangle explicitly reject disjoint selections.
  Arrow keys commit an in-cell or formula-bar edit and immediately navigate;
  rejected edits stay open. The expanded editor retains normal text navigation.
  Enter applies formula-bar edits. Ctrl/Cmd+Z, Y, F, S, A, C, X, V work.
  Scrollable surfaces share thin scrollbars without arrow buttons; cell displays
  and in-cell editors remain scrollbar-free. Tables have solid right and bottom
  edges, slightly darker than their header underline, following visible table
  identities through moves, hiding and virtual scrolling.
  Ctrl/Cmd+G creates a summary group; Ctrl/Cmd+Shift+G ungroups it.
  Select the summary row/column along with its details: the topmost row or
  leftmost column stays visible on collapse. Moving it moves its group together.
  Ctrl/Cmd+Alt+G creates a plain range group (all members hide);
  Ctrl/Cmd+Alt+Shift+G ungroups plain ranges.
  **Ungroup all plain groups (workbook)** in the group manager removes only plain
  groups on every sheet, preserving summaries, cells and a recovery checkpoint.
  Ctrl/Cmd+H adds a hypothetical tag to selected entire rows/columns;
  Ctrl/Cmd+Shift+H removes it. Summary descendants inherit dynamically, so moving
  them out removes inherited tags while explicit tags remain. Explicit clearing
  overrides inheritance, including for a nested summary's descendants.
  Changing a summary tag highlights children with manual tags or explicit
  clears and asks whether to overwrite them with automatic inheritance, keep
  the overrides, or cancel. Overwriting removes child flags rather than
  stamping them, so future parent changes and move-out behavior remain dynamic.
  Tagged rows/columns default to option D: 2px diagonal strokes, 6px clear gaps,
  and existing text colors at 80% opacity, without badges or added row height.
  **Arrange toolbar** enables individual tool dragging, including touch dragging.
  Use Alt+Left/Right for keyboard rearrangement, then **Finish arranging toolbar**
  to restore normal tool actions. The order is undoable and saved with the workbook,
  including native backups and private sync, across sheets and DD views.
  In arrange mode, hover between tools and click the ghost divider to add one;
  click an existing divider to remove it. Gap controls also support touch and
  keyboard activation. All dividers share one fixed-height style, and their
  positions are saved with the toolbar layout.

  The boxed H **Hypothetical treatments** toolbar button opens workbook-wide,
  live-preview settings: pattern family, color, opacity, width, spacing, angle,
  text color/opacity and added emphasis, background fill, optional square H
  badges and colors, solid or dashed badge borders with adjustable dash size
  and gap, and a custom display name (for example, Planned or Draft).
  Rows/columns share settings by default; unlink them for independent treatments.
  Row treatment takes priority at intersections. **Save** persists
  through local saves, native backups and configured private sync; Cancel leaves
  saved settings untouched.
  Optional badges appear once per tagged row (first visible column) or column
  (top visible row), after summary chevrons and before cell text. Tags preserve
  entry statuses and do not change formulas, values or totals. The stamp H
  marking button and **Set status > Remove hypothetical tag** provide
  pointer/touch equivalents.
  Cell selections ask which axis to use. Ungroup removes the exact group, or
  the innermost containing group; spanning separate groups removes their outer
  level while retaining nested groups. These operations are undoable and do not
  change cells or formulas. Shortcuts leave active text editors alone.
  **Operation left chevron** puts summary-group buttons before the text in the
  first visible cell of a summary row (or the first visible row of a summary
  column). Buttons stay outlined at rest, with 24px targets, 14px glyphs and no
  counts. Tree view indents nested rows in 24px steps; lines connect to nested
  buttons and skip horizontal branches for blank intermediate cells. Every
  expanded group has a vertical line ending at a centered horizontal cap on its
  last visible grouped row, even when that cell is blank. The corner menu retains
  independent nested-level controls.
  Plain-group buttons retain their header placement: an open eye means visible,
  and a slashed eye means hidden. Drag grips stay in the headers at fixed
  positions: row grips stay beside row numbers, and column grips stay above the
  letters. Column grouping buttons sit beside the letters, never in a band below
  them. Gutters and rendered columns widen as needed to prevent overlap; headers
  return to their compact profile when controls are absent. Saved column widths
  and cell contents stay unchanged.
  Inserting rows/columns between a group's first and last current members
  automatically adds them to every enclosing summary/plain group, including
  nested groups. Insertions immediately before or after a group stay outside it.
  Summary anchors, collapse states and existing formula identities are preserved.
  Moving existing rows/columns into a group's interior also adds them to all
  enclosing groups. Moving outside an old group removes that membership.
  Moving a summary preserves its own group and anchor, without retaining old
  enclosing memberships when dropped outside them.
  Rearranging shows a stroke across the full row or column at each visible
  boundary, including boundaries inside expanded groups. Receiving groups also
  highlight their first cell. Only collapsed-group destinations hide the stroke.
  Dropping into a collapsed group appends the moved items without expanding it;
  nested destinations highlight the innermost collapsed group.
  Dragging and tap-then-boundary moves use the same membership prediction;
  Escape cancels moving and clears the cue.
  The corner hierarchy icon opens row/column
  level toggles, independent plain-range eye controls and **Tree view** brackets.
  One nesting level shows one button per axis without redundant level headings.
  **Plain group hints** default on; the eye controls remain available whether
  groups are expanded or collapsed. Toggle them off explicitly to hide them.
  Tree view and hint preferences are stored with each sheet in autosave, manual
  saves, native backups and optional private sync, not as a global setting.
  Plain-range hints sit on the preceding visible row/column; a summary-row
  collision uses the first data cell so row numbers and summary controls remain
  separate. Group controls never add totals or rewrite formulas.
  Rows and columns can belong to both group types. A plain group containing a
  summary identity hides that summary and its entire current group, including
  nested summary details. Showing it again preserves the summary's independent
  collapsed/expanded state. The same hiding semantics are projected into XLSX.
  **Manage groups** opens an unblurred, non-modal panel beside the sheet
  (a bottom panel on mobile). Summary/plain cards show current coordinates,
  included cell previews and explicit hiding behavior; **Locate on sheet**
  highlights the visible members or their hint. A plain group selected on one
  summary lists the full affected range, rather than just its single anchor.
  Delete structurally removes row/column header selections (Shift-click selects
  several); ordinary cell selections clear contents without shifting cells.
  Both are undoable in one step. Delete remains text editing inside an editor.
  Toolbar Copy/Paste retains internal formulas, formatting, and source bindings;
  external clipboard text supports quoted multiline/tab-separated fields.
  The dashed copy indication survives selection changes; Escape clears it.
- **Rows & columns** inserts, deletes, hides, resizes, and moves records/columns.
  Hover headers to reveal grab handles and boundary **+** buttons. Moving does
  not require selecting the header first; drag, or tap a handle then a boundary.
  Shift-select headers to move multiple rows/columns together. Inserting with
  multiple same-axis headers selected adds the same number in one undoable step.
  Drag header edges to resize; double-click an edge to auto-fit without changing
  wrapping. Sheet tabs support drag reordering, double-click rename and a
  right-click command menu.
  **Fill down** copies formulas with relative/absolute reference handling and
  increments trailing text numbers (`Raisin 1`, `Raisin 2`, ...).
  The selected range's corner handle also supports mouse/touch drag-fill,
  including relative formulas and trailing numbers from a single text seed.
  Cell insert/delete shifts and **Cut > Paste** work in freeform areas, rebinding
  A1 formulas, named expressions and validation sources instead of applying copy
  offsets. Cut destinations must be empty of data/notes/links. Operations that
  would split table records, fragment a referenced range, or intersect generated
  spill cells are refused without changing the workbook; use whole rows/columns
  or edit the array anchor instead. Structural changes remain undoable.
- **File > Import Ingredients** merges a source Ingredients table into
  the existing table instead of replacing the workbook. Source records are added
  first; existing records, custom columns and other sheets are retained. Matching
  columns keep their identities, including the starter's `Ingredient` /
  `Ingredients` and `Calories per g` / `Calories2` equivalents.
  Referenced Dropdowns tables are imported without overwriting same-named data.
  Missing dependencies remain explicit reference errors, never links to examples.
  A full pre-import recovery archive is downloadable from Recovery checkpoints.
  Imports disconnect sync and refuse repeat imports of an unchanged attached file.
  The current tab is remembered across reloads in the same browser tab.
- **Tables** creates independent tables from selected rectangles, renames tables,
  configures/removes dropdowns, and edits scoped named formulas. Table headers
  are renamed as identities rather than overwritten as ordinary cell values.
  Freeform cells and multiple independent tables can coexist on one sheet.
  Typing directly below a table extends it using existing row IDs, calculated
  columns, formatting, and adjacent-row validation. A blank separating row, other
  table, or existing content in the target table area prevents auto-expansion.
  Double-click a table column header to rename it, add/manage/remove its applied
  dropdowns, or edit column formulas. Matching-pattern edits retain other formula
  patterns and manual overrides, updating their saved restore calculations.
  Replacing all manual values requires explicitly choosing **All data rows**.
- **Dropdown…** assigns a source to selected cells or a table's selected columns
  without changing their contents. Click an assigned cell or its dropdown arrow
  to search and choose options; Alt+Down opens it from the keyboard. Escape
  dismisses the list. **Manual**, F2 and the expanded editor remain
  available. Choices retain exact source identities, including duplicate labels
  and distinct blank/space options. Selecting a table-backed option links it
  automatically; there is no separate linking step. Manual text never silently
  relinks. Explicit text XLOOKUP formulas retain ordinary first-match semantics.
  Select multiple sources to combine their options without merging duplicate
  record identities. **Grid view** provides checkbox cards with at most four
  preview options per source; previews do not limit the actual dropdown.
  Assignment opens in Grid view by default. Grid/List use the same compact
  dialog height, reduced only when required by the viewport.
  Source tabs above the searchable options mark the active list with a check.
  A lightweight **manual** action uses a solid green pencil and bold text when
  active. It closes the picker and starts direct cell editing, committed with
  Enter, Tab or selecting another cell; there is no separate Apply step.
  Only the chosen source's options scroll. The last source
  choice is saved per column for subsequent empty cells; existing linked entries
  retain their exact record and manual entries remain free text. Switching tabs
  does not change existing cells. There is no picker footer; the small **+**
  beside the tabs opens source assignment. Manual mode starts direct editing
  for subsequent empty cells. Reopening its picker (cell arrow or Alt+Down)
  immediately shows the last-used list's searchable options, without a manual
  panel or status row. Manual text never automatically matches a source record.
- Formatting controls use consistent local SVG icons. Bold, italic, underline,
  strikethrough and wrapping are independent; text-color and background-color
  buttons open palettes and support custom colors.
  With the grid selected: Ctrl+B bold, Ctrl+I italic, Ctrl+U underline,
  Ctrl+5 strikethrough, Ctrl+Alt+W wrap, Ctrl+Alt+C text color,
  Ctrl+Alt+B background color, and Ctrl+Alt+N number format. Compact hover/focus
  hints show the action name and keyboard-key badges for buttons with shortcuts.
  On macOS use Command instead of Ctrl and Option instead of Alt.
  Shortcuts do not intercept typing inside inputs or dialogs.
- **DD** at the bottom right toggles **Lists & conversions**, independently of the
  scrolling sheet tabs. Click **DD** again to return to
  your previous sheet and selection. Source tabs use the same spreadsheet grid,
  preserving formulas and formatting. Purple accents replace green tints in DD
  mode; white surfaces and stored cell colors are unchanged. Create, rename,
  reorder and archive lists; edit options or derived table/field/filter sources;
  connect them to selected cells without changing existing contents. Exact
  selections follow option renames, while manual strings stay manual. Removal
  shows usages and replacement/archive/cancel controls. Formula/text-dependent
  removals require explicit reference changes first; archival is nondestructive.
  Archived options are excluded from new choices, not from legacy table formulas.
  Blank imported records remain editable and available as explicit blank choices.
  Unit records are shared with the conversion-rule editor. Ingredient-specific
  serving conversions stay separate in Ingredients; changed universal rules can
  recalculate historical records and show an impact confirmation, not a freeze.
  Supporting sheets stay out of ordinary tabs; DD displays their canonical cells.
- DD categories use compact Chrome-style pills, with one faint trailing divider
  per top-level category. Group paths such as `Snack / Chocolate / Imported`
  support three nested levels. Collapse, rename, and reorder preserve record IDs.
- **DD > Import attached Excel sources** reads the original already saved in
  this browser. The seven original Dropdowns catalogs are also bundled with the
  app: IngredientType, Period, AnimalType, Table14, SnackCountry, SnackFlavour,
  and SnackCategory (28 records, including the original blank and space-only
  entry). They appear automatically in DD and the source picker for new and old
  browsers; no file chooser is needed for these catalogs. Save before reloading
  an already-open older tab. Startup preserves a full pre-update recovery archive
  and all pending edits. Verified original imports retain their edited options,
  archived identities and links; unrelated same-named sources remain separate.
  Removed catalogs do not reappear on every reload. No personal records, meals,
  Ingredients or workbook package are included in this bundled catalog.
- Importing additional supporting Excel data reads the original already saved in
  this browser, or select the original local XLSX in the manager. This targeted
  import retains Ingredients/logs, imports the seven Dropdowns lists and Convert,
  preserves a full pre-import archive, and disconnects sync. Reimporting the
  unchanged original keeps later edits instead of duplicating options. Known
  legacy formatting without raw Excel-code metadata is retained; actual value,
  format, shape or provenance conflicts are refused.
  MealDD retains its original FILTER definition and scoped names. If its actual
  source Meals is absent, it explicitly stays unavailable: sample Meals and cached
  labels are never substituted. Choosing another source is an explicit action.
- **Groups** handles nested row/column groups. **Meal / day** selects, groups,
  and moves whole header/detail blocks and creates explicit dated headers without
  a measured weight. It does not repair or rewrite imported chronology.
  **Group & move to top** moves the owning header and its details in one undoable
  action, collapses only the details, and preserves positional membership.
  New header totals handle the final/empty block; imported formulas are untouched.
  Planned/hypothetical/real metadata can filter the view but **does not silently
  exclude rows from existing calculations**.
- Tabs can be duplicated, renamed (double-click the active tab or use settings),
  reordered, colored, and deleted. Ctrl/Cmd+F commits the current draft and opens
  the fixed-height Find and Replace dialog. Find has no replacement field;
  replacement drafts survive tab switches. **All** selects every search sheet.
  Fields and buttons reuse the app's common dialog styles. Within and Direction
  use the spreadsheet's shared chevron and custom popup options instead of native
  browser menus. The focused Find input shares the dropdown's active field
  treatment: a single 1px border, with no offset outer focus ring. Copilot's shared Browser
  panel intercepts Ctrl/Cmd+F before forwarding it to the page; use the
  **Find / replace** toolbar button there. The shortcut works in a normal browser.
  Results have Cell/Value columns with one subheader per sheet; long result sets
  have explicit pagination. Case, entire-cell matching, `*`, `?`, escaped
  wildcards and upward/downward Find next are supported. Replace/Replace all are
  undoable and only change literal text, never formula source or linked cells.
- Top/Bottom, row navigation, and temporary selected-column pinning keep large
  sheets navigable. All rows occupy one continuous scrollable sheet; a bounded
  rendering window keeps large sheets responsive without paging. Column moves
  retain the current vertical and horizontal viewport.
  **Browse values** searches and scrubs dates or values from a chosen column,
  then jumps to the corresponding row. Pinned columns use IDs and can be
  non-first or multi-column selections; pinning changes only the temporary view.

## Reference integrity

The public app is served at `https://wendyyuanlu.github.io/fnt/`. GitHub Pages
publishes the `docs` build from `website`. Run `npm run build:pages` before
pushing app updates; this builds `/fnt/` assets without changing local `dist`.
Branch publishing avoids requiring an OAuth workflow scope. Local development
and production preview keep their existing root URLs.
The manifest, icon and offline cache use project-relative URLs. The deployed
origin has separate browser storage from either local preview; the authorized
testing snapshot supplies the review data without publishing the original XLSX.
Online navigation fetches current HTML rather than pinning an old offline shell.
Updates activate without waiting for every old tab to close; old assets remain
available until open clients acknowledge the current bundle. A **Save and update**
notice applies later code updates without silently discarding drafts. Offline
reload continues to use the cached shell and testing snapshot.
`scripts/check-dropdown-catalog.mjs` compares the bundled catalog with a read-only
local XLSX supplied through `FNT_REFERENCE`, in an isolated browser with
non-local network blocked. It prints only aggregate results.

Sheets, physical columns, row records, table columns, tables, and names have
independent stable IDs. Formulas are parsed into a serializable AST, never
evaluated with `eval` or `Function`. Structured references and A1 references
bind IDs, not header strings or visual indexes. Renames and moves retain
bindings. Deleted references do not rebind to later same-named replacements.
Copy/duplicate explicitly translate/remap identities.

The evaluator includes IF, IFERROR, lazy LET, SUM, AVERAGE, INDEX (including
range endpoints), MATCH, XMATCH, XLOOKUP, FILTER/spills, scoped names, ROW/ROWS,
ISNUMBER, DATE, DATEDIF, FIND, LEFT, ROUND, VALUE, INDIRECT, and additional basic
functions. Cell/vector dependency tracking invalidates affected calculations
after ordinary edits. Structural edits conservatively rebuild the calculation
context. Cycles, unsupported functions, blocked spills, and calculation limits
are explicit errors. Compatibility/limit errors are not hidden by IFERROR.
`INDIRECT` is text-based by definition and cannot automatically follow renames.

## Save, recover, and sync

IndexedDB commits the workbook and pending operation IDs in one transaction.
The saved indicator appears only after commit. Stale-tab revisions and quota
errors leave the previous durable workbook intact and show an explicit error.
Autosave is local; **Save** creates a local checkpoint or attempts connected
sync. Undo/redo is session-local (up to 30 actions, at most three full structural
snapshots; ordinary edits use cell deltas).

**File > Download independent full backup** includes IDs, formulas/ASTs, layout,
notes, links, validation sources, groups, pending operations, and preserved
original XLSX packages. Formula dictionaries keep repeated expressions compact.
Restore atomically saves a full pre-restore recovery archive first, disconnects
sync and retains pending operation IDs. Recovery checkpoint restores use the
same guarded path as backup restores, not an unprotected workbook replacement.
Recovery checkpoints
share device storage; they are not independent backups. Browser storage can be
evicted/cleared, devices can fail, and persistence permission is not a guarantee.
Keep downloaded backups privately on independent storage.

Private GitHub sync is optional, configured only in **File > Private GitHub
sync**. Supply an existing **separate private data repository and branch with no
Pages publishing**, and a fine-grained token scoped to that repository with
Contents read/write. The website source repository is explicitly rejected as a
data destination. Tokens remain in tab memory, never IndexedDB, backups, logs,
or source. No repository/account is provisioned automatically.

Save batches pending edits; there is no per-keystroke network upload. Uploads
check repository privacy, require GitHub Pages to be disabled, and use the remote
file SHA for compare-and-swap. Editing pauses while Save commits/acknowledges its
source revision, preventing incoming sync data from retargeting an active draft.
Compressed archives include original imported packages; larger files use the
Git blob read endpoint. Operation IDs recognize lost-ack retries. Divergence
preserves local and remote checkpoints and requires an explicit choice; **there
is no automatic structural merge or last-write-wins overwrite**. Network/API
failures retain pending local edits. Authorized synthetic-only live checks
against private `wendyyuanlu/fnt-data` passed actual GitHub writes/reads, independent
desktop/mobile-emulated clients, offline reload/divergence, a real stale-SHA 409,
lost-ack idempotency, explicit conflict recovery and a concurrent local-tab edit.
The credential remained in a bounded keyring-authenticated Node process behind
an allowlisted test transport, not in browser storage. This is not physical-device
credential setup, proof of fine-grained token permissions on a user's device, or
authorization to migrate a personal workbook. Tokens must be reentered after
reload; offline local editing remains available without them.
GitHub history is not an independent backup.

## Excel import and current limits

All ZIP/XML processing happens locally. Imports preserve every original XLSX
byte separately; **File > Download unchanged original XLSX** recovers it.
Edits are saved in Fnt format; the original is never overwritten. Cached formula results
are never passed off as calculated values. Shared formulas expand with proper
copy translation; cached spill followers do not become manual overrides.
Imported behavior/errors and name scopes are not silently repaired.

The compatibility report identifies unsupported calculations/validation sources
and preserved-only features. Print layout, merged-cell presentation, drawings,
conditional formatting, protection, rich text/themes, internal hyperlink
navigation, and some outline/validation/totals metadata remain only in the
original package. Original-file preservation is lossless; the editable grid is
**not** a full-fidelity Excel renderer.

**File > Export Excel projection + embedded Fnt archive** downloads a new XLSX
locally. Its Excel view includes supported cells/formulas, tables, dropdowns,
basic styles and raw number formats, row heights, row/column outlines, comments
and hyperlinks. It omits cached formula results and requests recalculation.
Excel validation sources use named helpers for cross-sheet/table references.
The ZIP also contains an integrity-checked, compressed native backup: workbook
identities and ASTs, exact picker bindings, manual overrides, layout, pending
operations and all preserved original file bytes. Unchanged exports reimport
that native snapshot exactly. The export can include private sheets that are
only in an archived original, even if they were not imported into the grid.

**Keep independent native backups authoritative.** Excel projection is not
lossless original-package write-back: merged layouts, charts, rich text,
conditional formatting, themes, print and totals metadata are not recreated.
Reference-manager identities, archival and recoverable calculation defaults are
preserved in the native archive. Excel-only dropdowns can expose archived rows
retained for legacy formulas; the website filters them from new choices.
Unsupported/nonrectangular layouts or unrepresentable values fail explicitly;
text is not truncated. XML and synthetic projection roundtrips are checked, but
opening/recalculation in Microsoft Excel is not certified. Other programs can
discard the embedded archive. Recognizable package edits import the edited
projection with new identities, never a stale snapshot; all non-native imports
warn that exact app identities/bindings cannot be restored from Excel alone.
**File > Recover embedded Fnt snapshot** deliberately ignores later external
Excel edits when an intact snapshot remains. Imports/restores disconnect sync,
retain pending journals and atomically store a downloadable full pre-restore
archive. Same-origin recovery is not an independent backup until downloaded.

Other remaining work before migration:

- Comprehensive Excel result parity, including approximate/wildcard lookup edge
  cases, array branching, full-row/column references and unusual reference syntax.
  DATE and date display share Excel's 1900 serial system (including serial 60),
  normalize month/day overflow and reject out-of-range dates. DATEDIF supports
  numeric serial dates with Y/M/D/YM; MD/YD remain explicit unsupported errors
  rather than approximations of Excel's legacy boundary quirks. Locale-dependent
  date-string arguments are not inferred.
- Large-workbook/mobile profiling. Calculations have explicit work/depth limits
  rather than unbounded freezes. Import/backup can use substantial memory.
- Partial-table cell shifts/cut moves and fragmented reference ranges are
  intentionally refused to protect record identities. Cross-page touch
  autoscrolling and advanced multi-seed numeric-series inference remain missing;
  explicit range selection and fill down work across pages.
- Automatic nonconflicting cross-device merging, unattended/background sync,
  and physical-device credential setup. Live synthetic authenticated integration
  passed; current conflict resolution is conservative and user-directed.
- OCR/photo entry and tailored workflows for secondary sheets remain deferred.

Import safety limits: 30 MB compressed, 180 MB expanded, 100,000 rows and
512 columns per sheet. Unsupported date systems are rejected without replacing
the current workbook. No external converter or data upload is used.

## Verification

```powershell
npm test
npx playwright install chromium
npm run test:browser
```

Browser tests build/type-check the app and start/reuse both local servers. They
exercise desktop and 390px mobile editing, rename/move integrity, undo/redo,
record binding/renames, multiline notes without wrapping, backup/restore,
synthetic XLSX shared formulas/scoped validation/spills, and real offline
production reload/edit/reload. Unit tests cover formula references, deletion
tombstones, duplicate semantics, copying, named scopes, cycles, incremental
invalidation, portable archives, atomic storage, stale-tab/quota failures, and
private/CAS/idempotent/conflict sync paths.

For an explicitly authorized synthetic-only live integration check against the
private personal test repository:

```powershell
$env:FNT_LIVE_SYNC = '1'
node scripts\check-live-sync.mjs
```

It uses the personal `wendyyuanlu` gh keyring credential only inside the bounded
test process, verifies private/no-Pages storage before writing, and restricts
uploads to isolated invented workbooks with no original XLSX packages. It removes
only its uniquely named test file afterward; synthetic Git commit history remains.
It never creates a repository, changes accounts, configures the user's saved app,
or uses their workbook. Do not run without explicit storage/test authorization.

An optional read-only local check accepts a private workbook path via
`FNT_REFERENCE` and prints only aggregate compatibility counts:

```powershell
$env:FNT_REFERENCE = 'C:\private\reference.xlsx'
node scripts\check-private-import.mjs
```

It blocks nonlocal network requests, uses a disposable browser context, checks
import/persist/reload/archive roundtrips and bounded calculation samples, then
confirms the original file hash is unchanged. Never add private workbooks,
backups, tokens, or generated personal data to source or test fixtures.