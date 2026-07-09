import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { useCreateBlockNote, SuggestionMenuController, GridSuggestionMenuController,
  createReactBlockSpec, getDefaultReactSlashMenuItems,
  FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems,
  useBlockNoteEditor, useSelectedBlocks } from '@blocknote/react';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems,
  getDefaultEmojiPickerItems } from '@blocknote/core';
import { offset, flip, shift, size } from '@floating-ui/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { parseVideoUrl } from './parseVideoUrl.js';
import './app.css';

// Markdown paste goes through a real parser, not BlockNote's own (which is "minimal
// + lossy" and has open bugs that drop lists, code and checklists). markdown-it →
// HTML → tryParseHTMLToBlocks, because BlockNote's HTML interop is broad (HTML is its
// internal format). See blocknotejs.org/docs/features/import/markdown.
const mdParser = new MarkdownIt({ html: false, linkify: true, breaks: false }).use(taskLists);

// Curated fast emoji palette for the ":" picker. BlockNote's default emoji picker
// builds a search index over ~1484 emojis on first use (one-time CPU stall) and the
// grid renders heavily — slow to open + janky in WebView2. So we show this small set
// instantly on ":" (no index build, ~90 nodes); only when the user TYPES a query do we
// fall back to getDefaultEmojiPickerItems (full local search, index built then, once).
// Data is bundled locally (no network). Set matches the approved mockup, grouped order.
const CURATED_EMOJIS = [
  // faces
  '😀','😃','😄','😁','😅','😂','🙂','😉','😊','😍','😘','😎','🤔','😐','😴','😢','😭','😮','😱','😡','🤯','🥳','🤩','🥺',
  // hands
  '👍','👎','👌','✌️','🤝','👏','🙌','🙏','💪','👆','👇','👉','👈','✋','🤚',
  // hearts / emotion
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💖','✨',
  // marks / status
  '✅','❌','✔️','⭐','🔥','⚡','❗','❓','⚠️','💡','🎯','📌','📍','🔔','🚩',
  // arrows
  '⬆️','⬇️','⬅️','➡️','↗️','↘️','🔁','🔄',
  // work / objects
  '📝','📅','📆','✏️','📎','📁','📂','📊','📈','💻','📱','🕐','🎉','🎁','☕','🍕',
];

