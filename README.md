# Fnt

A custom, local-first spreadsheet for a personal nutrition workbook. No external
spreadsheet runtime, analytics, or backend account. Local development and the
published review build start with the same owner-authorized testing
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
Refreshing does not sync edits from another browser profile. Both development and production load
`testing-workbook.json` into new profiles and upgrades untouched old starters,
preserving a full recovery checkpoint first. Existing edited, synced or imported
workbooks are never automatically replaced. **File > Load published testing
workbook** explicitly loads that snapshot while preserving the previous archive.
The authorized testing snapshot contains Meals, Ingredients, the existing
**Tests** tabs (Meal TEST DATA, Daily log, Notebook TEST), and their required
dropdown/conversion dependencies, including the owner's explicitly approved
meal and ingredient data. The Tests Daily log is synthetic; unrelated original
daily/weight-tracking sheets remain excluded.
Meals row outlines have been converted to table-constrained summary groups
where the preceding row is ungrouped; column plain groups retain their kind
and are constrained to their containing table.
The authorized testing snapshot is the only published workbook data. Original
Excel packages, recovery histories, tokens and subsequent browser edits are not
automatically bundled or published.

Browser tests run their synthetic starter on a separate development server at
`http://127.0.0.1:5174`, with `VITE_FNT_SYNTHETIC_STARTER=true`. Normal development
does not enable that test-only setting. Merely visiting demo tables or migrating
their supporting dropdown records does not prevent an untouched demo upgrade;
actual user edits, sync configuration and attached originals still do.

For isolated performance checks without using an existing browser workbook:

```powershell
npm run build
npx vite preview --host 127.0.0.1 --port 4187 --strictPort
# In another terminal; each measurement uses a new, disposable Edge context:
node scripts\measure-performance.mjs http://127.0.0.1:4187
npx playwright test --config playwright.perf.config.ts performance.spec.ts
```

The dedicated browser-test configuration uses ports 5188, 5189 and 4187 and never
connects to the normal development or preview ports. The measurement script separates the
first uncached scroll, the first adjacent window and 20 cached scroll samples.
Set `FNT_CPU_RATE=4` in the environment for a CPU-throttled comparison.
These synchronous calculations can still exceed interactive frame budgets;
the measurement script does not assert that latency targets have been met.

Spreadsheet-action comparisons use separate production build directories and
fresh disposable profiles, not an existing edited workbook:

```powershell
npm run build -- --outDir C:\temp\fnt-after
npx vite preview --host 127.0.0.1 --port 4289 --strictPort --outDir C:\temp\fnt-after
# Run serially, with no concurrent browser tests or profiling:
node scripts\measure-actions.mjs http://127.0.0.1:4289/ C:\temp\fnt-actions.json
node scripts\measure-actions.mjs http://127.0.0.1:4289/ C:\temp\fnt-followup.json followup
$env:FNT_ACTION_PREVIEW_PORT='4289'
npx playwright test --config playwright.actions.config.ts action-performance.spec.ts
```

The action script records served bundle/snapshot hashes, settled paint and save
times, long tasks and formula/cell fingerprints. Its optional fourth argument
is `manager`, `find`, `columns`, or `followup` for an isolated subset. `followup`
includes an immediate cold one-character Find, cell/history and structural
actions, and native wheel geometry with a screenshot. Compare preserved
before/after builds with the same script, snapshot and viewport; these samples
are observations, not statistical latency guarantees. The action test
configuration uses 5388/5389/4289. `FNT_ACTION_BASELINE_ROOT` selects preserved
baseline source instead, on 5398/5399/4288.
`FNT_ACTION_PREVIEW_PORT` overrides the published-build test port.

Group-manager cards and source previews hydrate near the viewport. Find scans
current calculated/formatted values in cancellable slices; its complete
200-result pages include collapsed and off-screen matches, and choosing one
reveals the source cell. Source and option paging never truncates the list.
Known layout-only commands and Undo use scoped metadata records; cell-only
repaints retain the existing toolbar and headers. Structural edits still take
the conservative reference/conflict path when unrelatedness is not proven.
Table headers use native sticky bands bounded by their displayed table rows,
including table-end push-off and naturally pinned columns; table and sheet
grouping semantics are unchanged. Relevant collapsed-member masks are reused.
Proven cell-only edits and Undo retain dependency-valid calculation caches;
reference/range reuse is bounded, and progressive formatted-value search priming
cancels when its calculation generation changes or an actual query starts.
Priming also yields to saves, dialogs and text editing. Generic operators build
numeric vectors only when they actually consume them.

