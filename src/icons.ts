const boxyH='M7.5 7h3v3.5h3V7h3v10h-3v-3.5h-3V17h-3Z';
const stampFrame='M2 2h2.5a1.5 1.5 0 0 0 3 0h3a1.5 1.5 0 0 0 3 0h3a1.5 1.5 0 0 0 3 0H22v2.5a1.5 1.5 0 0 0 0 3v3a1.5 1.5 0 0 0 0 3v3a1.5 1.5 0 0 0 0 3V22h-2.5a1.5 1.5 0 0 0-3 0h-3a1.5 1.5 0 0 0-3 0h-3a1.5 1.5 0 0 0-3 0H2v-2.5a1.5 1.5 0 0 0 0-3v-3a1.5 1.5 0 0 0 0-3v-3a1.5 1.5 0 0 0 0-3Z';
export const toolbarIconPaths={
  undo:'M9 5l-5 5 5 5M4 10h9a7 7 0 0 1 7 7v2',
  redo:'M15 5l5 5-5 5M20 10h-9a7 7 0 0 0-7 7v2',
  close:'M6 6l12 12M18 6 6 18',
  add:'M12 4v16M4 12h16',
  references:'M7 16H3V4h5a6 6 0 0 1 4.472 2',
  settings:'M10 2h4l.7 3 2 .9 2.8-.9 2 3.5-2.1 2.1V13l2.1 2.1-2 3.5-2.8-.9-2 .9L14 22h-4l-.7-3-2-.9-2.8.9-2-3.5L4.6 13v-2.4L2.5 8.5l2-3.5 2.8.9 2-.9ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  'convert-table':'M3 2h18v9H3ZM3 6.5h18M9 2v9M3 19h18v4H3ZM9 19v4M12 17v-4m-3 3 3-3 3 3',
  tables:'M3 3h18v18H3ZM3 8h18M3 14h18M9 8v13M15 8v13',
  'dropdown-source':'M5 2h14q2 0 2 2v3q0 2-2 2H5q-2 0-2-2V4q0-2 2-2ZM6 14h12M6 19h12',
  'toolbar-layout':'M3 3h18v6H3ZM8 3v6M13 3v6M18 3v6M12 18l8-8 3 3-8 8-4 1 1-4ZM18 12l3 3',
  bold:'M7 5h5a3.5 3.5 0 0 1 0 7H7m5 0h1a3.5 3.5 0 0 1 0 7H7V5',
  italic:'M10 5h8M6 19h8M15 5l-6 14',
  underline:'M6 5v6a6 6 0 0 0 12 0V5M5 21h14',
  strikethrough:'M17 7c-1-1.5-3-2-5-2-3 0-5 1.5-5 3.5 0 5 10 2 10 7 0 2-2 3.5-5 3.5-2 0-4-.5-5-2M4 12h16',
  wrap:'M4 5h16M4 10h12a4 4 0 0 1 0 8h-4m2-2-2 2 2 2M4 15h3',
  find:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
  hypothetical:boxyH,
  'hypothetical-badge':'M4 4h5v6h6V4h5v16h-5v-6H9v6H4Z',
  'hypothetical-settings':boxyH,
  'hypothetical-visibility':'M4 4h5v6h6V4h5v16h-5v-6H9v6H4ZM3 21 21 3',
  copy:'M9 9h12v12H9ZM5 15H3V3h12v2',
  cut:'M8 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM8 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM8 8l12 12M8 16 20 4',
  paste:'M9 4H5v17h14V4h-4M9 2h6v4H9ZM8 11h8M8 15h6',
  fill:'M3 3h11v18H3ZM3 9h11M3 15h11M19 5v13m-3-3 3 3 3-3',
  structure:'M3 3h18v18H3ZM3 9h18M9 3v18M13 15h6M16 12v6',
  'summary-group':'M5 4h14q1 0 1 1v2q0 1-1 1H5q-1 0-1-1V5q0-1 1-1ZM6 8v12h3m-3-6h3m3 0h8m-8 6h8',
  'plain-group':'M6 5H3v14h3m-3-7h3M8 3h13v4H8ZM8 10h13v4H8ZM8 17h13v4H8Z',
  pin:'M8 3h8M9 3v6l-3 4v2h12v-2l-3-4V3M12 15v7',
  browse:'M3 4h9M3 9h7M3 14h6M3 19h9M20 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1 3 3 4',
  'text-color':'M6 17l6-13 6 13M8 13h8',
  'background-color':'M5 3l10 10M9 5l7 7-6 6-7-7 6-6ZM4 12h12M20 12s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4'
};
export function toolbarIcon(name:keyof typeof toolbarIconPaths,color?:string):string{
  const safeColor=color?.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  return `<svg class="toolbar-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${name==='hypothetical'?`<path class="stamp-frame" vector-effect="non-scaling-stroke" d="${stampFrame}" fill="var(--stamp-fill,none)" stroke="var(--stamp-frame-color,currentColor)"/>`:''}<path vector-effect="non-scaling-stroke" d="${toolbarIconPaths[name]}"/>${name==='references'?'<path vector-effect="non-scaling-stroke" d="M9 8h5a6 6 0 0 1 0 12H9Z"/>':''}${name==='dropdown-source'?'<path vector-effect="non-scaling-stroke" d="M15 4h4l-2 2Z" fill="currentColor"/>':''}${name==='hypothetical-settings'?'<rect vector-effect="non-scaling-stroke" x="3" y="3" width="18" height="18" rx="1.5" stroke-dasharray="2 2"/>':''}${safeColor?`<path vector-effect="non-scaling-stroke" d="M4 22h16" stroke="${safeColor}"/>`:''}</svg>`;
}