// Does this plain text carry Markdown syntax? Any single marker is enough — in a notes
// editor a pasted "- item" or "# title" almost always means Markdown.
const MD_HINTS = [
  /^\s{0,3}#{1,6}\s+\S/m,            // heading
  /^\s*[-*+]\s+\S/m,                 // bullet list
  /^\s*\d+[.)]\s+\S/m,               // numbered list
  /^\s*>\s+\S/m,                     // blockquote
  /^\s*(```|~~~)/m,                  // fenced code block
  /^\s*\|.*\|\s*$/m,                 // table row
  /^\s*([-*_]\s?){3,}\s*$/m,         // thematic break
  /\[[^\]]+\]\([^)]+\)/,             // link
  /(\*\*|__)\S[\s\S]*?\1/,           // bold
];
const looksLikeMarkdown = (t) => !!t && MD_HINTS.some((re) => re.test(t));

// A fenced code block in Markdown ends with a newline, which markdown-it keeps and
// BlockNote turns into an extra empty line at the bottom of the code block. Strip exactly
// ONE trailing newline (the closing-fence artifact) — not all of them, so an intentional
// blank line the user put inside the code survives.
function trimCodeBlocks(blocks) {
  for (const b of blocks || []) {
    if (b.type === 'codeBlock' && Array.isArray(b.content)) {
      for (const c of b.content) {
        if (c.type === 'text' && typeof c.text === 'string') c.text = c.text.replace(/\n$/, '');
      }
    }
    if (b.children) trimCodeBlocks(b.children);
  }
  return blocks;
}

// Blank-line fidelity on paste. markdown-it treats blank lines as mere separators and drops
// them, so a quote/paragraph pasted with breathing room loses it. Rule: a blank line
// ALWAYS stays a blank line — INSIDE its block when it is marked (a ">" quote line, a code
// fence), OUTSIDE as an empty paragraph when it is a plain blank line. The cue is simple: a
// ">" line is NOT blank (it carries the ">"), a truly empty line IS — so segmenting by blank
// lines separates "inside the quote" from "around the quote" for free.
const FENCE_RE = /^\s{0,3}(```+|~~~+)/;
const BLANK_RE = /^[ \t]*$/;
const QUOTE_LINE_RE = /^\s{0,3}>/;
// Block-level Markdown a single quote line could carry (heading/list/fence/table). If a quote
// holds these we fall back to the full markdown-it render instead of the simple line builder.
const BLOCK_LV_RE = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|`{3,}|~{3,}|\|)/;
// Zero-width space, built at runtime (a literal U+200B in the source gets eaten by tooling —
// the shell and esbuild both stripped it). Used to give an empty quote line real height.
const ZWSP = String.fromCharCode(0x200B);

// Split Markdown into top-level units: { kind:'blank', n } runs and { kind:'md', lines } blocks.
// Code fences are never split (their inner blank lines belong to the code). A single trailing
// newline (the clipboard line terminator) is dropped so it doesn't add a phantom empty block.
function segmentMarkdown(text) {
  const norm = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const lines = norm.split('\n');
  if (norm.endsWith('\n')) lines.pop();   // terminator's empty tail, not a real blank line
  const units = [];
  let buf = [];
  let bufMode = null;                      // 'quote' | 'plain' — a quote run is its own segment
  let inFence = false, fch = '';
  const flush = () => { if (buf.length) { units.push({ kind: 'md', lines: buf }); buf = []; bufMode = null; } };
  for (const line of lines) {
    const fm = line.match(FENCE_RE);
    if (inFence) {
      buf.push(line);
      if (fm && fm[1][0] === fch) { inFence = false; fch = ''; }
      continue;
    }
    if (fm) {                              // fence opens — plain content; a preceding quote run ends here
      if (bufMode === 'quote') flush();
      bufMode = 'plain'; buf.push(line); inFence = true; fch = fm[1][0]; continue;
    }
    if (BLANK_RE.test(line)) {
      flush();
      const last = units[units.length - 1];
      if (last && last.kind === 'blank') last.n++; else units.push({ kind: 'blank', n: 1 });
      continue;
    }
    // A ">" line and a plain line never share a segment — even without a blank line between
    // them — so a quote stays a clean quote (no Markdown "lazy continuation" pulling the next
    // line in), and the line after a quote starts its own block.
    const mode = QUOTE_LINE_RE.test(line) ? 'quote' : 'plain';
    if (buf.length && bufMode !== mode) flush();
    bufMode = mode; buf.push(line);
  }
  flush();
  return units;
}

// Build blocks from Markdown while KEEPING blank lines. Plain blank run → that many empty
// paragraph blocks. A pure "> " quote (every non-empty line starts with ">", no nested
// block-level markdown) → one quote block whose empty ">" lines become "\n" hard breaks in
// its inline content (BlockNote turns inline "\n" into a hardBreak), so the blanks sit INSIDE
// the quote frame. Anything else → the normal markdown-it render (+ trimCodeBlocks/table aligns).
async function mdToBlocksPreservingBlanks(editor, text) {
  const units = segmentMarkdown(text);
  const out = [];
  for (const u of units) {
    if (u.kind === 'blank') {
      for (let i = 0; i < u.n; i++) out.push({ type: 'paragraph', content: [] });
      continue;
    }
    const nonEmpty = u.lines.filter((l) => !BLANK_RE.test(l));
    const allQuote = nonEmpty.length > 0 && nonEmpty.every((l) => QUOTE_LINE_RE.test(l));
    const inner = u.lines.map((l) => l.replace(/^\s{0,3}>\s?/, ''));
    const innerSimple = inner.every((l) => BLANK_RE.test(l) || !BLOCK_LV_RE.test(l));
    if (allQuote && innerSimple) {
      const content = [];
      for (let i = 0; i < inner.length; i++) {
        if (i > 0) content.push({ type: 'text', text: '\n', styles: {} });   // line break between quote lines
        const line = inner[i];
        // An empty quote line: a bare "\n" hard break renders no height at the END of a block
        // (browser quirk), so the bottom blank would vanish. A zero-width space gives the line
        // real height — it shows as an empty line WITH the quote bar, top, middle or bottom.
        if (BLANK_RE.test(line)) { content.push({ type: 'text', text: ZWSP, styles: {} }); continue; }
        let lc = null;
        try {
          const b = await editor.tryParseHTMLToBlocks('<p>' + mdParser.renderInline(line) + '</p>');
          if (b && b[0] && Array.isArray(b[0].content)) lc = b[0].content;
        } catch (e) {}
        if (lc && lc.length) content.push(...lc);
        else content.push({ type: 'text', text: line, styles: {} });
      }
      out.push({ type: 'quote', props: {}, content });
      continue;
    }
    const seg = u.lines.join('\n');
    let blocks = trimCodeBlocks(await editor.tryParseHTMLToBlocks(mdParser.render(seg)));
    blocks = applyTableAligns(blocks, markdownTableAligns(seg));
    out.push(...blocks);
  }
  return out;
}

// Our own full-fidelity copy format: a pasted BlockNote block-JSON array carries cell
// colours, alignment, merged cells and column widths — none of which Markdown can
// express. Recognised as a JSON array whose every item is an object with a string
// `type`, so ordinary JSON data the user might paste as text isn't hijacked.
function tryParseBlockJson(text) {
  const t = (text || '').trim();
  if (t.length < 2 || t[0] !== '[' || t[t.length - 1] !== ']') return null;
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v) && v.length && v.every((b) => b && typeof b === 'object' && typeof b.type === 'string')) return v;
  } catch (e) {}
  return null;
}

// markdown-it renders table-column alignment as a `text-align` CSS style, which
// BlockNote's HTML table parser ignores — so alignment is lost on paste. We read it
// straight from the Markdown delimiter rows (|:---|:--:|---:|) and re-apply it to each
// table block's cells, by column, in document order.
const ALIGN_ROW_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
function segAlign(seg) {
  const s = seg.trim();
  const l = s.startsWith(':'), r = s.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  if (l) return 'left';
  return null;                       // plain --- → no explicit alignment
}
// One alignment array (per column) for each Markdown table, in source order.
function markdownTableAligns(md) {
  const out = [];
  for (const line of String(md || '').split('\n')) {
    if (line.indexOf('|') === -1 || line.indexOf('-') === -1) continue;
    if (!ALIGN_ROW_RE.test(line)) continue;
    out.push(line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(segAlign));
  }
  return out;
}
function setCellAlign(cell, a) {
  if (cell && cell.type === 'tableCell' && cell.props) { cell.props.textAlignment = a; return cell; }
  const content = Array.isArray(cell) ? cell : (cell && cell.content) || [];   // simple inline-array form
  return { type: 'tableCell', props: { backgroundColor: 'default', textColor: 'default', textAlignment: a, colspan: 1, rowspan: 1 }, content };
}
function applyTableAligns(blocks, aligns) {
  let ti = 0;
  const walk = (arr) => {
    for (const b of arr || []) {
      if (b.type === 'table' && b.content && Array.isArray(b.content.rows)) {
        const cols = aligns[ti++];
        if (cols) for (const row of b.content.rows) {
          let ci = 0;
          (row.cells || []).forEach((cell, idx) => {
            const a = cols[ci];
            if (a) row.cells[idx] = setCellAlign(cell, a);
            ci += (cell && cell.props && cell.props.colspan) || 1;
          });
        }
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return blocks;
}

// Insert blocks at the text cursor; if the cursor sits on an empty block, drop it so the
// pasted content doesn't leave a blank line above it.
function insertBlocksAtCursor(editor, blocks) {
  const ref = editor.getTextCursorPosition().block;
  const empty = !(ref?.content?.length);
  editor.insertBlocks(blocks, ref, 'after');
  if (empty) editor.removeBlocks([ref]);
}

const isMediaBlock = (b) => b && (b.type === 'image' || b.type === 'file' || b.type === 'video' || b.type === 'audio' || b.type === 'videoEmbed' || b.type === 'imageEmbed' || b.type === 'audioEmbed' || b.type === 'fileEmbed');
// Uploaded media is matched by its Todoist file_url, NOT its block type, so the page↔Files link
// works the same whether the inline block is a native image, our videoEmbed, or a file block.
// An UPLOADED video is a videoEmbed whose url is the /api/attachment proxy → rawFileUrl returns
// its file_url, so it participates in the link. An ONLINE link (youtube/…) → rawFileUrl null → excluded.
const MAX_UPLOAD = 5 * 1024 * 1024;   // Todoist Free attachment cap (server enforces it too)

// Bridge set by NotesApp so a video block's own "Replace" can reuse the Files-strip replace flow
// (file picker → upload → swap inline + attachment). Keyed by the raw Todoist file_url.
const nbBridge = { replaceInlineByUrl: null };

// Insert a single block at the text cursor, falling back to the end of the document when
// the editor has no live cursor (e.g. the paperclip ran while focus was elsewhere).
function insertBlockAtCursorOrEnd(editor, block) {
  try {
    const ref = editor.getTextCursorPosition().block;
    if (ref) {
      const empty = !(ref.content && ref.content.length);
      editor.insertBlocks([block], ref, 'after');
      if (empty) editor.removeBlocks([ref]);
      return;
    }
  } catch (e) {}
  try {
    const doc = editor.document || [];
    if (doc.length) editor.insertBlocks([block], doc[doc.length - 1], 'after');
    else editor.replaceBlocks(editor.document, [block, { type: 'paragraph' }]);
  } catch (e) {}
}

// An uploaded image lives in two places at once: inline in the body AND as an attachment
// (a Todoist comment shown in the Files strip). The shared key linking the two is the raw
// Todoist file_url — inline images wrap it in our /api/attachment proxy, so decode it back.
// External URL images (no upload, no comment) return null and are left untouched.
function rawFileUrl(url) {
  const m = String(url || '').match(/\/api\/attachment\?u=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
  return null;
}
function imageFileUrls(blocks) {
  const set = new Set();
  const walk = (arr) => (arr || []).forEach((b) => {
    if (b && b.props) { const u = rawFileUrl(b.props.url); if (u) set.add(u); }
    if (b && Array.isArray(b.children)) walk(b.children);
  });
  walk(blocks);
  return set;
}
// External (non-uploaded) image URLs in a document: http(s) images that aren't our own
// /api/attachment proxy. Used to spot which images a paste just added from the web.
function externalImageUrls(blocks) {
  const set = new Set();
  const walk = (arr) => (arr || []).forEach((b) => {
    if (b && (b.type === 'image' || b.type === 'imageEmbed') && b.props) { const u = b.props.url || ''; if (/^https?:\/\//i.test(u) && u.indexOf('/api/attachment') !== 0) set.add(u); }
    if (b && Array.isArray(b.children)) walk(b.children);
  });
  walk(blocks);
  return set;
}
// After a paste, any NEW external-URL image (one not present before the paste) is a web image
// pasted as a link. Fetch + upload it to Todoist and swap the block to our proxy URL + add the
// attachment, so it becomes a real file (page + Files). On failure the external URL is left as
// is. Images already present before the paste (deliberate embeds) are never touched.
async function upgradePastedImages(editor, before, noteId) {
  if (!window.NB || !window.NB.uploadFromUrl) return;
  const targets = [];
  const walk = (arr) => (arr || []).forEach((b) => {
    if (b && (b.type === 'image' || b.type === 'imageEmbed') && b.props) {
      const u = b.props.url || '';
      if (/^https?:\/\//i.test(u) && u.indexOf('/api/attachment') !== 0 && !before.has(u)) targets.push(b);
    }
    if (b && Array.isArray(b.children)) walk(b.children);
  });
  walk(editor.document || []);
  for (const b of targets) {
    try {
      const d = await window.NB.uploadFromUrl(b.props.url);
      if (d && d.file_url) {
        window.NB.addComment(noteId, '', d).catch(() => {});
        // Land in our imageEmbed block (upgradeNativeMedia may already have converted it).
        editor.updateBlock(b, { type: 'imageEmbed', props: { ...(b.type === 'imageEmbed' ? b.props : {}), url: '/api/attachment?u=' + encodeURIComponent(d.file_url) } });
      }
    } catch (err) { /* upload failed → leave the external URL in place */ }
  }
}
// On open, the live diff can't catch an attachment that was deleted while the app was closed
// (it never saw it disappear). So check each inline Todoist image's file directly: any whose
// file is gone is replaced with an empty "add image" block. Background, non-blocking; checks
// the file (not the comment), so a freshly uploaded image is never wrongly dropped.
async function sweepDeadImages(editor) {
  if (!window.NB || !window.NB.fileAlive) return;
  const urls = [...imageFileUrls(editor.document)];
  if (!urls.length) return;
  const dead = [];
  for (const u of urls) { try { if (!(await window.NB.fileAlive(u))) dead.push(u); } catch (e) {} }
  if (!dead.length) return;
  const hits = [];
  const walk = (arr) => (arr || []).forEach((b) => { if (b.props && dead.includes(rawFileUrl(b.props.url))) hits.push(b); if (b.children) walk(b.children); });
  walk(editor.document || []);
  // Dead media → BlockNote's native empty "add image" placeholder (re-uploading converts it back).
  hits.forEach((b) => { try { editor.updateBlock(b, { type: 'image', props: { url: '', name: '' } }); } catch (e) {} });
}

// Every image and video lives in our own block (`imageEmbed` / `videoEmbed`), so all media share
// ONE menu/resize/behaviour. BlockNote's native `image`/`video` blocks are used ONLY as the
// transient upload placeholder (their nice Upload UI + 5 MB hint); the moment one gets a url we
// convert it (provider link → iframe, uploaded proxy / direct file → <video>; image → <img>).
// previewWidth, caption and alignment carry over. Empty placeholders (no url) are left alone so
// the upload UI keeps working.
const NATIVE_MEDIA = { image: 'imageEmbed', video: 'videoEmbed', audio: 'audioEmbed', file: 'fileEmbed' };
function upgradeNativeMedia(editor) {
  const targets = [];
  const walk = (arr) => (arr || []).forEach((b) => {
    if (b && NATIVE_MEDIA[b.type] && b.props && (b.props.url || '').trim()) targets.push(b);
    if (b && Array.isArray(b.children)) walk(b.children);
  });
  walk(editor.document || []);
  targets.forEach((b) => {
    try {
      editor.replaceBlocks([b], [{ type: NATIVE_MEDIA[b.type], props: {
        url: b.props.url,
        width: b.props.previewWidth || 0,
        caption: b.props.caption || '',
        textAlignment: b.props.textAlignment || 'left',
        name: b.props.name || '',
      } }]);
    } catch (e) {}
  });
}

// For Markdown export only: BlockNote's serializer doesn't know our custom blocks, so map them back
// to native first — imageEmbed → image (so it becomes ![](url)); videoEmbed → its url on a line.
// HTML export needs none of this (it clones the live rendered DOM).
function mediaToNativeBlocks(blocks) {
  return (blocks || []).map((b) => {
    const children = b.children ? mediaToNativeBlocks(b.children) : b.children;
    if (b.type === 'imageEmbed') return { ...b, type: 'image', props: { url: b.props.url || '', caption: b.props.caption || '', name: '', previewWidth: b.props.width || undefined }, children };
    if (b.type === 'audioEmbed') return { ...b, type: 'audio', props: { url: b.props.url || '', caption: b.props.caption || '', name: b.props.name || '' }, children };
    if (b.type === 'fileEmbed') return { ...b, type: 'file', props: { url: b.props.url || '', caption: b.props.caption || '', name: b.props.name || '' }, children };
    if (b.type === 'videoEmbed') return { ...b, type: 'paragraph', props: {}, content: [{ type: 'text', text: b.props.url || '', styles: {} }], children };
    return { ...b, children };
  });
}

// On open, replaceBlocks leaves the cursor on the last block; if a media block is
// first/last/only, it opens node-selected and BlockNote pops its "replace file"
// toolbar. Park a plain TEXT cursor in the first non-media block instead (a text
// cursor can't node-select an image), then blur so nothing looks active.
function parkCursor(editor) {
  try {
    const doc = editor.document || [];
    const target = doc.find((b) => !isMediaBlock(b)) || doc[0];
    if (target) editor.setTextCursorPosition(target, 'start');
    const view = editor.prosemirrorView || (editor._tiptapEditor && editor._tiptapEditor.view);
    if (view && view.dom && view.dom.blur) view.dom.blur();
  } catch (e) {}
}

// True when nothing is selected (a plain collapsed cursor). False for any real selection —
// a text range OR a node-selected media/block. Drives the "Clear" button's two modes.
function selEmpty(editor) {
  try {
    const view = editor.prosemirrorView || (editor._tiptapEditor && editor._tiptapEditor.view);
    return !view || view.state.selection.empty;
  } catch (e) { return true; }
}

// i18n alias — window.I18N is read live (re-render happens on language switch)
const tr = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);

// Pin/Archive: our own feature on top of Todoist. The host bridge (window.NB) owns the
// pinned/archived flags (matched by emoji prefix) and the section name. Here we only need
// the localized pinned name for the optimistic update when dragging a note onto the Pin group.
const pinnedSectionName = () => (window.I18N ? window.I18N.t('nb.group_pinned') : '📌 Pinned');
const PRIO_COLOR = { P1: '#e35454', P2: '#e3a008', P3: '#4a9eff', P4: 'transparent' };
const PRIO_LIST = [
  { id: 'P1', color: '#e35454' },
  { id: 'P2', color: '#e3a008' },
  { id: 'P3', color: '#4a9eff' },
  { id: 'P4', color: '#777' },
];
const prioName = (id) => tr('nb.prio_' + String(id).toLowerCase());
// section title colours (cosmetic, stored locally — not synced to Todoist)
const SEC_COLORS = ['#e35454', '#e3a008', '#4caf50', '#4a9eff', '#a970ff'];

// The body is stored as a BlockNote JSON document (full fidelity). For the sidebar
// preview we extract plain text from it; legacy notes still stored as markdown fall
// back to stripping markdown syntax.
function blocksText(blocks) {
  const out = [];
  const walk = (arr) => (arr || []).forEach((b) => {
    if (Array.isArray(b.content)) b.content.forEach((ic) => { if (ic && typeof ic.text === 'string') out.push(ic.text); });
    if ((b.type === 'file' || b.type === 'image') && b.props && b.props.name) out.push(b.props.name);
    if (Array.isArray(b.children)) walk(b.children);
  });
  walk(blocks);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
function bodyToText(body) {
  const s = String(body || '').trim();
  if (s.startsWith('[')) {
    try { const b = JSON.parse(s); if (Array.isArray(b)) return blocksText(b); } catch (e) {}
  }
  return s.replace(/[#*~`>\-\[\]\(\)|]/g, ' ').replace(/\s+/g, ' ').trim();
}
function preview(body) { return bodyToText(body).slice(0, 200); }   // CSS clamps to 3 lines

// ───────── icons (lucide, Todoister style) ─────────
function Icon({ name }) {
  const p = {
    flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></>,
    video: <><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></>,
    audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    archive: <><rect x="2" y="4" width="20" height="5" rx="1" /><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" /><line x1="10" y1="13" x2="14" y2="13" /></>,
    tag: <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    pin: <><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>,
    bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
    undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" /></>,
    redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13" /></>,
    arrowUp: <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
    arrowDown: <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    folder: <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />,
    check: <path d="M20 6 9 17l-5-5" />,
    loader: <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    paperclip: <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
    move: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    printer: <><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>,
    clipboard: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>,
    alignLeft: <><line x1="21" y1="6" x2="3" y2="6" /><line x1="15" y1="12" x2="3" y2="12" /><line x1="17" y1="18" x2="3" y2="18" /></>,
    alignCenter: <><line x1="21" y1="6" x2="3" y2="6" /><line x1="17" y1="12" x2="7" y2="12" /><line x1="19" y1="18" x2="5" y2="18" /></>,
    alignRight: <><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="12" x2="9" y2="12" /><line x1="21" y1="18" x2="7" y2="18" /></>,
    caption: <><rect width="18" height="14" x="3" y="5" rx="2" ry="2" /><path d="M7 15h4M15 15h2M7 11h2M13 11h4" /></>,
    replace: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" /></>,
    eraser: <><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      {p[name]}
    </svg>
  );
}
function isoOffset(off) {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return d.toISOString().slice(0, 10);
}