Content autosave keeps the existing 350ms delay and writes transactional change
records with persistent Undo. Complete recoverable states are materialized on
load, backup, recovery and sync; journal compaction runs after 10 seconds or
32 writes, and explicit Save compacts and checkpoints before reporting success.
Its compaction and recovery checkpoint share one independently captured exact
logical version in an atomic transaction, rather than materializing it twice.
Existing complete states migrate without discarding cells, visits or history.
Full-save fallback remains for unscoped changes. Compaction, full checkpoints
and inherently expensive calculations can still block; heavy-job workers and
chunked calculation/import/export are not part of these action optimizations.

The self-contained `dialog-audit.html` preserves Audit 1 and the pre-deletion
Audit 2 with all 50 dialogs. Current contains 47; the three unused N/A dialogs
remain viewable only in history.

## Use

- Date-formatted cells display `M/DD` (for example `9/29` or `10/02`).
  Dates before the current calendar year display `YY/MM/DD`, such as
  `25/09/29`. Stored date serials, formulas, text notes and original Excel
  export format codes are unchanged.
- Dialogs fit their contents and grow only as needed, up to 1000px or the
  available screen height. Dropdown lists and search results use that room
  before scrolling; short dialogs remain compact.
- **Ctrl/Cmd+T** creates a table from the selected rectangle. **My table has
  headers** uses the first row as headers; uncheck it to insert generated headers
  above all selected records, shifting cells below in those columns while keeping
  formula references attached. Unsafe shifts are refused without changing data.
  **Table manager** reuses the DD picker's searchable card layout and previews
  every workbook table with its sheet name and row/column counts. Click the sheet
  name to jump to that table's header. Double-click a table name (or focus it
  and press Enter) to rename it inline. With a single table cell selected, the
  toolbar button opens only that table's rename field. Renames retain table/field
  identities, formulas and DD links. **Delete table** requires confirmation and
  retains sheet cell contents; references to the deleted table show errors until
  restored with Undo.
  Sort tables by **Last activity** (cell edits, including formatting), **Frequently
  used** (visits when entering a table), **A-Z**, or **Z-A**. The sort choice and
  activity are saved with the workbook. Older tables have no inferred history;
  alphabetical order breaks ties until activity is recorded.
  Visits write a small, transactional IndexedDB sidecar, not the workbook-content
  autosave. Existing visit counts seed it without clearing history; concurrent
  tabs increment serially. Loads merge the counters, and real content saves,
  explicit Save/private sync, independent backups and recovery checkpoints
  include them in the existing workbook format. Pending visit journals are
  coalesced until incorporated into a full save. Explicit backup restore restores
  that backup's counters and archives the prior counters first.
  Navigation alone does not increment the content version, reset calculation
  caches or create undo entries. Content edits retain the existing autosave,
  conflict and undo checks. Each sheet remembers its selection and scroll
  position in this tab's session storage; switching sheets commits pending
  cell edits before leaving.
