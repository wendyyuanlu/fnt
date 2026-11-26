const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/main-f_mdXflx.js","assets/icons-Cj-zyyB4.js"])))=>i.map(i=>d[i]);
import{_ as s}from"./preload-helper-DO0sjJph.js";const t=`<!doctype html>\r
<html lang="en">\r
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fnt - Visual comparison prototype</title><link rel="stylesheet" href="style.css"></head>\r
<body class="compact-controls" data-control-style="after" data-dropdown-style="dd" data-filter-design="tabs">\r
<header class="top"><h1>Compare versions</h1></header>\r
<main>\r
  <section class="sources" aria-label="Comparison sources">\r
    <div class="source" id="left-source-card" role="group" aria-label="Left comparison source"><span class="source-description"><b id="left-kind">Left copy</b><small id="left-source">Reading comparison source...</small></span><div class="source-actions"><button id="left-github" aria-label="Browse uploaded snapshots for left side">Browse uploads</button><label class="file-action icon-button" title="Attach a local JSON copy"><input id="left-file" aria-label="Choose local JSON for left side" type="file" accept=".json"></label></div></div>\r
    <span class="versus">vs</span>\r
    <div class="source" id="right-source-card" role="group" aria-label="Right comparison source"><span class="source-description"><b id="right-kind">GitHub</b><small id="right-source">Reading comparison source...</small></span><div class="source-actions"><button id="right-github" aria-label="Browse uploaded snapshots for right side">Browse uploads</button><label class="file-action icon-button" title="Attach a local JSON copy"><input id="right-file" aria-label="Choose local JSON for right side" type="file" accept=".json"></label></div></div>\r
  </section>\r
  <details class="source-details"><summary>Source details</summary>\r
    <p class="notice" aria-label="Left source details"><span id="left-detail-kind">Left</span><span id="left-source-freshness"></span></p>\r
    <p class="notice" aria-label="Right source details"><span id="right-detail-kind">Right</span><span id="right-source-freshness"></span><span id="right-source-fetched" hidden></span><span id="right-source-commit" hidden></span></p>\r
  </details>\r
  <dialog id="snapshot-picker" class="dialog-surface" aria-label="Uploaded comparison copies">\r
    <div class="dialog-heading"><h2 id="snapshot-title">Left copy · GitHub</h2><button id="snapshot-close" type="button" aria-label="Close uploaded copies" aria-keyshortcuts="Escape">Close</button></div>\r
    <p id="snapshot-target-note">Changes only the left comparison source. Attach opens a JSON file from this device; it does not upload it.</p>\r
    <p id="snapshot-auth-note">Read-only access to your existing private data repository. The token stays only in this tab's memory; nothing is uploaded, restored, or synced. This prototype cannot reuse another website's stored sign-in.</p>\r
    <form id="snapshot-connect"><div class="snapshot-config">\r
      <label>Owner<input id="snapshot-owner" required></label><label>Private repository<input id="snapshot-repo" required></label>\r
      <label>Branch<input id="snapshot-branch" required></label><label>Sync JSON path<input id="snapshot-path" required></label>\r
    </div><label>Existing restricted GitHub token<input id="snapshot-token" type="password" autocomplete="off" required></label><button id="snapshot-list">Read / refresh uploaded copies</button></form>\r
    <div class="snapshot-config snapshot-targets"><label class="snapshot-target" data-side="left">Left copy<select id="uploaded-left" disabled><option value="">Choose uploaded copy</option></select></label><label class="snapshot-target" data-side="right" hidden>Right copy<select id="uploaded-right" disabled><option value="">Choose uploaded copy</option></select></label></div>\r
    <p id="snapshot-status" role="status">Connect above to list uploaded snapshots. Local backup selection still works without signing in.</p>\r
  </dialog>\r
  <dialog id="choice-review" class="dialog-surface" aria-label="Review selection draft">\r
    <div class="dialog-heading"><div><p class="eyebrow">SELECTION DRAFT</p><h2>Review your choices</h2></div><button id="review-close" aria-label="Close selection review">Close</button></div>\r
    <p id="review-summary"></p>\r
    <p class="notice">Selection UI only, not a merged workbook. Structural dependencies have not been validated. Nothing here can save, upload, or replace a workbook.</p>\r
    <div id="review-groups"></div>\r
    <button id="next-unresolved">Go to next undecided change</button>\r
  </dialog>\r
  <p id="error" role="alert" hidden></p>\r
  <div class="workspace" id="workspace" aria-busy="true">\r
    <aside><div class="aside-heading">AFFECTED SHEETS</div><nav id="navigation" aria-label="Sheets and tables with differences"></nav></aside>\r
    <section class="comparison">\r
      <section class="bulk-panel" aria-label="Selection review and bulk choices">\r
        <span class="selection-progress" role="group" aria-label="Selection progress"><span class="selection-counts"><b id="selection-progress" role="status">No choices yet</b><span class="totals" id="totals" role="status">Reading saved cells...</span></span><span class="selection-actions"><button id="undo-choice" disabled>Undo choice</button><button id="reset-choices" disabled>Reset</button><button id="review-choices" class="primary">Review choices</button></span></span>\r
        <details class="bulk-disclosure">\r
        <summary><span class="bulk-summary-title">Bulk choices <span id="bulk-summary-target"></span></span></summary>\r
        <section class="bulk-choice" aria-label="Choose multiple changes">\r
          <div class="bulk-target"><label>Apply to<select id="choice-scope" aria-label="Selection scope" aria-describedby="choice-target-description"><option value="filtered">Matching change types in this table</option><option value="area">Changes listed in the current preview</option><option value="row">Selected row</option><option value="column">Selected column</option><option value="scope">Every difference in this table</option><option value="sheet">Every difference on this sheet</option><option value="settings">Toolbar and other workbook-wide settings</option><option value="workbook">Every difference in both copies</option></select></label><span id="choice-target-count"></span></div>\r
          <p id="choice-target-description"></p>\r
          <div id="bulk-buttons" class="pick-buttons" role="group" aria-label="Bulk source choice"></div>\r
          <details class="bulk-help"><summary>How bulk choices work</summary><p id="bulk-choice-note">Individual choices can override a bulk choice. Undo reverses the batch.</p><p>No workbook is changed. Reloading or changing sources clears this selection draft.</p></details>\r
        </section>\r
      </details>\r
      </section>\r
      <div class="scope-heading"><div><p class="eyebrow" id="sheet-name">COMPARING</p><h2 id="scope-name">Reading saved cells...</h2></div></div>\r
      <div class="filter-toolbar">\r
        <div class="categories" role="group" aria-label="Difference category"><button data-category="all" aria-pressed="true">All <span id="all-count" class="count">0</span></button><button data-category="value" aria-pressed="false"><i class="swatch amber"></i>Values & formulas <span id="value-count">0</span></button><button data-category="structure" aria-pressed="false"><i class="swatch violet"></i>Structure <span id="structure-count">0</span></button></div>\r
        <div class="type-filter"><label id="type-label"><select id="change-kind" aria-label="Specific change type"><option value="">All change types</option></select></label><label id="combined-type-label" hidden><select id="change-filter" aria-label="Change category and type" disabled><option data-filter-category="all" value="">All changes</option></select></label></div>\r
      </div>\r
      <div class="review-layout">\r
        <div class="review-main">\r
          <div class="region-toolbar"><div class="navigator"><button id="previous" class="icon-button" data-action="prev" aria-label="Previous changed area" disabled></button><button id="next" class="icon-button" data-action="next" aria-label="Next changed area" disabled></button><label class="region-label"><select id="region-picker" aria-label="Jump to changed area"></select></label></div></div>\r
          <section id="inspector" class="inspector" aria-label="Selected change details">\r
            <header><b id="detail-title">Select a highlighted cell</b><span id="detail-location"></span></header>\r
            <div class="individual-choice"><span id="individual-status">Undecided</span><label class="context keep-scope">Apply to<select id="keep-scope" aria-label="Inspector choice scope"><option value="difference">Single cell</option><option value="row">Selected row</option><option value="column">Selected column</option></select></label><div id="individual-buttons" class="pick-buttons" role="group" aria-label="Defer inspector choices"></div></div>\r
            <p id="change-explanation" class="notice" hidden></p>\r
            <div class="previews detail-pair" id="previews">\r
              <section class="pane left-pane"><header><b>Your backup</b><div id="keep-left" class="pick-buttons" role="group" aria-label="Keep left source"></div></header><pre id="detail-left" class="source-detail"></pre><div class="pane-range" id="left-range"></div><div class="grid-scroll" id="left-grid" tabindex="0" aria-label="Backup spreadsheet preview"></div></section>\r
              <section class="pane right-pane"><header><b>GitHub</b><div id="keep-right" class="pick-buttons" role="group" aria-label="Keep right source"></div></header><pre id="detail-right" class="source-detail"></pre><div class="pane-range" id="right-range"></div><div class="grid-scroll" id="right-grid" tabindex="0" aria-label="GitHub spreadsheet preview"></div></section>\r
            </div>\r
          </section>\r
          <p class="grid-hint"><span class="swatch amber"></span> Value / formula <span class="swatch violet"></span> Structure <span class="ghost-key">///</span> Not in this copy / table <span class="muted">Same stable row and column identities are aligned, even after moves.</span></p>\r
          <div class="view-options"><label class="context"><select id="context" aria-label="Surrounding context"><option value="1">Context: 1</option><option value="2" selected>Context: 2</option><option value="3">Context: 3</option></select></label><label class="linked first-cell-option"><input id="first-cell" type="checkbox" checked>First cell</label><label class="linked"><input id="linked" type="checkbox" checked>Linked scrolling</label></div>\r
        </div>\r
        <section class="decision-rail" aria-label="Comparison choices and change list">\r
          <div class="area-changes" role="group" aria-label="Changes in this area">\r
            <div id="change-list" class="change-list"></div>\r
          </div>\r
        </section>\r
      </div>\r
    </section>\r
  </div>\r
</main>\r
<script type="module" src="./main.ts"><\/script>\r
</body></html>\r
`,i=new DOMParser().parseFromString(t,"text/html").body;i.querySelectorAll("script").forEach(e=>e.remove());for(const e of i.attributes)document.body.setAttribute(e.name,e.value);document.body.dataset.production="true";document.body.replaceChildren(...i.childNodes);s(()=>import("./main-f_mdXflx.js"),__vite__mapDeps([0,1])).then(()=>{var e,a;(a=(e=navigator.serviceWorker)==null?void 0:e.controller)==null||a.postMessage({type:"fnt-shell-loaded",file:import.meta.url})}).catch(e=>{const a=document.querySelector("#error");a.hidden=!1,a.textContent=`Comparison could not be opened. Your workbook is unchanged. ${String(e)}`,document.body.dataset.loading="false"});