// ───────── attachment url rewrite (storage ⇄ display) ─────────
// Files live in Todoist comments; the note body only references them by their raw
// Todoist file_url ("code address"). Todoist file URLs need Bearer auth, so for
// display we wrap them in our /api/attachment proxy; for storage we unwrap back to
// the raw URL so the body stays portable (the old code stored the proxy link, which
// broke on other devices).
const ATT_HOSTS = ['files.todoist.com', 'image-resize.todoist.com'];
const isTodoistFileUrl = (u) => ATT_HOSTS.some((h) => u.indexOf('//' + h + '/') !== -1);
function toDisplayMd(md) {
  if (!md) return md;
  return md.replace(/(\]\()([^)\s]+)(\))/g, (m, a, url, c) => {
    if (url.indexOf('/api/attachment') === 0) return m;            // already proxied
    if (isTodoistFileUrl(url)) return a + '/api/attachment?u=' + encodeURIComponent(url) + c;
    return m;
  });
}
function toStorageMd(md) {
  if (!md) return md;
  return md.replace(/\/api\/attachment\?u=([^)\s]+)/g, (m, enc) => {
    try { return decodeURIComponent(enc); } catch (e) { return m; }
  });
}
const attProxy = (u) => '/api/attachment?u=' + encodeURIComponent(u);
const attIsImage = (a) => !!(a && (a.image || (a.file_type && a.file_type.startsWith('image/'))));
// Which custom media block an uploaded attachment becomes, from its MIME type.
function embedTypeForAtt(att) {
  const t = (att && att.file_type) || '';
  if (t.startsWith('image/') || (att && att.image)) return 'imageEmbed';
  if (t.startsWith('video/')) return 'videoEmbed';
  if (t.startsWith('audio/')) return 'audioEmbed';
  return 'fileEmbed';
}
function filenameFromProxy(href) {
  try {
    const m = href.match(/[?&]u=([^&]+)/);
    if (m) { const raw = decodeURIComponent(m[1]); return raw.split('/').pop().split('?')[0] || 'file'; }
  } catch (e) {}
  return 'file';
}
// Markdown is lossy: a BlockNote file block round-trips as a plain "[name](url)" link,
// so on load every standalone attachment link is turned back into a proper file block
// (images already parse as image blocks from "![](url)"). Keeps the nice file widget.
function reconstructAttachments(blocks) {
  return blocks.map((b) => {
    if (b.type === 'paragraph' && Array.isArray(b.content) && b.content.length === 1) {
      const ic = b.content[0];
      if (ic && ic.type === 'link' && typeof ic.href === 'string' && ic.href.indexOf('/api/attachment') === 0) {
        const txt = (ic.content && ic.content[0] && ic.content[0].text) || filenameFromProxy(ic.href);
        return { type: 'file', props: { name: txt, url: ic.href } };
      }
    }
    return b;
  });
}

// ───────── export helpers ─────────
function safeName(s) { return ((s || 'note').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80)) || 'note'; }
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
function strToB64(str) { return btoa(unescape(encodeURIComponent(str))); }   // UTF-8 safe
// Make an export portable: fetch each proxied Todoist attachment and inline it as a
// base64 data URI so it shows outside the app (the file lives behind Bearer auth).
async function embedAttachments(text, imagesOnly) {
  const urls = [...new Set((text.match(/\/api\/attachment\?u=[^)"'\s<>]+/g) || []))];
  for (const u of urls) {
    try {
      const res = await fetch(u);
      const blob = await res.blob();
      if (imagesOnly && !(blob.type || '').startsWith('image/')) continue;
      const data = await blobToDataURL(blob);
      text = text.split(u).join(data);
    } catch (e) {}
  }
  return text;
}

// The "/" menu floats against the editor's scroll area, not the window, so a menu that
// flips above a near-bottom cursor stops at the top toolbar instead of the window edge.
const slashBoundary = () => document.querySelector('.nb-editor-area') || undefined;

// ───────── custom media blocks (image + video) ─────────
// All images/videos render through our own blocks so they share one menu/resize. upgradeNativeMedia()
// converts BlockNote's native image/video blocks into these once they have a url. The video link →
// embed parser lives in ./parseVideoUrl.js (unit-tested): 'iframe' for providers, 'video' for a
// direct/proxy file URL. Images render the url directly as <img>.

// A PDF attachment renders as an inline viewer (WebView2's built-in PDF view), not a file chip,
// so the note shows the document itself. Detected by the .pdf extension on the name or the url —
// the /api/attachment proxy keeps the original filename inside its ?u= param, so a plain includes
// catches the proxied case too.
const isPdfLike = (url, name) => {
  if ((name || '').toLowerCase().endsWith('.pdf')) return true;
  const u = (url || '').toLowerCase();
  return u.split('?')[0].endsWith('.pdf') || u.includes('.pdf');
};

// One shared view for our two custom media blocks — `videoEmbed` and `imageEmbed`. Both get the
// SAME ⋯ icon menu (align · caption · replace · delete, NO download), side-drag resize and
// click-away, so an uploaded image, an uploaded video and an online video all behave identically.
// videoEmbed renders an <iframe> (provider) or <video> (file/proxy); imageEmbed renders an <img>.
function MediaView({ block, editor }) {
  const kind = block.type === 'imageEmbed' ? 'image'
    : block.type === 'audioEmbed' ? 'audio'
    : block.type === 'fileEmbed' ? 'file' : 'video';
  const isImage = kind === 'image';
  const isVideo = kind === 'video';
  const url = block.props.url || '';
  const name = block.props.name || '';
  const isPdf = kind === 'file' && isPdfLike(url, name);    // a PDF file renders as an inline viewer, not a chip
  const resizable = isImage || isVideo || isPdf;            // audio bar / non-pdf file chip don't resize
  const width = block.props.width || 0;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [barPos, setBarPos] = useState(null);   // fixed {top,left} of the open bar, clamped on-screen
  const wrapRef = useRef(null);
  const lastW = useRef(0);

  // Click anywhere outside closes the action bar (and drops the selection feel). The bar only
  // ever opens from the ⋯ icon — never from clicking the media itself.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDocDown, true);
    return () => document.removeEventListener('mousedown', onDocDown, true);
  }, [menuOpen]);

  // Edit the LINK in place (online video, or a rare external-URL image). The original url stays
  // until Save, so Cancel brings the same media right back.
  const openEdit = (e) => { e.preventDefault(); setVal(url); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => { const v = val.trim(); if (v) editor.updateBlock(block, { type: block.type, props: { ...block.props, url: v } }); setEditing(false); };

  if (editing) return (
    <div className="nb-embed-edit-panel" contentEditable={false}>
      <Icon name={isImage ? 'image' : 'video'} />
      <input type="text" placeholder={tr('nb.embed_ph')} value={val} autoFocus
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } }}
        onPaste={(e) => e.stopPropagation()} />
      <button onMouseDown={(e) => { e.preventDefault(); saveEdit(); }}>{tr('nb.embed_add')}</button>
      <button className="nb-embed-cancel" onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}>{tr('common.cancel')}</button>
    </div>
  );

  // Resolve what to render. Only VIDEO parses the url (provider iframe vs file <video>); image,
  // audio and file render the url directly. A bad video url shows an edit panel; the others with
  // no url just show a small placeholder icon.
  const p = isVideo ? parseVideoUrl(url) : null;
  if (isVideo && !p) return (
    <div className="nb-embed-bad" contentEditable={false}>
      <Icon name="video" />
      <a href={url} target="_blank" rel="noreferrer">{url}</a>
      <button className="nb-embed-edit-bad" onMouseDown={openEdit}>{tr('nb.embed_edit')}</button>
    </div>
  );
  if (!isVideo && !url) return <div className="nb-embed-bad" contentEditable={false}><Icon name={kind === 'file' ? 'file' : kind === 'audio' ? 'audio' : 'image'} /></div>;

  // Drag a side handle to resize. The iframe swallows mouse events mid-drag, so a transparent
  // fixed overlay catches them while dragging.
  const startResize = (e, side) => {
    e.preventDefault(); e.stopPropagation();
    const node = wrapRef.current;
    const startX = e.clientX;
    const startW = node ? node.offsetWidth : (width || 680);
    const area = node && (node.closest('.bn-block-content') || node.parentElement);
    const maxW = area ? area.clientWidth : 960;
    setDragging(true);
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      let w = side === 'r' ? startW + dx : startW - dx;
      w = Math.max(120, Math.min(w, maxW));
      lastW.current = w;
      if (node) node.style.width = w + 'px';
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
      if (lastW.current) editor.updateBlock(block, { type: block.type, props: { ...block.props, width: Math.round(lastW.current) } });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // No auto-toolbar on click: a menu icon sits beside the media on the FREE side (opposite the
  // wall it's aligned to) and toggles the action bar on/off.
  const align = block.props.textAlignment || 'left';
  const caption = block.props.caption || '';
  const menuSide = align === 'right' ? 'left' : 'right';   // icon on the side away from the wall
  const setAlign = (a) => editor.updateBlock(block, { type: block.type, props: { ...block.props, textAlignment: a } });
  const editCap = async () => {
    setMenuOpen(false);
    const v = await window.uiPrompt({ title: tr('nb.caption'), def: block.props.caption || '', placeholder: tr('nb.caption') });
    editor.updateBlock(block, { type: block.type, props: { ...block.props, caption: (v || '') } });
  };
  const del = () => { try { editor.removeBlocks([block]); } catch (e) {} };
  // Open the bar as a fixed, on-screen-clamped popup anchored to the ⋯ icon, so it can never be
  // clipped off the left/right (or bottom) edge — whatever the media's size or wall alignment.
  const toggleMenu = (e) => {
    e.preventDefault();
    if (menuOpen) { setMenuOpen(false); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const W = 210, H = 40;
    let left = menuSide === 'right' ? r.right - W : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    let top = r.bottom + 4;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 4);
    setBarPos({ top, left });
    setMenuOpen(true);
  };
  // Replace: an UPLOADED file (proxy url) swaps via the Files-strip flow (picker → upload → swap
  // inline + attachment); an online video link opens the in-place link editor.
  const rawUrl = rawFileUrl(url);
  const isUploaded = !!rawUrl;
  const replace = (e) => {
    setMenuOpen(false);
    if (isUploaded && nbBridge.replaceInlineByUrl) nbBridge.replaceInlineByUrl(rawUrl);
    else openEdit(e);
  };
  const fitContent = isImage || (kind === 'file' && !isPdf);   // hug the content (chip / natural image width); a PDF viewer takes a box
  const wrapStyle = {
    ...(width && resizable ? { width: width + 'px', maxWidth: 'none' } : (fitContent ? { width: 'fit-content', maxWidth: '100%' } : {})),
    ...(align === 'center' ? { marginLeft: 'auto', marginRight: 'auto' }
      : align === 'right' ? { marginLeft: 'auto', marginRight: 0 }
      : { marginLeft: 0, marginRight: 'auto' }),
  };
  return (
    <div className="nb-embed-wrap" contentEditable={false} ref={wrapRef} style={wrapStyle} data-align={align} data-menu={menuOpen ? '1' : undefined}>
      <button className="nb-embed-menu-btn" data-side={menuSide} title={tr('common.more')} onMouseDown={toggleMenu}><Icon name="more" /></button>
      {menuOpen && barPos && (
        <div className="nb-embed-bar" style={{ top: barPos.top, left: barPos.left }} onMouseDown={(e) => e.preventDefault()}>
          <button className={'nb-vbar-btn' + (align === 'left' ? ' on' : '')} title={tr('align.left')} onMouseDown={() => setAlign('left')}><Icon name="alignLeft" /></button>
          <button className={'nb-vbar-btn' + (align === 'center' ? ' on' : '')} title={tr('align.center')} onMouseDown={() => setAlign('center')}><Icon name="alignCenter" /></button>
          <button className={'nb-vbar-btn' + (align === 'right' ? ' on' : '')} title={tr('align.right')} onMouseDown={() => setAlign('right')}><Icon name="alignRight" /></button>
          <span className="nb-vbar-sep" />
          <button className="nb-vbar-btn" title={tr('nb.caption')} onMouseDown={editCap}><Icon name="caption" /></button>
          <button className="nb-vbar-btn" title={tr('nb.replace')} onMouseDown={(e) => { e.preventDefault(); replace(e); }}><Icon name="replace" /></button>
          <button className="nb-vbar-btn nb-vbar-del" title={tr('nb.delete')} onMouseDown={del}><Icon name="trash" /></button>
        </div>
      )}
      {isPdf
        ? (
          <div className="nb-embed nb-embed-pdf">
            <iframe src={url} title={name || 'pdf'} />
            <div className="nb-embed-rsz l" onPointerDown={(e) => startResize(e, 'l')} />
            <div className="nb-embed-rsz r" onPointerDown={(e) => startResize(e, 'r')} />
            {dragging && <div className="nb-embed-dragmask" />}
          </div>
        )
        : kind === 'file'
        ? <div className="nb-embed-file"><span className="nb-embed-file-ic"><Icon name="file" /></span><span className="nb-embed-file-name">{name || tr('common.file')}</span></div>
        : kind === 'audio'
          ? <div className="nb-embed-audio"><audio src={url} controls /></div>
          : (
            <div className="nb-embed" data-img={isImage ? '1' : undefined}>
              {isImage
                ? <img src={url} alt={caption} draggable={false} />
                : (p.kind === 'iframe'
                  ? <iframe src={p.src} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen title="video" />
                  : <video src={p.src} controls />)}
              <div className="nb-embed-rsz l" onPointerDown={(e) => startResize(e, 'l')} />
              <div className="nb-embed-rsz r" onPointerDown={(e) => startResize(e, 'r')} />
              {dragging && <div className="nb-embed-dragmask" />}
            </div>
          )}
      {caption ? <div className="nb-embed-cap">{caption}</div> : null}
    </div>
  );
}