- Supporting dropdown-data sheets migrate into DD-owned storage, after an atomic
  full pre-migration recovery archive. They disappear from workbook tabs and the
  table manager, but their original table, field, row and sheet identities remain
  live for formulas and linked cells. Ordinary workbook tables (including
  Ingredients) stay in the workbook even when a DD reads their columns.
  Imports, restores and remote adoption normalize this ownership too.
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
  **Table selection** uses the compact lock/chevron split control in the grid
  corner. The lock toggles table bounds; the chevron chooses **Auto** or a named
  table, enabling table selection if necessary. Group controls occupy its former
  toolbar position and share the other toolbar icon-button styling.
  There are no Excel-style cell-edge targets or extra handles.
  Auto selects the matching table nearest the sticky column headers in the
  current viewport, including a table partially scrolled behind those headers.
  Row-header clicks use the same rule horizontally: the matching table nearest
  the visible row-number headers wins, including after horizontal scrolling.
  Visible matches take priority over offscreen tables. Equally near tables use
  the active cell's table if possible; otherwise a chooser resolves the tie.
  Rows/columns with no tables select the whole sheet axis without turning Auto
  off. The toolbar target picker can lock a particular table instead; a lock
  refuses headers outside that table. Shift extends within the same owner.
  On touch, use the cell-count menu's **Extend row/column selection on next header
  tap**. DD assignment stays in the chosen owner; assign different scopes
  separately. Discontiguous table fields never include the intervening cells.
  The selection owner and mode survive reload and returning from DD in the
  same browser tab.
  Summary/plain groups and **hypo** tags inherit the selected table or sheet
  scope; different table and sheet scopes can coexist on the same physical axes.
  Table-only group collapse compacts visible records and fields up/left within
  that table's existing slots. Neighboring tables and sheet coordinates stay fixed;
  editing, keyboard navigation and formulas retain the original cell identities.
  Expanding restores the original layout without moving stored data.
  Hypo hiding masks only owned cells. Insertion, deletion, duplication, movement,
  clipboard operations, fill, grouping and hiding stay within the selected table.
  Table record moves relocate owned cells and follow exact references, DD links
  and validations without moving neighboring tables. Field identities survive
  rearrangement; deleted references become explicit errors.
  Growth into occupied space asks before shifting the sheet below/right by the
  required number of rows/columns. When formulas are affected, the dialog audits
  their actual before/after results and shows their surrounding cells, flagging
  new errors and calculations requiring review. Otherwise it mentions only the
  shift. Optional finite skips apply to subsequent matching-risk shifts in this
  browser session, not newly risky shifts. Cancel makes no changes.
  Row heights and column widths are shared sheet geometry: turn table selection
  off to resize them. Partial cell shifts that would split table records remain
  explicitly refused. DD deletions retain linked-use/archive safeguards.
  Native backups preserve scope.
  XLSX export emits only sheet-wide Excel outlines; table-scoped groups remain
  in the embedded native archive, not misleading full-sheet Excel outlines.
  Arrow keys commit an in-cell or formula-bar edit and immediately navigate;
  rejected edits stay open. The expanded editor retains normal text navigation.
  Enter applies formula-bar edits. Ctrl/Cmd+Z, Y, F, S, A, C, X, V work.
  Undo retains up to 1,000 actions, including structural edits, with no separate
  three-snapshot limit. Undo/redo stacks autosave atomically with the workbook
  in this browser and survive reloads. Structural history stores changes rather
  than repeated full workbooks. A new edit clears redo. Import, restore and remote
  replacement start a fresh undo history; full pre-replacement recovery archives
  remain available. Undo stacks are browser-local, not synced or exported.
  Scrollable surfaces share thin scrollbars without arrow buttons; cell displays
  and in-cell editors remain scrollbar-free. Tables have solid right and bottom
  edges matching their header underline, following visible table
  identities through moves, hiding and virtual scrolling. Table headers stay
  below the sheet column headers while scrolling through that table, including
  virtualized rows, and disappear after its last visible row.
  Sheets retain at least four sheet rows below their last table and two sheet
  columns to the right, within the sheet size limits. These are editable sheet
  cells, not table records or fields. Existing space and contents are preserved;
  newly needed space is autosaved locally.
  Ctrl/Cmd+G creates a summary group; Ctrl/Cmd+Shift+G ungroups it.
  Select the summary row/column along with its details: the topmost row or
  leftmost column stays visible on collapse. Moving it moves its group together.
  Ctrl/Cmd+Alt+G creates a plain range group (all members hide);
  Ctrl/Cmd+Alt+Shift+G ungroups plain ranges.
  **Ungroup all plain groups (workbook)** in the group manager removes only plain
  groups on every sheet, preserving summaries, cells and a recovery checkpoint.
  Ctrl/Cmd+H toggles a hypothetical tag on selected entire rows/columns;
  Ctrl/Cmd+Shift+H removes it. Summary descendants inherit dynamically, so moving
  them out removes inherited tags while explicit tags remain. Explicit clearing
  overrides inheritance, including for a nested summary's descendants.
  Changing a summary tag highlights children with manual tags or explicit
  clears and asks whether to overwrite them with automatic inheritance or
  cancel. Overwriting removes child flags rather than
  stamping them, so future parent changes and move-out behavior remain dynamic.
  The confirmation uses one table with shared headers and complete row/column
  contents, including calculated values and multiline notes. Manually tagged
  rows/columns reuse their configured hypothetical treatment; manual exclusions
  stay untreated, without a separate status column.
  The dialog fits its contents, scrolling only when needed, so reviewing overrides
  does not depend on seeing the spreadsheet behind it.
  **Don't show again for … times** repeats **Overwrite** for the next specified
  number of manual-tag confirmations in the current session. Only successful
  overwrites consume the count; cancel does not activate it, and reload resets it.
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
  Shift-click selects a range of tools; Ctrl-click (Cmd-click on Mac) toggles
  individual tools. Drag any selected tool to move the selection together in
  toolbar order. Rearranging tools or editing dividers preserves the toolbar's
  current scroll position.
  **Toolbar styling rule:** every new toolbar button must reuse the shared
  `.icon-button` styling, including its responsive sizing and interaction states.
  Do not add per-button sizing or styling overrides.
  Dialog close controls use the shared 18px SVG close icon, not a text x or toggle.
  All dialogs reuse `.dialog-surface` and the shared `src/dialog.css` tokens for
  padding, corners and typography. H1 follows Find and Replace; H2 follows
  Dropdown settings. The default width is 600px, including DD/sheet settings;
  the 336px `.popover` variant uses an H2 title. The manual-tag overwrite
  comparison retains its 1,950px maximum. All share a 10px minimum page-edge gutter.
  The stamp-framed H toggles tags and reflects the selection's effective tags
  (including inherited and mixed states). The crossed-out, frame-free H toggles
  visibility of tagged rows and columns; they are visible by default. Hiding is
  view-only and respects explicit child exclusions without changing workbook
  contents or saved hidden/collapsed settings. The old status filter and Set status
  button have been removed without rewriting stored status metadata.

  The dashed-frame H **Hypothetical tag styling** toolbar button opens workbook-wide,
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
  Table-constrained summaries also show nested tree indentation, chevrons and
  connector rails inside their own table, including compacted rows/columns.
  Drop onto an expanded or collapsed table summary to join it and its parent
  groups; only the table's cells move, with neighboring data unchanged.
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
- **File > Import Meals and link matching Ingredients** adds the Excel Meals
  sheet without replacing other sheets. The previous Meals table keeps its
  identities under `Meals_PreImport`. Existing Ingredients and conversion tables
  supply the imported formulas; missing dependencies stop the import explicitly.
  The ingredient column uses the Ingredients DD. Literal names link
  case-insensitively to the first active exact match in physical Ingredients row
  order; unmatched text and formula inputs stay intact. All manual nutrition,
  notes, formatting and row/column layout are retained. The attached-original
  button uses the locally archived Excel package. Imports save a full recovery
  archive and disconnect sync.
- **File > Import Ingredients** merges a source Ingredients table into
  the existing table instead of replacing the workbook. Source records are added
  first; existing records, custom columns and other sheets are retained. Matching
  columns keep their identities, including the starter's `Ingredient` /
  `Ingredients` and `Calories per g` / `Calories2` equivalents.
  If Ingredients was deliberately deleted, import creates a new sheet/table;
  references to the deleted identities are not silently reconnected.
  Excel full-column validations apply throughout the imported data. Validated
  literal values link to existing active website DD records, not copied labels.
  Original-source provenance identifies DDs even after website renames. Exact
  matches in the declared DD take priority; otherwise a value must match exactly
  one active website DD record. Missing, archived or ambiguous matches stop the
  import without changing the workbook. DD sources can expand to include the
  additional matched website lists. Formulas remain formulas, and record labels
  with self/external validations are retained without circular or invented links.
  Legacy imports without website DDs retain referenced Dropdowns tables without
  overwriting same-named data.
  Missing dependencies remain explicit reference errors, never links to examples.
  A full pre-import recovery archive is downloadable from Recovery checkpoints.
  Imports disconnect sync and refuse repeat imports of an unchanged attached file,
  except when recreating deleted Ingredients; that reuses the archived original.
  The current tab is remembered across reloads in the same browser tab.