// createReactBlockSpec (0.51) returns a creator — call it () to get the BlockSpec.
const MEDIA_PROPS = { url: { default: '' }, width: { default: 0 }, caption: { default: '' }, textAlignment: { default: 'left' }, name: { default: '' } };
const mediaSpec = (type) => createReactBlockSpec(
  { type, propSchema: MEDIA_PROPS, content: 'none' },
  { render: (props) => <MediaView block={props.block} editor={props.editor} /> },
)();
const nbSchema = BlockNoteSchema.create({ blockSpecs: {
  ...defaultBlockSpecs,
  videoEmbed: mediaSpec('videoEmbed'),
  imageEmbed: mediaSpec('imageEmbed'),
  audioEmbed: mediaSpec('audioEmbed'),
  fileEmbed: mediaSpec('fileEmbed'),
} });

// The toolbar shown for a selected block. Both video kinds (the transient native `video` upload
// placeholder and our `videoEmbed`) use their own in-block ⋯ icon menu, so the auto-toolbar is
// suppressed for them. Every other block keeps BlockNote's default toolbar.
function NbFormattingToolbar() {
  const editor = useBlockNoteEditor();
  const sel = useSelectedBlocks(editor);
  const type = sel.length === 1 ? sel[0].type : null;
  const MEDIA = ['video', 'videoEmbed', 'image', 'imageEmbed', 'audio', 'audioEmbed', 'file', 'fileEmbed'];
  if (MEDIA.includes(type)) return null;
  return <FormattingToolbar>{getFormattingToolbarItems()}</FormattingToolbar>;
}

// ───────── Editor ─────────
function Editor({ note, onChangeMd, onReady, onMediaRemoved }) {
  const selfRef = useRef(null);   // this editor — used to drop a block whose upload failed
  // Parse our saved JSON body synchronously so it can seed the editor as initialContent.
  // Content set this way is NOT part of the undo history, so a single undo can't revert the
  // whole page-load back to empty (it only undoes the user's own edits since then). Legacy
  // markdown bodies have no sync form, so they still load asynchronously in the effect below.
  const initialContent = useMemo(() => {
    const raw = (note.body || '').trim();
    if (raw.startsWith('[')) {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p) && p.length) return p.every(isMediaBlock) ? [...p, { type: 'paragraph' }] : p;
      } catch (e) {}
    }
    return undefined;
  }, [note.id]);
  const editor = useCreateBlockNote({
    schema: nbSchema,
    initialContent,
    // Unify EVERY inline upload (image/video/audio/file) with attachments: it's also recorded as
    // a Todoist comment → Files strip. One upload, two references to the same file, so deleting
    // either side removes the other (matched by file_url, type-agnostic).
    uploadFile: window.NB ? (async (file, blockId) => {
      try {
        if (file && file.size > MAX_UPLOAD) {
          window.uiAlert({ title: tr('nb.upload_failed'), body: tr('nb.embed_too_big') });
          if (blockId) setTimeout(() => { try { selfRef.current && selfRef.current.removeBlocks([blockId]); } catch (e) {} }, 0);
          return {};
        }
        const d = await window.NB.uploadFile(file);
        if (d && d.file_url) {
          window.NB.addComment(note.id, '', d).catch(() => {});
          return '/api/attachment?u=' + encodeURIComponent(d.file_url);
        }
        return await window.NB.uploadImage(file);
      } catch (err) {
        // Never reject: BlockNote has no catch around uploadFile, so a rejection leaves the
        // block spinning "Loading…" forever. Show the real reason (e.g. Todoist Free's 5 MB
        // cap) and drop the stuck block instead.
        window.uiAlert({ title: tr('nb.upload_failed'), body: (err && err.message) || '' });
        if (blockId) setTimeout(() => { try { selfRef.current && selfRef.current.removeBlocks([blockId]); } catch (e) {} }, 0);
        return {};
      }
    }) : undefined,
    // Full table feature set (off by default in BlockNote): merged cells, per-cell
    // background/text colour and header rows/cols. Needed so a pasted styled table keeps
    // its formatting, and so the same controls are available when editing by hand.
    tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
    // When the pasted plain text looks like Markdown, parse it ourselves (markdown-it
    // → HTML → blocks) so lists, code blocks, tables etc. survive. We run before the
    // default handler because rich sources (the VSCode chat, browsers) also attach
    // text/html, which BlockNote would otherwise prefer over the Markdown.
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      // Our own copy format first: a BlockNote block-JSON array pastes verbatim, keeping
      // colours, alignment and merged cells that Markdown would strip.
      const blockJson = tryParseBlockJson(text);
      if (blockJson) {
        try { insertBlocksAtCursor(editor, blockJson); return true; } catch (e) {}
      }
      // Inside a code block the block is a "dumb" container: paste is ALWAYS verbatim plain
      // text — never re-parsed as Markdown (which would spawn a new block) and never altered.
      // Every character lands exactly as copied, ``` fences included.
      const curBlock = editor.getTextCursorPosition?.().block;
      if (curBlock && curBlock.type === 'codeBlock') {
        editor.pasteText(text);
        return true;
      }
      if (!looksLikeMarkdown(text)) {
        // Normal (non-Markdown) paste. Let BlockNote insert it, then turn any freshly pasted
        // external-URL image into a real Todoist attachment (page + Files), so a web image
        // pasted as a link doesn't stay an unmanaged external link. Image *bytes* upload via
        // uploadFile; deliberate "/ → Embed" images aren't pastes, so they're never touched.
        if (window.NB) {
          const before = externalImageUrls(editor.document);
          const res = defaultPasteHandler();
          setTimeout(() => { upgradePastedImages(editor, before, note.id); }, 60);
          return res;
        }
        return defaultPasteHandler();
      }
      (async () => {
        try {
          // Keep blank lines: plain ones become empty paragraphs, ">"-marked ones stay inside
          // the quote frame as hard breaks (markdown-it would otherwise drop them all).
          const blocks = await mdToBlocksPreservingBlanks(editor, text);
          if (!blocks || !blocks.length) { editor.pasteText(text); return; }
          insertBlocksAtCursor(editor, blocks);
        } catch (err) {
          editor.pasteText(text);
        }
      })();
      return true;
    },
  });
  selfRef.current = editor;
  const loaded = useRef(false);
  const prevMediaRef = useRef(null);   // baseline of inline image file_urls, to detect removals
  // Delete (×) on any empty native upload placeholder (audio/image/video/file): clicking its right
  // edge removes the block (BlockNote has no × there). Hit-tested by x so the rest still opens Upload.
  useEffect(() => {
    const PLACEHOLDER = ['audio', 'image', 'video', 'file'];
    const onDown = (e) => {
      const btn = e.target.closest && e.target.closest('.bn-add-file-button');
      if (!btn) return;
      const content = btn.closest('.bn-block-content[data-content-type]');
      const ct = content && content.getAttribute('data-content-type');
      if (!PLACEHOLDER.includes(ct)) return;
      const r = btn.getBoundingClientRect();
      if (e.clientX < r.right - 38) return;   // only the × zone on the right
      e.preventDefault(); e.stopPropagation();
      const holder = btn.closest('[data-id]');
      const id = holder && holder.getAttribute('data-id');
      if (id) { try { editor.removeBlocks([id]); } catch (err) {} }
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [editor]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!initialContent) {
        // Legacy markdown / edited on Todoist: no sync JSON, so parse and load here. (This
        // replaceBlocks does enter the undo history, but these old notes are rare.)
        const md = await editor.tryParseMarkdownToBlocks(toDisplayMd(note.body || ''));
        let blocks = reconstructAttachments(md);
        if (!cancelled && blocks.length) {
          // Guarantee a text block to park in, so a media-only note still has a text
          // cursor target (otherwise the cursor falls onto the image → selected).
          if (blocks.every(isMediaBlock)) blocks = [...blocks, { type: 'paragraph' }];
          editor.replaceBlocks(editor.document, blocks);
        }
      }
      if (!cancelled) {
        upgradeNativeMedia(editor);   // legacy native image/video blocks → our blocks, on open
        parkCursor(editor);
        // Re-park after mount in case BlockNote restores focus/selection.
        requestAnimationFrame(() => { if (!cancelled) parkCursor(editor); });
        setTimeout(() => { if (!cancelled) parkCursor(editor); }, 60);
        loaded.current = true;
        prevMediaRef.current = imageFileUrls(editor.document);   // baseline once the doc is loaded
        sweepDeadImages(editor);   // background: drop inline images whose Todoist file is gone
      }
    })();
    // Show "max 5 MB" on the native upload block, localized; CSS reads this var.
    document.documentElement.style.setProperty('--nb-size-hint', JSON.stringify(' · ' + tr('nb.upload_limit')));
    if (onReady) onReady(editor);
    return () => { cancelled = true; };
  }, [editor]);
  // Save the full BlockNote document as JSON so sizes, alignment, colours etc. survive.
  const onChange = useCallback(async () => {
    if (!loaded.current) return;
    upgradeNativeMedia(editor);   // native image/video (upload finished, link pasted) → our blocks
    // Removing an inline image from the page deletes its linked attachment too: diff the
    // inline image file_urls against the previous render and report what disappeared.
    const now = imageFileUrls(editor.document);
    if (prevMediaRef.current && onMediaRemoved) {
      const removed = [...prevMediaRef.current].filter((u) => !now.has(u));
      if (removed.length) onMediaRemoved(removed);
    }
    prevMediaRef.current = now;
    onChangeMd(JSON.stringify(editor.document));
  }, [editor, onChangeMd, onMediaRemoved]);
  // Replace BlockNote's built-in "/" menu (also opened by the side "+" button). Its default
  // size() middleware capped the menu to the space *below* the cursor against the whole
  // window, so near the bottom it shrank into a tiny scroll box and never flipped above —
  // and once flipped it ran all the way to the window's top edge, over the top toolbar.
  // Constraining flip/shift/size to the editor's scroll area (boundary) fixes both: the menu
  // flips above when there's no room below, and stops at the top toolbar. The min-height
  // floor keeps a cramped bottom from collapsing the menu and forces the flip. Options are
  // passed as functions so the boundary element is resolved each time the menu opens.
  return (
    <BlockNoteView editor={editor} theme="dark" onChange={onChange} slashMenu={false} formattingToolbar={false} emojiPicker={false}>
      <FormattingToolbarController formattingToolbar={NbFormattingToolbar} />
      <GridSuggestionMenuController
        triggerCharacter=":"
        columns={10}
        minQueryLength={0}
        getItems={async (query) =>
          query.trim() === ''
            // ":" alone → curated set, instant (no index build)
            ? CURATED_EMOJIS.map((native) => ({
                id: native,
                onItemClick: () => editor.insertInlineContent(native + ' '),
              }))
            // typed → full local search (builds the index once, on demand)
            : getDefaultEmojiPickerItems(editor, query)
        }
      />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query)}
        floatingUIOptions={{
          useFloatingOptions: {
            middleware: [
              offset(10),
              flip(() => ({ allowedPlacements: ['bottom-start', 'top-start'], padding: 10, boundary: slashBoundary() })),
              shift(() => ({ padding: 10, boundary: slashBoundary() })),
              size(() => ({
                padding: 10,
                boundary: slashBoundary(),
                apply({ availableHeight, elements }) {
                  elements.floating.style.maxHeight = `${Math.max(180, availableHeight)}px`;
                },
              })),
            ],
          },
        }}
      />
    </BlockNoteView>
  );
}