- **Tables** creates independent tables from selected rectangles, renames tables,
  configures/removes dropdowns, and edits scoped named formulas. Table headers
  are renamed as identities rather than overwritten as ordinary cell values.
  Freeform cells and multiple independent tables can coexist on one sheet.
  Typing directly below a table extends it using existing row IDs, calculated
  columns, formatting, and adjacent-row validation. A blank separating row, other
  table, or existing content in the target table area prevents auto-expansion.
  Moving sheet rows between existing table members also joins the destination
  table, including moved summary/detail blocks. Existing values, formulas, links,
  notes, formats, and explicit dropdown rules are preserved; empty calculated
  fields inherit matching table formulas. Conflicting table overlaps are rejected.
  Double-click a table column header to rename it, add/manage/remove its applied
  dropdowns, or edit column formulas. Matching-pattern edits retain other formula
  patterns and manual overrides, updating their saved restore calculations.
  Replacing all manual values requires explicitly choosing **All data rows**.
- **Assign DD** assigns a source to selected cells or a table's selected columns
  without changing their contents. The button highlights when the active cell has
  a dropdown assignment, even with a manual value; it reflects assignments, not
  whether the popup is open. Click an assigned cell or its dropdown arrow
  to search and choose options; Alt+Down opens it from the keyboard. Escape
  dismisses the list. After keyboard navigation, typing opens and filters the
  assigned list without replacing the existing value. A cell with a Custom
  value, or a remembered Custom column default, stays in direct text editing.
  **Manual**, F2 and the expanded editor remain
  available. Choices retain exact source identities, including duplicate labels
  and distinct blank/space options. Selecting a table-backed option links it
  automatically; there is no separate linking step. Manual text never silently
  relinks. Explicit text XLOOKUP formulas retain ordinary first-match semantics.
  Select multiple sources to combine their options without merging duplicate
  record identities. **Grid view** provides checkbox cards with at most four
  preview options per source; previews do not limit the actual dropdown.
  Assignment opens in Grid view by default. Grid/List fit the visible sources
  and shrink when filtering removes sources.
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
  the 800px-tall Find and Replace dialog (shrinking for shorter screens).
  Search controls fit their contents without an inner scrollbar; the results
  area grows or shrinks around them. **Text** combines finding and
  replacement; drafts survive tab switches. **All** selects every search sheet.
  **Rows/Columns** scans the workbook for sheet-only rows/columns inside table
  spans. Select results and **Convert to table** to join the indicated existing
  table, undoably and without replacing populated cells. This never repairs gaps
  automatically; table borders continue to expose actual membership.
  The **Convert to table** toolbar icon joins the selection to its surrounding
  existing table, not a new table. Selecting a summary includes all nested
  members, even when collapsed. Multiple possible tables require an explicit choice.
  Fields and buttons reuse the app's common dialog styles. Within and Direction
  use the spreadsheet's shared chevron and custom popup options instead of native
  browser menus. The focused Find input shares the dropdown's active field
  treatment: a single 1px border, with no offset outer focus ring. Copilot's shared Browser
  panel intercepts Ctrl/Cmd+F before forwarding it to the page; use the
  **Find / replace** toolbar button there. The shortcut works in a normal browser.
  Results show the matched address and up to eight surrounding cells in the same
  row, with the matched cell highlighted and one subheader per sheet. Source
  table field names appear once per preview window and remain sticky only while
  that table's results are in view; cell addresses are not repeated inside previews.
  Previews share the spreadsheet's `.spreadsheet-grid` cell and header styling,
  retaining strokes and the matched-cell highlight. Each table has a `Table: name`
  subheader below its sheet label; cell positions use the spreadsheet's row-header
  styling in a left-aligned 50px column. Columns containing matches are 160px wide;
  surrounding columns remain 110px. Only matching characters are semibold; the
  matched cell retains its fill without an extra outline. Empty results show no
  column headers.
  Rows/Columns previews also keep up to eight source values in individual cells,
  including blanks. Click a result or press Enter/Space on it to close Find and
  select its source row/column; checkboxes only select memberships for conversion.
  Both Find tabs position the target as the second visible row when a preceding
  row exists, accounting for hidden rows and individual row heights.
  Formula and linked-cell values are evaluated; long result sets
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
  Frozen columns retain their natural order and position while visible, then
  stick to the left or right edge as scrolling takes them out of view.

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
Returning to an unchanged published workbook checks only a small version file;
the complete workbook is downloaded and unpacked only for a new snapshot or an
explicit restore. Saved browser edits skip published-data replacement entirely.
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
Errors appear in a dismissible bottom-corner toast, at most 400px wide, without
moving the grid. Dismissing a toast never clears unsaved changes.
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