// ───────── files strip (attachments only, above the bottom bar) ─────────
// Files are stored as Todoist comments under the hood (the only attachment
// mechanism Todoist Free offers), but the page shows them purely as "Files":
// a compact strip just above the bottom bar that renders ONLY when the note
// actually has attachments — otherwise nothing shows and the editor owns the
// whole area. Text-only comments are not surfaced here (a note is a page).
function FilesStrip({ note, onDel, onReplace, onDownload }) {
  const atts = (note.comments || []).filter((c) => c.attachment);
  const [menu, setMenu] = useState(null);   // { comment, top, left } — the open chip menu, or null
  // Click anywhere / Escape closes the chip menu.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  if (!atts.length) return null;
  function openMenu(e, c) {
    e.preventDefault(); e.stopPropagation();
    if (menu && menu.comment.id === c.id) { setMenu(null); return; }   // toggle
    const r = e.currentTarget.getBoundingClientRect();
    // Open ABOVE the button — the Files strip sits at the bottom, so a downward menu gets clipped.
    setMenu({ comment: c, bottom: window.innerHeight - r.top + 4, left: Math.min(r.left, window.innerWidth - 180) });
  }
  async function del(c) { setMenu(null); if (await window.uiConfirm({ title: tr('nb.file_del_confirm'), ok: tr('nb.delete') })) onDel(c); }
  return (
    <div className="nb-files">
      <span className="nb-files-label">{tr('nb.files')} ({atts.length})</span>
      <div className="nb-files-row">
        {atts.map((c) => {
          const a = c.attachment;
          const isImg = attIsImage(a);
          const thumb = (a.tn_l && a.tn_l[0]) || a.image || a.file_url;
          return (
            <div className="nb-file" key={c.id} title={a.file_name || tr('common.file')} onMouseDown={(e) => openMenu(e, c)}>
              {isImg
                ? <img className="nb-file-thumb" src={attProxy(thumb)} alt="" />
                : <span className="nb-file-ico"><Icon name="file" /></span>}
              <span className="nb-file-name">{a.file_name || tr('common.file')}</span>
              <span className="nb-file-menu-ico"><Icon name="more" /></span>
            </div>
          );
        })}
      </div>
      {menu && (
        <div className="nb-file-menu" style={{ bottom: menu.bottom, left: menu.left }} onMouseDown={(e) => e.stopPropagation()}>
          <button onMouseDown={() => { const c = menu.comment; setMenu(null); onReplace(c); }}><Icon name="replace" /> {tr('nb.replace')}</button>
          <button onMouseDown={() => { const c = menu.comment; setMenu(null); onDownload(c); }}><Icon name="download" /> {tr('nb.download')}</button>
          <button className="danger" onMouseDown={() => del(menu.comment)}><Icon name="trash" /> {tr('nb.delete')}</button>
        </div>
      )}
    </div>
  );
}

// ───────── ⋯ menu ─────────
function CardMenu({ note, pos, sections, allLabels, onClose, onAction, initialSub }) {
  const [sub, setSub] = useState(initialSub || null);
  const [secNew, setSecNew] = useState(null);   // null = closed, '' = typing a new section name
  const ref = useRef(null);
  useEffect(() => {
    function out(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    function esc(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const style = { top: pos.top, left: pos.left };

  if (sub === 'section') {
    return (
      <div className="nb-menu" style={style} ref={ref}>
        <div className="nb-mi back" onClick={() => setSub(null)}>{tr('nb.back')}</div>
        <div className="nb-sep" />
        <div className="nb-mi" onClick={() => onAction('section', '')}>{(note.section || '') === '' ? '• ' : ''}{tr('nb.no_section')}</div>
        {sections.map((s) => <div className="nb-mi" key={s} onClick={() => onAction('section', s)}>{note.section === s ? '• ' : ''}{s}</div>)}
        <div className="nb-sep" />
        {secNew === null ? (
          <div className="nb-mi" onClick={() => setSecNew('')}><Icon name="folder" />{tr('nb.menu_new_section')}</div>
        ) : (
          <input className="nb-menu-input" autoFocus value={secNew} placeholder={tr('section.name_ph')}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setSecNew(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); const v = secNew.trim(); if (v) onAction('section-new', v); }
              if (e.key === 'Escape') { e.preventDefault(); setSecNew(null); }
            }} />
        )}
      </div>
    );
  }
  if (sub === 'priority') {
    return (
      <div className="nb-menu" style={style} ref={ref}>
        <div className="nb-mi back" onClick={() => setSub(null)}>{tr('nb.back')}</div>
        <div className="nb-sep" />
        {PRIO_LIST.map((p) => (
          <div className="nb-mi" key={p.id} onClick={() => onAction('priority', p.id)}>
            <span className="nb-dot" style={{ background: p.color }} />{prioName(p.id)}{note.priority === p.id ? ' •' : ''}
          </div>
        ))}
      </div>
    );
  }
  if (sub === 'labels') {
    const sel = note.labels || [];
    return (
      <div className="nb-menu" style={style} ref={ref}>
        <div className="nb-mi back" onClick={() => setSub(null)}>{tr('nb.back')}</div>
        <div className="nb-sep" />
        {allLabels.length === 0 && <div className="nb-mi muted">{tr('nb.no_labels')}</div>}
        {allLabels.map((l) => (
          <div className="nb-mi" key={l} onClick={() => onAction('label-toggle', l)}>
            <span className="nb-check">{sel.includes(l) ? '☑' : '☐'}</span>{l}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="nb-menu" style={style} ref={ref}>
      <div className="nb-mi" onClick={() => onAction('pin')}><Icon name="bookmark" />{note.pinned ? tr('nb.unpin') : tr('nb.pin')}</div>
      <div className="nb-mi" onClick={() => onAction('archive')}><Icon name="archive" />{note.archived ? tr('nb.unarchive') : tr('nb.archive')}</div>
      <div className="nb-sep" />
      <div className="nb-mi" onClick={() => onAction('up')}><Icon name="arrowUp" />{tr('nb.up')}</div>
      <div className="nb-mi" onClick={() => onAction('down')}><Icon name="arrowDown" />{tr('nb.down')}</div>
      <div className="nb-mi" onClick={() => setSub('section')}><Icon name="folder" />{tr('nb.section')} <span className="nb-arrow">›</span></div>
      <div className="nb-sep" />
      <div className="nb-mi" onClick={() => onAction('edit')}><Icon name="edit" />{tr('nb.edit')}</div>
      <div className="nb-mi" onClick={() => onAction('duplicate')}><Icon name="copy" />{tr('nb.duplicate')}</div>
      <div className="nb-sep" />
      <div className="nb-mi" onClick={() => setSub('priority')}><Icon name="flag" />{tr('nb.priority_color')} <span className="nb-arrow">›</span></div>
      <div className="nb-mi" onClick={() => setSub('labels')}><Icon name="tag" />{tr('nb.labels')} <span className="nb-arrow">›</span></div>
      <div className="nb-sep" />
      <div className="nb-mi danger" onClick={() => onAction('delete')}><Icon name="trash" />{tr('nb.delete')}</div>
    </div>
  );
}

// ───────── section ⋯ menu ─────────
function SectionMenu({ pos, onClose, curColor, onNewNote, onEdit, onAddAbove, onAddBelow, onUp, onDown, onSort, onColor, onDelete }) {
  const [sub, setSub] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    function out(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    function esc(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const style = { top: pos.top, left: pos.left };

  if (sub === 'sort') {
    return (
      <div className="nb-menu" style={style} ref={ref}>
        <div className="nb-mi back" onClick={() => setSub(null)}>{tr('nb.back')}</div>
        <div className="nb-sep" />
        <div className="nb-mi" onClick={() => onSort('date')}>{tr('nb.sort_date')}</div>
        <div className="nb-mi" onClick={() => onSort('priority')}>{tr('nb.sort_priority')}</div>
        <div className="nb-mi" onClick={() => onSort('title')}>{tr('nb.sort_title')}</div>
      </div>
    );
  }
  if (sub === 'color') {
    return (
      <div className="nb-menu" style={style} ref={ref}>
        <div className="nb-mi back" onClick={() => setSub(null)}>{tr('nb.back')}</div>
        <div className="nb-sep" />
        <div className="nb-color-row">
          {SEC_COLORS.map((c) => (
            <button key={c} className={'nb-swatch' + (curColor === c ? ' on' : '')} style={{ background: c }} onClick={() => onColor(c)} />
          ))}
        </div>
        <div className="nb-mi" onClick={() => onColor(null)}>{tr('nb.color_default')}</div>
      </div>
    );
  }
  return (
    <div className="nb-menu" style={style} ref={ref}>
      <div className="nb-mi" onClick={onNewNote}>{tr('nb.sec_new_note')}</div>
      <div className="nb-mi" onClick={onEdit}>{tr('nb.edit')}</div>
      <div className="nb-sep" />
      <div className="nb-mi" onClick={onAddAbove}>{tr('nb.sec_add_above')}</div>
      <div className="nb-mi" onClick={onAddBelow}>{tr('nb.sec_add_below')}</div>
      <div className="nb-sep" />
      <div className="nb-mi" onClick={onUp}>{tr('nb.up')}</div>
      <div className="nb-mi" onClick={onDown}>{tr('nb.down')}</div>
      <div className="nb-mi" onClick={() => setSub('sort')}>{tr('nb.sort')} <span className="nb-arrow">›</span></div>
      <div className="nb-mi" onClick={() => setSub('color')}>{tr('nb.color')} <span className="nb-arrow">›</span></div>
      <div className="nb-sep" />
      <div className="nb-mi danger" onClick={onDelete}>{tr('nb.delete')}</div>
    </div>
  );
}

// ───────── date picker (date + time) ─────────
function DatePicker({ pos, onClose, onPick, onPickTime, curDate, curTime }) {
  const ref = useRef(null);
  useEffect(() => {
    function out(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [onClose]);
  const mark = (d) => (curDate === d ? <span className="nb-arrow">•</span> : null);
  return (
    <div className="nb-menu" style={{ top: pos.top, left: pos.left }} ref={ref}>
      <div className="nb-mi" onClick={() => onPick(isoOffset(0))}><Icon name="calendar" />{tr('nb.today')}{mark(isoOffset(0))}</div>
      <div className="nb-mi" onClick={() => onPick(isoOffset(1))}><Icon name="calendar" />{tr('nb.tomorrow')}{mark(isoOffset(1))}</div>
      <div className="nb-mi" onClick={() => onPick(isoOffset(7))}><Icon name="calendar" />{tr('nb.plus_7d')}</div>
      <div className="nb-sep" />
      <input type="date" className="nb-date-input" value={curDate || ''} onChange={(e) => e.target.value && onPick(e.target.value)} />
      <div className="nb-time-row">
        <span className="nb-time-ico"><Icon name="clock" /></span>
        <input type="time" className="nb-time-input" value={curTime || ''} onChange={(e) => onPickTime(e.target.value)} />
        {curTime ? <button className="nb-time-clear" title={tr('nb.time_clear')} onClick={() => onPickTime('')}>×</button> : null}
      </div>
      <div className="nb-sep" />
      <div className="nb-mi muted" onClick={() => onPick('')}>{tr('nb.clear_date')}</div>
    </div>
  );
}

// ───────── App ─────────
function App() {
  const init = window.NB ? { notes: window.NB.list(), sections: window.NB.sections() } : { notes: [], sections: [] };
  const [notes, setNotes] = useState(init.notes);
  const [sections, setSections] = useState(init.sections);
  const [curId, setCurId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set(['__archived__']));
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [menu, setMenu] = useState(null);
  const [datePop, setDatePop] = useState(null);
  const [secMenu, setSecMenu] = useState(null);
  const [renamingSec, setRenamingSec] = useState(null);
  const [addAfter, setAddAfter] = useState(undefined);   // section position for "add above/below"
  const [secColors, setSecColors] = useState(() => { try { return JSON.parse(localStorage.getItem('nb_section_colors') || '{}'); } catch (e) { return {}; } });
  const [addingSec, setAddingSec] = useState(false);
  const [secName, setSecName] = useState('');
  const [exportPop, setExportPop] = useState(null);   // export format chooser (md / pdf)
  const [hasSel, setHasSel] = useState(false);   // a real selection exists → "Clear" button switches to "delete selected"
  const titleTimer = useRef(null);
  const bodyTimer = useRef(null);
  const titleRef = useRef(null);
  const dirtyRef = useRef({ title: false });   // fields with un-acked local edits, so a store push won't clobber them
  const missTimer = useRef(null);          // grace timer before closing an open note that vanished from a sync snapshot
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const replaceRef = useRef(null);          // hidden input for the Files-strip "Replace" action
  const replaceTargetRef = useRef(null);    // the attachment comment currently being replaced
  const suppressRef = useRef(new Set());   // file_urls whose comment-delete the × already runs, so the
                                           // inline-removal detector below doesn't delete them a 2nd time

  const [, setLangTick] = useState(0);

  useEffect(() => {
    if (!window.NB) return;
    const has = (arr, id) => arr.some((n) => n.id === id);
    // A freshly-created note opens on a LOCAL uuid (has hyphens); Todoist later assigns the real,
    // numeric id and the store swaps it. So a temp id == one we must follow through that remap.
    const isTempId = (id) => typeof id === 'string' && id.includes('-');
    window.NB.subscribe((data) => {
      let cid = curIdRef.current;
      // Follow a temp→real id remap. In ONE sync the open uuid vanishes and the real id appears in
      // its place. A local/temp note can't be "deleted elsewhere", so its disappearance IS the
      // remap — switch the open page to the new id (so it stays open and its saves keep landing).
      if (cid != null && isTempId(cid) && !has(data.notes, cid)) {
        const appeared = data.notes.filter((n) => !has(notesRef.current, n.id));
        if (appeared.length === 1) { cid = appeared[0].id; curIdRef.current = cid; setCurId(cid); }
      }
      setNotes((prev) => {
        let next = data.notes;
        // Don't let a sync that momentarily lacks the OPEN note yank the user out of the page:
        // keep our local copy until the note is gone for real (see the close logic below).
        if (cid != null && !has(next, cid)) {
          const local = prev.find((p) => p.id === cid);
          if (local) next = [local, ...next];
        }
        // Keep the title the user is actively typing. An in-flight save's response (or the 10s
        // poll) carries a snapshot from when it started, so a blind replace would wipe characters
        // typed during the round-trip. While the title save is still pending (dirty), preserve it.
        if (dirtyRef.current.title && cid != null) {
          const local = prev.find((p) => p.id === cid);
          if (local) next = next.map((n) => (n.id === cid ? { ...n, title: local.title } : n));
        }
        return next;
      });
      setSections(data.sections);
      // Close the open note only when it's REALLY gone. A local/temp note is never closed (it's
      // round-tripping, not deleted). A confirmed (real-id) note that vanishes is closed only after
      // a short grace, so a transient store rebuild doesn't kick the user out, while a genuine
      // delete on another device still closes the page here.
      const present = cid == null || has(data.notes, cid);
      if (present || isTempId(cid)) {
        if (missTimer.current) { clearTimeout(missTimer.current); missTimer.current = null; }
      } else if (!missTimer.current) {
        missTimer.current = setTimeout(() => {
          missTimer.current = null;
          const id = curIdRef.current;
          if (id != null && !isTempId(id) && !(window.NB.list() || []).some((n) => n.id === id)) setCurId(null);
        }, 6000);
      }
    });
    return () => { if (missTimer.current) { clearTimeout(missTimer.current); missTimer.current = null; } };
  }, []);

  // re-render on language switch
  useEffect(() => {
    if (!window.I18N) return;
    return window.I18N.onChange(() => setLangTick((t) => t + 1));
  }, []);

  const cur = notes.find((n) => n.id === curId);
  const notesRef = useRef(notes); notesRef.current = notes;
  const curIdRef = useRef(curId); curIdRef.current = curId;

  // ── image ⇄ attachment link ──
  // Page → attachment: when an inline image disappears from the body, delete its linked
  // attachment comment too (matched by the shared Todoist file_url). Skipped for file_urls
  // already being removed by the Files-strip × (suppressRef), so the two paths don't clash.
  const onMediaRemoved = useCallback((rawUrls) => {
    const n = notesRef.current.find((x) => x.id === curIdRef.current);
    const comms = (n && n.comments) || [];
    rawUrls.forEach((u) => {
      if (suppressRef.current.has(u)) { suppressRef.current.delete(u); return; }
      const c = comms.find((c) => c.attachment && c.attachment.file_url === u);
      if (c) window.NB.deleteComment(c.id).catch(() => {});
    });
  }, []);
  // Attachment → page: the Files-strip × deletes the attachment AND removes its inline image.
  const onDelFile = useCallback((comment) => {
    const a = comment.attachment; const u = a && a.file_url;
    if (u && editorRef.current) {
      try {
        const hits = [];
        const walk = (arr) => (arr || []).forEach((b) => { if (b.props && rawFileUrl(b.props.url) === u) hits.push(b); if (b.children) walk(b.children); });
        walk(editorRef.current.document || []);
        if (hits.length) { suppressRef.current.add(u); editorRef.current.removeBlocks(hits); setTimeout(() => suppressRef.current.delete(u), 4000); }
      } catch (e) {}
    }
    window.NB.deleteComment(comment.id).catch(() => {});
  }, []);

  // Bug-2: an inline image-file "knows its address" (Todoist file_url). When its attachment
  // comment is deleted — by our × OR directly on the server — that address is gone, so the
  // inline image must go too. We diff the live attachment file_urls against the previous
  // render: an address that vanished while its inline block is still present is replaced with
  // an empty image block (the "add image" placeholder). Images whose file still exists (no
  // comment, e.g. an older inline upload) never show up as "gone", so they're left untouched.
  const prevCommentUrlsRef = useRef({ id: null, urls: new Set() });
  const commentKey = cur ? (cur.comments || []).filter((c) => c.attachment && c.attachment.file_url).map((c) => c.attachment.file_url).sort().join('|') : '';
  useEffect(() => {
    if (!cur) { prevCommentUrlsRef.current = { id: null, urls: new Set() }; return; }
    const live = new Set((cur.comments || []).filter((c) => c.attachment && c.attachment.file_url).map((c) => c.attachment.file_url));
    const prev = prevCommentUrlsRef.current;
    if (prev.id === cur.id && editorRef.current) {
      const ed = editorRef.current;
      const gone = [...prev.urls].filter((u) => !live.has(u));
      // A comment leaving the local list is NOT proof the file is gone: a background sync can
      // briefly drop an optimistically-added comment before its push round-trips. Confirm the
      // file is actually dead (the same fileAlive check used on open) before clearing its inline
      // image, so freshly-added images aren't wiped during a sync.
      gone.forEach(async (u) => {
        try {
          if (await window.NB.fileAlive(u)) return;
          const hits = [];
          const walk = (arr) => (arr || []).forEach((b) => { if (b.props && rawFileUrl(b.props.url) === u) hits.push(b); if (b.children) walk(b.children); });
          walk(ed.document || []);
          hits.forEach((b) => { try { ed.updateBlock(b, { type: b.type, props: { url: '', name: '' } }); } catch (e) {} });
        } catch (e) {}
      });
    }
    prevCommentUrlsRef.current = { id: cur.id, urls: live };
  }, [cur && cur.id, commentKey]);

  function onTitleChange(e) {
    const title = e.target.value, id = curId;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
    dirtyRef.current.title = true;
    clearTimeout(titleTimer.current); setSaving(true);
    titleTimer.current = setTimeout(async () => {
      try { await window.NB.saveTitle(id, title); } catch (e) {}
      finally {
        setSaving(false);
        // Clear dirty only if nothing newer was typed while this save ran — otherwise a
        // later store push could still clobber the not-yet-saved characters.
        const c = notesRef.current.find((n) => n.id === id);
        if (!c || c.title === title) dirtyRef.current.title = false;
      }
    }, 600);
  }
  const handleBody = useCallback((md) => {
    const id = curId;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body: md } : n)));
    clearTimeout(bodyTimer.current); setSaving(true);
    bodyTimer.current = setTimeout(async () => {
      try { await window.NB.saveBody(id, md); } catch (e) {} finally { setSaving(false); }
    }, 800);
  }, [curId]);

  // Open the new page immediately from the returned object, before the sync confirms it: seed it
  // into the list so the editor shows at once. Its id is a local uuid until Todoist assigns the
  // real one — the subscribe handler then follows that remap, so the page is never kicked out.
  function openCreated(n) {
    if (!n) return;
    setNotes((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
    setCurId(n.id);
  }
  async function newNote() { try { openCreated(await window.NB.create()); } catch (e) {} }
  async function delNote(id) { if (!(await window.uiConfirm({ title: tr('nb.delete_confirm'), ok: tr('nb.delete') }))) return; if (id === curId) setCurId(null); try { await window.NB.del(id); } catch (e) {} }
  async function commitAddSection() {
    const n = secName.trim();
    const after = addAfter;
    setAddingSec(false); setSecName(''); setAddAfter(undefined);
    if (n) { try { await window.NB.addSection(n, after); } catch (e) {} }
  }
  function startAddSection(after) { setAddAfter(after); setSecName(''); setAddingSec(true); }
  function newNoteInSection(name) { window.NB.create(name).then((n) => { if (n) openCreated({ ...n, section: name }); }).catch(() => {}); }
  async function deleteSec(name) { if (await window.uiConfirm({ title: tr('nb.sec_delete_confirm'), ok: tr('nb.delete') })) window.NB.deleteSection(name).catch(() => {}); }
  function addAfterFor(name, where) { const i = sections.indexOf(name); return where === 'above' ? (i > 0 ? sections[i - 1] : '') : name; }
  function applySecColor(name, color) {
    setSecColors((prev) => {
      const next = { ...prev };
      if (color) next[name] = color; else delete next[name];
      try { localStorage.setItem('nb_section_colors', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }
  function toggleCollapse(name) { setCollapsed((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; }); }
  function openSecMenu(e, name) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setSecMenu({ name, top: Math.min(r.bottom + 4, window.innerHeight - 80), left: Math.min(r.left, window.innerWidth - 200) });
  }
  function commitSecRename(oldName, val) {
    setRenamingSec(null);
    const v = (val || '').trim();
    if (v && v !== oldName) window.NB.renameSection(oldName, v).catch(() => {});
  }
  function onDrop(sectionName, dropMode) {
    const id = dragId; setDragId(null); setDropTarget(null);
    if (id == null || dropMode === 'none') return;
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    if (dropMode === 'pin') {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, section: pinnedSectionName(), pinned: true, archived: false } : n)));
      window.NB.setPinned(id, true).catch(() => {});
      return;
    }
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, section: sectionName, pinned: false, archived: false } : n)));
    window.NB.moveToSection(id, sectionName).catch(() => {});
  }

  function openMenu(e, note, initialSub) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    // The card menu is tall (~430px); clamp so the bottom items aren't cut off below
    // the viewport, and never push it off the top.
    const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 430));
    setMenu({ note, top, left: Math.min(r.left, window.innerWidth - 230), initialSub: initialSub || null });
  }
  function openDate(e) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setDatePop({ top: Math.max(8, r.top - 220), left: Math.min(r.left, window.innerWidth - 230) });
  }
  function menuAction(kind, val) {
    const note = menu && menu.note; if (!note) return;
    const id = note.id;
    if (kind === 'pin') { window.NB.setPinned(id, !note.pinned).catch(() => {}); setMenu(null); }
    else if (kind === 'archive') { window.NB.setArchived(id, !note.archived).catch(() => {}); if (id === curId) setCurId(null); setMenu(null); }
    else if (kind === 'up' || kind === 'down') { window.NB.reorder(id, kind).catch(() => {}); setMenu(null); }
    else if (kind === 'section') { window.NB.moveToSection(id, val).catch(() => {}); setMenu(null); }
    else if (kind === 'section-new') {
      const name = (val || '').trim();
      if (name) window.NB.addSection(name).then(() => window.NB.moveToSection(id, name)).catch(() => {});
      setMenu(null);
    }
    else if (kind === 'edit') { setCurId(id); setMenu(null); setTimeout(() => titleRef.current && titleRef.current.focus(), 50); }
    else if (kind === 'duplicate') { window.NB.duplicate(id).catch(() => {}); setMenu(null); }
    else if (kind === 'priority') { window.NB.setPriority(id, val).catch(() => {}); setMenu(null); }
    else if (kind === 'label-toggle') {
      const sel = note.labels || [];
      const next = sel.includes(val) ? sel.filter((x) => x !== val) : [...sel, val];
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, labels: next } : n)));
      setMenu((m) => (m ? { ...m, note: { ...m.note, labels: next } } : m));
      window.NB.setLabels(id, next).catch(() => {});
    }
    else if (kind === 'delete') { setMenu(null); delNote(id); }
  }
  // Date stays open after a pick so a time can be added too; only "clear" closes it
  // (clearing the date also drops the time, matching Todoist).
  function pickDate(date) {
    if (!cur) return;
    window.NB.setDueDate(cur.id, date).catch(() => {});
    if (!date) { window.NB.setDueTime(cur.id, '').catch(() => {}); setDatePop(null); }
  }
  function pickTime(time) {
    if (!cur) return;
    if (time && !cur.due_date) window.NB.setDueDate(cur.id, isoOffset(0)).catch(() => {});  // time needs a date
    window.NB.setDueTime(cur.id, time).catch(() => {});
  }
  function pinCur() { if (cur) window.NB.setPinned(cur.id, !cur.pinned).catch(() => {}); }
  function duplicateCur() { if (cur) window.NB.duplicate(cur.id).catch(() => {}); }
  function archiveCur() {
    if (!cur) return;
    const id = cur.id; setCurId(null);
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, archived: true } : n)));
    window.NB.setArchived(id, true).catch(() => {});
  }
  // Undo/redo drive the BlockNote editor's own history. Ctrl+Z / Ctrl+Y work natively too;
  // these buttons mirror that for mouse users. onChange fires after, so the save runs as usual.
  function doUndo() { try { editorRef.current && editorRef.current.undo(); } catch (err) {} }
  function doRedo() { try { editorRef.current && editorRef.current.redo(); } catch (err) {} }
  // "Clear" button (next to undo/redo), two modes by selection state:
  //  • something selected (text or a node-selected block) → delete just that, no prompt — the
  //    user chose it. Files inside the selection go too, via the normal onChange media diff.
  //  • nothing selected → wipe the whole page body (select-all → delete). Inline media goes
  //    with it, so its linked attachments are deleted by the same diff. Title/date/label/colour/
  //    section stay (those aren't body). ALWAYS confirmed — destructive and easy to hit by mistake.
  async function doClear() {
    const ed = editorRef.current;
    if (!ed) return;
    if (!selEmpty(ed)) {
      try {
        const view = ed.prosemirrorView || (ed._tiptapEditor && ed._tiptapEditor.view);
        if (view) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
        setHasSel(false);
      } catch (err) {}
      return;
    }
    if (!(await window.uiConfirm({ title: tr('nb.clear_confirm'), body: tr('nb.clear_confirm_body'), note: tr('nb.clear_confirm_note'), ok: tr('nb.clear_ok') }))) return;
    try { ed.replaceBlocks(ed.document, [{ type: 'paragraph' }]); parkCursor(ed); } catch (err) {}
  }
  // The paperclip attaches a file to the page. It's stored as a Todoist comment
  // (the only attachment mechanism) and shows up in the Files strip above the
  // bottom bar. Inline images come from the editor's own "/" menu, not here.
  async function onPickFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !cur) return;
    setSaving(true);
    try {
      const att = await window.NB.uploadFile(file);
      await window.NB.addComment(cur.id, '', att);
      // Unify: the attachment is also inserted inline at the cursor (one file, two places), in the
      // matching custom block — image/video/audio/file.
      if (att.file_url && editorRef.current) {
        insertBlockAtCursorOrEnd(editorRef.current, { type: embedTypeForAtt(att), props: { url: '/api/attachment?u=' + encodeURIComponent(att.file_url), name: att.file_name || '' } });
      }
    } catch (err) { window.uiAlert({ title: tr('nb.upload_failed'), body: err.message || '' }); }
    finally { setSaving(false); }
  }
  // Files strip — Download: the native WebView blocks browser downloads, so the server fetches
  // the file (with our auth) and reveals it in Explorer.
  function onDownloadFile(comment) {
    const a = comment.attachment; if (!a || !a.file_url) return;
    window.NB.downloadFile(a.file_url, a.file_name || '').catch((err) => window.uiAlert({ title: tr('nb.download_failed'), body: err.message || '' }));
  }
  // Files strip — Replace: pick a new file, upload it, swap any inline block that pointed at the
  // old file to the new one, then delete the old attachment comment.
  function onReplaceFile(comment) { replaceTargetRef.current = comment; if (replaceRef.current) replaceRef.current.click(); }
  async function onReplacePicked(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    const old = replaceTargetRef.current; replaceTargetRef.current = null;
    if (!file || !old || !cur) return;
    setSaving(true);
    try {
      const att = await window.NB.uploadFile(file);
      await window.NB.addComment(cur.id, '', att);
      const oldUrl = old.attachment && old.attachment.file_url;
      const newUrl = '/api/attachment?u=' + encodeURIComponent(att.file_url);
      const newType = embedTypeForAtt(att);
      if (oldUrl && editorRef.current) {
        const hits = [];
        const walk = (arr) => (arr || []).forEach((b) => { if (b.props && rawFileUrl(b.props.url) === oldUrl) hits.push(b); if (b.children) walk(b.children); });
        walk(editorRef.current.document || []);
        hits.forEach((b) => {
          try {
            // Land in the matching custom block; keep size/caption/alignment if the type is unchanged.
            editorRef.current.updateBlock(b, { type: newType, props: { ...(b.type === newType ? b.props : {}), url: newUrl, name: att.file_name || '' } });
          } catch (e2) {}
        });
        // Don't let the inline-removal detector delete the new comment when the old url leaves.
        suppressRef.current.add(oldUrl); setTimeout(() => suppressRef.current.delete(oldUrl), 4000);
      }
      await window.NB.deleteComment(old.id);
    } catch (err) { window.uiAlert({ title: tr('nb.upload_failed'), body: err.message || '' }); }
    finally { setSaving(false); }
  }
  // A video block's own "Replace" reuses this flow: find the attachment with that file_url, then
  // run the same picker→upload→swap as the Files strip.
  function replaceInlineByUrl(rawUrl) {
    const n = notesRef.current.find((x) => x.id === curIdRef.current);
    const c = ((n && n.comments) || []).find((cc) => cc.attachment && cc.attachment.file_url === rawUrl);
    if (c) onReplaceFile(c);
  }
  nbBridge.replaceInlineByUrl = replaceInlineByUrl;
  function openExport(e) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    // Lives in the bottom bar now → open the menu above the button.
    setExportPop({ top: Math.max(8, r.top - 92), left: Math.min(r.left, window.innerWidth - 220) });
  }
  // Open the note as a self-contained HTML page in the default browser — there the user
  // gets a proper Ctrl+P / Save as PDF. For faithful WYSIWYG (image sizes, centering,
  // table widths) we clone the LIVE rendered editor DOM and ship BlockNote's own CSS;
  // the lossy HTML export dropped all layout. Images are inlined as base64.
  async function exportBrowser() {
    setExportPop(null);
    if (!cur) return;
    const area = document.querySelector('.nb-editor-area');
    const root = area && (area.querySelector('.bn-container') || area.querySelector('.bn-editor'));
    if (!root) return;
    try {
      const clone = root.cloneNode(true);
      clone.removeAttribute('contenteditable');
      clone.setAttribute('data-color-scheme', 'light');   // readable + printable; layout unchanged
      clone.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'));
      clone.querySelectorAll('.bn-side-menu, .bn-drag-handle-menu, .ProseMirror-gapcursor').forEach((el) => el.remove());
      // Drop any selection state (a selected block/image carries a blue ring otherwise)
      clone.querySelectorAll('.ProseMirror-selectednode, [data-selected="true"]').forEach((el) => {
        el.classList.remove('ProseMirror-selectednode');
        el.removeAttribute('data-selected');
      });
      for (const img of [...clone.querySelectorAll('img')]) {
        const src = img.getAttribute('src') || '';
        if (src.indexOf('/api/attachment') === 0) {
          try { const r = await fetch(src); img.setAttribute('src', await blobToDataURL(await r.blob())); } catch (e) {}
        }
      }
      const css = await (await fetch('/notebook-assets/bundle.css')).text();
      const title = cur.title || tr('common.untitled');
      const doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>'
        + '<style>' + css + '</style>'
        + '<style>html,body{margin:0;background:#fff}'
        + '.nbx-wrap{max-width:860px;margin:0 auto;padding:28px 24px 60px}'
        + '.nbx-title{font-family:system-ui,"Segoe UI",sans-serif;font-size:26px;font-weight:700;color:#1a1a1a;margin:0 0 16px}</style></head>'
        + '<body><div class="nbx-wrap"><div class="nbx-title">' + escapeHtml(title) + '</div>' + clone.outerHTML + '</div></body></html>';
      await window.NB.exportFile(safeName(title) + '.html', strToB64(doc), 'browser');
    } catch (err) { window.uiAlert({ title: tr('nb.export_failed'), body: err.message || '' }); }
  }
  // Save a portable Markdown file (images inlined) and reveal the exports folder.
  async function exportMarkdown() {
    setExportPop(null);
    const ed = editorRef.current; if (!ed || !cur) return;
    try {
      let md = await ed.blocksToMarkdownLossy(mediaToNativeBlocks(ed.document));
      md = toDisplayMd(md);                       // raw → proxy so the fetch has auth
      md = await embedAttachments(md, true);      // images → base64 data URIs
      const title = cur.title || tr('common.untitled');
      await window.NB.exportFile(safeName(title) + '.md', strToB64('# ' + title + '\n\n' + md), 'folder');
    } catch (err) { window.uiAlert({ title: tr('nb.export_failed'), body: err.message || '' }); }
  }

  const groups = [{ name: '', title: tr('nb.no_section') }].concat(sections.map((s) => ({ name: s, title: s })));

  return (
    <div className="nb-layout">
      <div className="nb-side">
        <div className="nb-toptools">
          <button className="nb-tool note" onClick={newNote} title={tr('nb.new_note').replace(/^\+\s*/, '')}>
            <Icon name="file" />
            <span className="nb-tool-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></span>
          </button>
          <button className="nb-tool sec" onClick={() => startAddSection(undefined)} title={tr('nb.new_section').replace(/^\+\s*/, '')}>
            <Icon name="folder" />
            <span className="nb-tool-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></span>
          </button>
        </div>
        {addingSec && (
          <div className="nb-addsec-form">
            <input autoFocus className="nb-addsec-input" value={secName}
              placeholder={tr('section.name_ph')}
              onChange={(e) => setSecName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitAddSection(); }
                if (e.key === 'Escape') { setAddingSec(false); setSecName(''); setAddAfter(undefined); }
              }} />
            <div className="nb-addsec-btns">
              <button className="nb-addsec-go" disabled={!secName.trim()} onClick={commitAddSection}>{tr('section.add_btn')}</button>
              <button className="nb-addsec-cancel" onClick={() => { setAddingSec(false); setSecName(''); setAddAfter(undefined); }}>{tr('common.cancel')}</button>
            </div>
          </div>
        )}
        <div className="nb-list">
          {notes.length === 0 && sections.length === 0 && <div className="nb-side-msg">{tr('nb.no_notes')}</div>}
          {(() => {
            const renderGroup = (g, gn, dropMode) => {
              const isC = collapsed.has(g.name);
              // Pinned/archived groups are recognised by an emoji-prefixed Todoist section
              // name, but in the UI we drop the emoji and show a grey SVG icon instead.
              const special = g.name === '__pinned__' ? 'bookmark' : g.name === '__archived__' ? 'archive' : null;
              const dispTitle = special ? g.title.replace(/^(📌|📥)\s*/, '') : g.title;
              // The "no section" group renders plainly (no band, no header) so loose
              // pages don't look like they belong to a section.
              const plain = g.name === '';
              return (
                <div key={g.name || '__none__'} className={'nb-group' + (plain ? ' nb-group-plain' : '') + (dropTarget === g.name ? ' drop-over' : '')}
                  onDragOver={dropMode === 'none' ? undefined : (e) => { e.preventDefault(); if (dropTarget !== g.name) setDropTarget(g.name); }}
                  onDragLeave={(e) => { if (e.currentTarget === e.target) setDropTarget(null); }}
                  onDrop={dropMode === 'none' ? undefined : () => onDrop(g.name, dropMode)}>
                  {!plain && (
                  <div className="nb-group-head" onClick={() => toggleCollapse(g.name)}>
                    <span className="nb-caret">{isC ? '▸' : '▾'}</span>
                    {renamingSec === g.name ? (
                      <input className="nb-sec-rename" autoFocus defaultValue={g.title}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitSecRename(g.name, e.currentTarget.value); }
                          if (e.key === 'Escape') { e.preventDefault(); setRenamingSec(null); }
                        }}
                        onBlur={(e) => commitSecRename(g.name, e.currentTarget.value)} />
                    ) : (
                      <>
                        <span className="nb-group-title" style={secColors[g.name] ? { color: secColors[g.name] } : undefined}>{dispTitle}</span>
                        {special ? <span className="nb-group-ico"><Icon name={special} /></span> : null}
                      </>
                    )}
                    {dropMode === 'section' && g.name !== '' && renamingSec !== g.name && (
                      <button className="nb-sec-add" title={tr('nb.sec_new_note')} onClick={(e) => { e.stopPropagation(); newNoteInSection(g.name); }}>+</button>
                    )}
                    {dropMode === 'section' && g.name !== '' && renamingSec !== g.name && (
                      <button className="nb-dots nb-sec-dots" onClick={(e) => openSecMenu(e, g.name)}>⋯</button>
                    )}
                  </div>
                  )}
                  {!isC && gn.map((n) => (
                    <div key={n.id} className={'nb-item' + (n.id === curId ? ' sel' : '') + (n.id === dragId ? ' dragging' : '')}
                      draggable onDragStart={() => setDragId(n.id)} onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                      onClick={() => setCurId(n.id)}>
                      <div className="nb-item-head">
                        <span className="nb-t-text">{n.title || tr('common.untitled')}</span>
                        {(n.comments || []).some((c) => c.attachment)
                          ? <span className="nb-file-badge" title={tr('nb.files')}><Icon name="paperclip" /></span> : null}
                        {PRIO_COLOR[n.priority] && PRIO_COLOR[n.priority] !== 'transparent'
                          ? <span className="nb-pdot" style={{ background: PRIO_COLOR[n.priority] }} /> : null}
                        <button className="nb-dots" onClick={(e) => openMenu(e, n)}>⋯</button>
                      </div>
                      {preview(n.body)
                        ? <div className="nb-preview">{preview(n.body)}</div> : null}
                      {(n.due_date || (n.labels && n.labels.length))
                        ? <div className="nb-metaline">
                            {n.due_date ? <span className="nb-date">{n.due_date}</span> : null}
                            {(n.labels || []).map((l) => <span key={l} className="nb-chip">{l}</span>)}
                          </div>
                        : null}
                    </div>
                  ))}
                </div>
              );
            };
            const blocks = [];
            const pinnedNotes = notes.filter((n) => n.pinned && !n.archived);
            if (pinnedNotes.length) blocks.push(renderGroup({ name: '__pinned__', title: tr('nb.group_pinned') }, pinnedNotes, 'pin'));
            groups.forEach((g) => {
              const gn = notes.filter((n) => !n.pinned && !n.archived && (n.section || '') === g.name);
              if (g.name === '' && gn.length === 0 && sections.length > 0) return;
              blocks.push(renderGroup(g, gn, 'section'));
            });
            const archivedNotes = notes.filter((n) => n.archived);
            if (archivedNotes.length) blocks.push(renderGroup({ name: '__archived__', title: tr('nb.group_archived') }, archivedNotes, 'none'));
            return blocks;
          })()}
        </div>
      </div>

      <div className="nb-main">
        {cur ? (
          <>
            <div className="nb-bar">
              <button className="nb-tbtn" title={tr('nb.tip_undo')} onClick={doUndo}><Icon name="undo" /></button>
              <button className="nb-tbtn" title={tr('nb.tip_redo')} onClick={doRedo}><Icon name="redo" /></button>
              <span className="nb-bar-div" />
              <button className={'nb-clearbtn' + (hasSel ? ' danger' : '')} onClick={doClear} title={hasSel ? tr('nb.tip_clear_sel') : tr('nb.tip_clear')}>
                <Icon name="eraser" /><span>{hasSel ? tr('nb.clear_sel') : tr('nb.clear')}</span>
              </button>
              <span className="nb-bar-spacer" />
              <span className={'nb-save ' + (saving ? 'saving' : 'saved')} title={saving ? tr('nb.saving') : tr('nb.saved')}><Icon name={saving ? 'loader' : 'check'} /></span>
            </div>
            <div className="nb-editor-area">
              <input className="nb-title-input" ref={titleRef} value={cur.title || ''} onChange={onTitleChange} onFocus={(e) => e.target.select()} placeholder={tr('nb.title_ph')} />
              {cur.labels && cur.labels.length ? (
                <div className="nb-editor-labels">{cur.labels.map((l) => <span key={l} className="nb-chip">{l}</span>)}</div>
              ) : null}
              <Editor key={cur.id} note={cur} onChangeMd={handleBody} onReady={(ed) => { editorRef.current = ed; setHasSel(!selEmpty(ed)); try { ed.onSelectionChange && ed.onSelectionChange(() => setHasSel(!selEmpty(ed))); } catch (e) {} }} onMediaRemoved={onMediaRemoved} />
            </div>
            <FilesStrip note={cur} onDel={onDelFile} onReplace={onReplaceFile} onDownload={onDownloadFile} />
            <div className="nb-bottom">
              <button className="nb-bt" title={tr('nb.tip_date')} onClick={openDate}><Icon name="calendar" /></button>
              <button className="nb-bt" title={tr('nb.tip_color')} onClick={(e) => openMenu(e, cur, 'priority')}>
                <span style={{ color: (PRIO_COLOR[cur.priority] && PRIO_COLOR[cur.priority] !== 'transparent') ? PRIO_COLOR[cur.priority] : 'var(--nb-dim)', display: 'inline-flex' }}><Icon name="flag" /></span>
              </button>
              <button className="nb-bt" title={tr('nb.tip_labels')} onClick={(e) => openMenu(e, cur, 'labels')}><Icon name="tag" /></button>
              <button className="nb-bt" title={tr('nb.tip_file')} onClick={() => fileRef.current && fileRef.current.click()}><Icon name="paperclip" /></button>
              <span className="nb-bt-div" />
              <button className={'nb-bt' + (cur.pinned ? ' on' : '')} title={cur.pinned ? tr('nb.unpin') : tr('nb.pin')} onClick={pinCur}><Icon name="bookmark" /></button>
              <button className="nb-bt" title={tr('nb.section')} onClick={(e) => openMenu(e, cur, 'section')}><Icon name="move" /></button>
              <button className="nb-bt" title={tr('nb.duplicate')} onClick={duplicateCur}><Icon name="copy" /></button>
              <button className="nb-bt" title={cur.archived ? tr('nb.unarchive') : tr('nb.archive')} onClick={archiveCur}><Icon name="archive" /></button>
              <button className="nb-bt" title={tr('nb.export')} onClick={openExport}><Icon name="download" /></button>
              <span className="nb-bar-spacer" />
              <button className="nb-bt danger" title={tr('nb.tip_delete')} onClick={() => delNote(cur.id)}><Icon name="trash" /></button>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onPickFile} />
              <input ref={replaceRef} type="file" style={{ display: 'none' }} onChange={onReplacePicked} />
            </div>
          </>
        ) : (
          <div className="nb-empty">{tr('nb.empty')}</div>
        )}
      </div>

      {exportPop && (
        <>
          <div className="nb-pop-backdrop" onClick={() => setExportPop(null)} />
          <div className="nb-menu" style={{ top: exportPop.top, left: exportPop.left }}>
            <div className="nb-mi" onClick={exportBrowser}><Icon name="printer" />{tr('nb.export_browser')}</div>
            <div className="nb-mi" onClick={exportMarkdown}><Icon name="file" />{tr('nb.export_md')}</div>
          </div>
        </>
      )}
      {menu && <CardMenu note={menu.note} pos={{ top: menu.top, left: menu.left }} sections={sections}
        allLabels={window.NB ? window.NB.allLabels() : []} initialSub={menu.initialSub}
        onClose={() => setMenu(null)} onAction={menuAction} />}
      {datePop && <DatePicker pos={datePop} onClose={() => setDatePop(null)} onPick={pickDate} onPickTime={pickTime}
        curDate={cur ? (cur.due_date || '') : ''} curTime={cur ? (cur.due_time || '') : ''} />}
      {secMenu && <SectionMenu pos={secMenu} onClose={() => setSecMenu(null)} curColor={secColors[secMenu.name]}
        onNewNote={() => { const nm = secMenu.name; setSecMenu(null); newNoteInSection(nm); }}
        onEdit={() => { setRenamingSec(secMenu.name); setSecMenu(null); }}
        onAddAbove={() => { const nm = secMenu.name; setSecMenu(null); startAddSection(addAfterFor(nm, 'above')); }}
        onAddBelow={() => { const nm = secMenu.name; setSecMenu(null); startAddSection(nm); }}
        onUp={() => { const nm = secMenu.name; setSecMenu(null); window.NB.moveSection(nm, 'up').catch(() => {}); }}
        onDown={() => { const nm = secMenu.name; setSecMenu(null); window.NB.moveSection(nm, 'down').catch(() => {}); }}
        onSort={(key) => { const nm = secMenu.name; setSecMenu(null); window.NB.sortSection(nm, key).catch(() => {}); }}
        onColor={(c) => { const nm = secMenu.name; setSecMenu(null); applySecColor(nm, c); }}
        onDelete={() => { const nm = secMenu.name; setSecMenu(null); deleteSec(nm); }} />}
    </div>
  );
}

let mounted = false;
window.mountNotebook = function (el) {
  if (mounted) return;
  mounted = true;
  createRoot(el).render(<App />);
};
