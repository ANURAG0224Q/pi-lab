// Pi Lab editor: canvas, library, inspector, wiring, history, projects, checks and the Run loop.
import { PARTS, PART_BY_ID, CATEGORIES, EMULATION, fmtOhm } from './catalog.js';
import { BOARDS, HEADER } from './pi.js';
import { partOf, pinWorld, bbLayout, nearestHoleOffset, rotPt } from './geom.js';
import { Sim } from './sim.js';
import { MODELS, CHIPS } from './devices.js';
import './i2cchips.js';
import './bus.js';
import { compSvg, updateDyn } from './render.js';
import { PyBridge } from './pybridge.js';
import { EXAMPLES } from './examples.js';
import { AudioOut } from './audio.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
// parts whose behaviour is fully emulated are listed; every catalog part has a model
const LIB = PARTS.filter(p => p.kind !== 'pi' && MODELS[p.kind] && (p.kind !== 'i2c' || CHIPS[p.p.chip]));

// ---------------- project state ----------------
const STORE = 'pilab.v1';
let project = null; let sel = null; let wiring = null; let nextId = 1;
const view = { x: 40, y: 40, k: 1 };
const sim = new Sim();
const audio = new AudioOut();
const undo = [], redo = [];
function blank(board = 'pi4') { return { v: 1, name: 'Untitled', board, comps: [{ id: 'pi', part: board, x: 0, y: 0, rot: 0, ctl: {} }], wires: [], code: '# Write Python for your Pi here, then press Run.\nimport RPi.GPIO as GPIO\nimport time\n' }; }
function serial() { return { v: 1, name: project.name, board: project.board, code: $('#code').value, comps: project.comps.map(c => ({ id: c.id, part: c.part, x: c.x, y: c.y, rot: c.rot || 0, ctl: { ...(c.ctl || {}) } })), wires: project.wires.map(w => ({ ...w, pts: (w.pts || []).map(p => [...p]) })) }; }
function validate(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.comps) || !Array.isArray(p.wires)) throw new Error('This file is not a Pi Lab project.');
  if (!BOARDS[p.board]) throw new Error('Unknown board "' + p.board + '".');
  const ids = new Set(); const comps = [];
  for (const c of p.comps) { if (!c || typeof c.id !== 'string' || !PART_BY_ID[c.part] || ids.has(c.id)) continue; ids.add(c.id); comps.push({ id: c.id, part: c.part, x: +c.x || 0, y: +c.y || 0, rot: [0, 90, 180, 270].includes(c.rot) ? c.rot : 0, ctl: c.ctl && typeof c.ctl === 'object' ? { ...c.ctl } : {} }); }
  if (!comps.some(c => partOf(c).kind === 'pi')) comps.unshift({ id: 'pi', part: p.board, x: 0, y: 0, rot: 0, ctl: {} });
  const pi = comps.find(c => partOf(c).kind === 'pi'); pi.part = p.board;
  const okEnd = (e) => { if (typeof e !== 'string') return false; const i = e.indexOf('.'); const c = comps.find(x => x.id === e.slice(0, i)); if (!c) return false; const part = partOf(c), n = e.slice(i + 1); return part.kind === 'breadboard' ? bbLayout(part).holes.some(h => h.n === n) : part.pins.some(q => q.n === n); };
  const wires = p.wires.filter(w => w && okEnd(w.a) && okEnd(w.b) && w.a !== w.b).map((w, i) => ({ id: typeof w.id === 'string' ? w.id : 'w' + i, a: w.a, b: w.b, color: typeof w.color === 'string' ? w.color : '#22c55e', pts: Array.isArray(w.pts) ? w.pts.filter(q => Array.isArray(q) && q.length === 2).map(q => [+q[0], +q[1]]) : [] }));
  return { v: 1, name: typeof p.name === 'string' ? p.name.slice(0, 80) : 'Untitled', board: p.board, code: typeof p.code === 'string' ? p.code : '', comps, wires };
}
function load(p, keepHistory = false) {
  if (bridge && bridge.state === 'running') bridge.stop();
  project = validate(p);
  for (const c of project.comps) c.st = {};
  nextId = 1 + Math.max(0, ...project.comps.concat(project.wires).map(o => +(String(o.id).match(/(\d+)$/) || [0, 0])[1]));
  sim.resetGpio(); sim.setProject(project); sim.update('load');
  $('#board').value = project.board; $('#code').value = project.code; codeChanged();
  sel = null; wiring = null; if (!keepHistory) { undo.length = 0; redo.length = 0; }
  renderAll(); renderInspector(); updateUndo();
}
function commit(label) { // call BEFORE a change to record the old state
  undo.push(JSON.stringify(serial())); if (undo.length > 120) undo.shift(); redo.length = 0; updateUndo(); scheduleSave();
}
function restore(json) { const keepSel = sel; load(JSON.parse(json), true); if (keepSel && (keepSel.type === 'comp' ? project.comps.some(c => c.id === keepSel.id) : project.wires.some(w => w.id === keepSel.id))) { sel = keepSel; renderSel(); renderInspector(); } }
function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(serial())); restore(undo.pop()); updateUndo(); scheduleSave(); toast('Undone'); }
function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(serial())); restore(redo.pop()); updateUndo(); scheduleSave(); toast('Redone'); }
function updateUndo() { $('#bUndo').disabled = !undo.length; $('#bRedo').disabled = !redo.length; }
let saveT = null;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(STORE + '.autosave', JSON.stringify(serial())); } catch (e) { } }, 400); }
function newId(prefix) { for (let n = 1; ; n++) { const id = prefix + n; if (!project.comps.some(c => c.id === id) && !project.wires.some(w => w.id === id)) return id; } }

// ---------------- library ----------------
let libCat = 'All', libShown = 60;
function norm(s) { return s.toLowerCase().replace(/ω/g, 'ohm').replace(/µ/g, 'u').replace(/[^a-z0-9.+]/g, ' '); }
const SEARCH = LIB.map(p => ({ p, s: norm([p.name, p.sub, p.fam, p.cat, p.kind, String(p.tags || ''), (p.specs || []).join(' ')].join(' ')) }));
function searchLib() {
  const raw = $('#q').value.trim(); const q = norm(raw).split(/\s+/).filter(Boolean)
    .map(t => t.replace(/^(\d+(?:\.\d+)?)(k|m)?(ohm|r)?$/, (m0, n, mult, u) => (u || mult) ? n + (mult || '') : m0));
  let res = SEARCH.filter(x => (libCat === 'All' || x.p.cat === libCat) && q.every(t => x.s.includes(t)));
  if (raw) { const lr = norm(raw); res.sort((a, b) => (b.s.startsWith(lr) - a.s.startsWith(lr)) || (norm(a.p.name).includes(lr) ? -1 : 0) - (norm(b.p.name).includes(lr) ? -1 : 0)); }
  return res.map(x => x.p);
}
function renderCats() {
  const counts = {}; for (const p of LIB) counts[p.cat] = (counts[p.cat] || 0) + 1;
  $('#cats').innerHTML = ['All', ...CATEGORIES.filter(c => counts[c])].map(c => `<button class="chip${c === libCat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}${c === 'All' ? '' : ' <span>' + counts[c] + '</span>'}</button>`).join('');
}
function renderLib() {
  const res = searchLib(); const shown = res.slice(0, libShown);
  $('#libCount').textContent = `${res.length} of ${LIB.length} parts${libCat !== 'All' ? ' in ' + libCat : ''}`;
  $('#libList').innerHTML = shown.map(p => `<div class="item" data-id="${esc(p.id)}" draggable="true"><div class="iname">${esc(p.name)}</div><div class="isub">${esc(p.sub || p.fam)}</div><button class="add" data-add="${esc(p.id)}" aria-label="Add ${esc(p.name)}">+</button></div>`).join('')
    + (res.length > shown.length ? `<button class="btn more" id="libMore">Show ${Math.min(60, res.length - shown.length)} more</button>` : '')
    + (!res.length ? '<div class="muted empty">No parts match. Try “LED”, “10k”, “BME280” or a category.</div>' : '');
}
$('#q').addEventListener('input', () => { libShown = 60; renderLib(); });
$('#cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; libCat = b.dataset.cat; libShown = 60; renderCats(); renderLib(); });
$('#libList').addEventListener('click', (e) => {
  if (e.target.id === 'libMore') { libShown += 60; renderLib(); return; }
  const it = e.target.closest('.item'); if (!it) return;
  if (e.target.closest('[data-add]') || isMobile()) { addPart(it.dataset.id); if (isMobile()) showSheet(null); }
  else showPartInfo(it.dataset.id);
});
$('#libList').addEventListener('dblclick', (e) => { const it = e.target.closest('.item'); if (it) addPart(it.dataset.id); });
$('#libList').addEventListener('dragstart', (e) => { const it = e.target.closest('.item'); if (it) e.dataTransfer.setData('text/pilab-part', it.dataset.id); });
$('#svg').addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/pilab-part')) e.preventDefault(); });
$('#svg').addEventListener('drop', (e) => { const id = e.dataTransfer.getData('text/pilab-part'); if (!id) return; e.preventDefault(); const [x, y] = toWorld(e.clientX, e.clientY); addPart(id, x, y); });
function showPartInfo(id) { // a library click previews the part in the inspector without adding it
  const p = PART_BY_ID[id]; sel = null; renderSel(); showTab('inspect');
  $('#pInspect').innerHTML = `<div class="ihead"><div><div class="iname big">${esc(p.name)}</div><div class="muted">${esc(p.sub || '')} · ${esc(p.cat)}</div></div></div>
    <button class="btn run wide" data-addnow="${esc(id)}">+ Add to circuit</button>
    <h4>Specs</h4><ul class="specs">${(p.specs || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    <h4>Pins</h4><div class="pins">${p.kind === 'breadboard' ? 'Holes a–j in 5-hole strips' + (p.p.rails ? ' plus power rails' : '') : p.pins.map(q => `<span class="pinchip">${esc(q.n)}</span>`).join('')}</div>
    <h4>In the simulator</h4><p class="small">${esc(EMULATION[p.kind] || '')}</p>`;
}
$('#pInspect').addEventListener('click', (e) => { const b = e.target.closest('[data-addnow]'); if (b) addPart(b.dataset.addnow); });

// ---------------- canvas ----------------
const svg = $('#svg'), world = $('#world');
const L = { boards: $('#lBoards'), comps: $('#lComps'), wires: $('#lWires'), over: $('#lOver') };
const els = new Map(); // comp id -> <g>
function applyView() { world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`); svg.classList.toggle('far', view.k < 0.6); }
function toWorld(cx, cy) { const r = svg.getBoundingClientRect(); return [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k]; }
function endPos(key) {
  const i = key.indexOf('.'); const c = project.comps.find(x => x.id === key.slice(0, i)); if (!c) return null; const part = partOf(c), n = key.slice(i + 1);
  if (part.kind === 'breadboard') { const h = bbLayout(part).holes.find(h => h.n === n); return h ? [c.x + h.x, c.y + h.y] : null; }
  const pin = part.pins.find(q => q.n === n); return pin ? pinWorld(c, pin) : null;
}
function compEl(c) {
  const part = partOf(c); const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'comp k-' + part.kind); g.dataset.id = c.id; g.innerHTML = compSvg(c, part);
  g.setAttribute('transform', `translate(${c.x} ${c.y}) rotate(${c.rot || 0})`);
  return g;
}
function renderAll() {
  for (const k of ['boards', 'comps']) L[k].innerHTML = '';
  els.clear();
  for (const c of project.comps) { const g = compEl(c); els.set(c.id, g); (partOf(c).kind === 'breadboard' ? L.boards : L.comps).appendChild(g); }
  // the Pi sits under everything else so parts dropped on it stay visible
  const pi = project.comps.find(c => partOf(c).kind === 'pi'); if (pi) L.comps.insertBefore(els.get(pi.id), L.comps.firstChild);
  renderWires(); renderSel(); markIssues();
}
function placeComp(c) { const g = els.get(c.id); if (g) g.setAttribute('transform', `translate(${c.x} ${c.y}) rotate(${c.rot || 0})`); }
const WIRE_COLORS = ['#22c55e', '#ef4444', '#111827', '#3b82f6', '#f59e0b', '#a855f7', '#f97316', '#e5e7eb', '#14b8a6', '#ec4899'];
function wirePath(w) {
  const a = endPos(w.a), b = endPos(w.b); if (!a || !b) return null;
  return [a, ...(w.pts || []), b];
}
function renderWires() {
  let s = '';
  for (const w of project.wires) {
    const pts = wirePath(w); if (!pts) continue; const d = pts.map(p => p.join(',')).join(' ');
    const on = sel && sel.type === 'wire' && sel.id === w.id;
    s += `<g class="wire${on ? ' sel' : ''}" data-w="${esc(w.id)}"><polyline class="whit" points="${d}"/><polyline class="wsh" points="${d}"/><polyline class="wln" points="${d}" stroke="${esc(w.color || '#22c55e')}"/>`
      + `<circle class="wend" cx="${pts[0][0]}" cy="${pts[0][1]}" r="2.6" fill="${esc(w.color)}"/><circle class="wend" cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.6" fill="${esc(w.color)}"/>`
      + (on ? (w.pts || []).map((p, i) => `<circle class="bend" data-bend="${i}" cx="${p[0]}" cy="${p[1]}" r="4"/>`).join('') : '') + '</g>';
  }
  L.wires.innerHTML = s; renderWiring();
}
function renderWiring(px, py) {
  let s = '';
  if (wiring) {
    const a = endPos(wiring.from); const pts = [a, ...wiring.pts]; if (px !== undefined) pts.push([px, py]); else if (wiring.last) pts.push(wiring.last);
    s += `<polyline class="wpre" points="${pts.map(p => p.join(',')).join(' ')}" stroke="${wiring.color}"/><circle cx="${a[0]}" cy="${a[1]}" r="6" class="wstart"/>`;
  }
  if (hoverPin) { const p = endPos(hoverPin); if (p) s += `<circle cx="${p[0]}" cy="${p[1]}" r="6.5" class="phover"/>`; }
  L.over.innerHTML = s + (hlOver || '');
}
let hoverPin = null, hlOver = '';
function renderSel() {
  for (const [id, g] of els) g.classList.toggle('sel', !!(sel && sel.type === 'comp' && sel.id === id));
  $$('.wire', L.wires).forEach(g => g.classList.toggle('sel', !!(sel && sel.type === 'wire' && sel.id === g.dataset.w)));
}
function markIssues() {
  const bad = new Map(); for (const i of sim.issues || []) { for (const k of [i.comp, ...(i.also || [])]) { if (!k) continue; const r = bad.get(k.id); if (!r || (r === 'warn' && i.sev === 'error') || r === 'info') bad.set(k.id, i.sev); } }
  for (const [id, g] of els) { const sev = bad.get(id); g.classList.toggle('err', sev === 'error'); g.classList.toggle('warn', sev === 'warn'); const b = g.querySelector('.badge'); if (b) { b.setAttribute('visibility', sev === 'error' || sev === 'warn' ? 'visible' : 'hidden'); const cc = b.querySelector('circle'); if (cc) cc.setAttribute('fill', sev === 'error' ? '#e11d48' : '#f59e0b'); } }
}
function fit() {
  const r = svg.getBoundingClientRect(); if (!r.width) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of project.comps) { const g = els.get(c.id); if (!g) continue; const b = g.getBBox(); const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => { const [rx, ry] = rotPt(x, y, c.rot || 0); return [c.x + rx, c.y + ry]; });
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  for (const w of project.wires) { const pts = wirePath(w); if (pts) for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  if (!isFinite(x0)) return;
  const pad = 24; const k = Math.min(2.2, Math.max(0.25, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  view.k = k; view.x = (r.width - (x1 - x0) * k) / 2 - x0 * k; view.y = (r.height - (y1 - y0) * k) / 2 - y0 * k; applyView();
}
function zoomAt(cx, cy, f) { const r = svg.getBoundingClientRect(); const k = Math.max(0.2, Math.min(5, view.k * f)); const wx = (cx - r.left - view.x) / view.k, wy = (cy - r.top - view.y) / view.k; view.k = k; view.x = cx - r.left - wx * k; view.y = cy - r.top - wy * k; applyView(); }
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
  if (e.ctrlKey || e.metaKey || (mouseWheel && !e.shiftKey)) zoomAt(e.clientX, e.clientY, Math.exp(-(e.deltaMode ? e.deltaY * 30 : e.deltaY) * (e.ctrlKey ? 0.01 : 0.0015)));
  else { view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; view.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; applyView(); }
}, { passive: false });
$('#zIn').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); };
$('#zOut').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); };
$('#bFit').onclick = fit;

function addPart(id, x, y) {
  const part = PART_BY_ID[id]; if (!part) return;
  commit('add');
  if (x === undefined) { const r = svg.getBoundingClientRect(); [x, y] = toWorld(r.left + r.width / 2, r.top + r.height * (isMobile() ? 0.35 : 0.5)); x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; }
  const prefix = { resistor: 'R', capacitor: 'C', led: 'D', diode: 'D', rgbled: 'D', button: 'SW', switch: 'SW', breadboard: 'BB', bjt: 'Q', mosfet: 'Q', pot: 'RV' }[part.kind] || 'U';
  const c = { id: newId(prefix), part: id, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, rot: 0, ctl: {}, st: {} };
  project.comps.push(c);
  const sn = nearestHoleOffset(project, c); if (sn) { c.x += Math.round(sn.dx); c.y += Math.round(sn.dy); }
  sim.setProject(project); renderAll(); select({ type: 'comp', id: c.id }); changed();
  toast(`Added ${part.name}`);
}
function deleteSel() {
  if (!sel) return;
  if (sel.type === 'comp') { const c = project.comps.find(x => x.id === sel.id); if (!c) return; if (partOf(c).kind === 'pi') { toast('The Raspberry Pi stays — switch models with the board menu.'); return; }
    commit('delete'); project.comps = project.comps.filter(x => x !== c); project.wires = project.wires.filter(w => !w.a.startsWith(c.id + '.') && !w.b.startsWith(c.id + '.')); }
  else { commit('delete wire'); project.wires = project.wires.filter(w => w.id !== sel.id); }
  sel = null; sim.setProject(project); renderAll(); renderInspector(); changed();
}
function rotateSel() { if (!sel || sel.type !== 'comp') return; const c = project.comps.find(x => x.id === sel.id); if (!c || partOf(c).kind === 'pi') return; commit('rotate'); c.rot = ((c.rot || 0) + 90) % 360; const sn = nearestHoleOffset(project, c); if (sn) { c.x += Math.round(sn.dx); c.y += Math.round(sn.dy); } placeComp(c); renderWires(); changed(true); }
function duplicateSel() { if (!sel || sel.type !== 'comp') return; const c = project.comps.find(x => x.id === sel.id); if (!c || partOf(c).kind === 'pi') return; addPart(c.part, c.x + 40, c.y + 40); const n = project.comps[project.comps.length - 1]; n.rot = c.rot; n.ctl = { ...c.ctl }; placeComp(n); renderWires(); changed(true); }
function select(s) { sel = s; renderSel(); renderWires(); renderInspector(); if (s && isMobile() && sheet === null) { } }
function changed(topoOnly) { sim.topoDirty = true; sim.update('edit'); scheduleSave(); }

// ---------------- pointer interaction (mouse, pen and touch) ----------------
const ptrs = new Map(); let gest = null;
function allEnds() {
  const out = [];
  for (const c of project.comps) { const part = partOf(c);
    if (part.kind === 'breadboard') { for (const h of bbLayout(part).holes) out.push([c.id + '.' + h.n, c.x + h.x, c.y + h.y, true]); }
    else for (const p of part.pins) { const [x, y] = pinWorld(c, p); out.push([c.id + '.' + p.n, x, y, false]); } }
  return out;
}
function nearestEnd(wx, wy, rad, holeRad = rad) { // component pins win over breadboard holes underneath them
  let best = null;
  for (const [k, x, y, hole] of allEnds()) { const d = Math.hypot(x - wx, y - wy) + (hole ? 2.5 : 0); if (d < (hole ? holeRad + 2.5 : rad) && (!best || d < best.d)) best = { k, d }; }
  return best && best.k;
}
const endLabel = (key) => { const i = key.indexOf('.'); const c = project.comps.find(x => x.id === key.slice(0, i)); if (!c) return key; const part = partOf(c), n = key.slice(i + 1);
  if (part.kind === 'pi') { const row = HEADER[+n.slice(1) - 1]; return `pin ${row[0]} (${row[2] !== null ? 'GPIO' + row[2] : row[1]})`; }
  if (part.kind === 'breadboard') return `${c.id} hole ${n}`; return `${c.id} ${n}`; };
function autoColor(a, b) {
  for (const k of [a, b]) { const i = k.indexOf('.'); const c = project.comps.find(x => x.id === k.slice(0, i)); if (!c || partOf(c).kind !== 'pi') continue; const row = HEADER[+k.slice(i + 2) - 1]; if (row[3] === 'gnd') return '#111827'; if (row[3] === '5v') return '#ef4444'; if (row[3] === '3v3') return '#f97316'; }
  for (const k of [a, b]) { const n = k.slice(k.indexOf('.') + 1); if (/^(GND|VSS|−|-|G|K)$/.test(n) || /^(tn|bn)\d/.test(n)) return '#111827'; if (/^(VCC|VDD|\+|V\+|5V|VIN|tp\d|bp\d)/.test(n)) return '#ef4444'; }
  const used = project.wires.length; return WIRE_COLORS[[0, 3, 4, 5, 8, 9, 6][used % 7]];
}
function startWire(key) { wiring = { from: key, pts: [], color: '#22c55e', last: null }; showHint(`Wiring from ${endLabel(key)} — ${isTouchUI() ? 'tap' : 'click'} a pin or breadboard hole to connect · tap empty space to add a bend`, true); renderWiring(); }
function finishWire(key) {
  const w = wiring; wiring = null; hideHint();
  if (!w || key === w.from) { renderWiring(); return; }
  if (project.wires.some(x => (x.a === w.from && x.b === key) || (x.a === key && x.b === w.from))) { toast('Those two points are already wired'); renderWiring(); return; }
  commit('wire'); const nw = { id: newId('w'), a: w.from, b: key, color: autoColor(w.from, key), pts: w.pts };
  project.wires.push(nw); sim.setProject(project); renderWires(); changed(); select({ type: 'wire', id: nw.id });
  toast(`Wired ${endLabel(w.from)} → ${endLabel(key)}`);
}
function cancelWire() { wiring = null; hideHint(); renderWiring(); }
let lastPointerType = 'mouse'; const isTouchUI = () => lastPointerType === 'touch' || isMobile();
function interactive(t, c) { return t.closest('.cap, .sw, .dipk, .key, .k-pot .knob'); }
svg.addEventListener('pointerdown', (e) => {
  lastPointerType = e.pointerType; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; if (gest && gest.type === 'drag' && gest.moved) endDrag(); releasePress(); gest = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; return; }
  if (ptrs.size > 2) return;
  const t = e.target; const [wx, wy] = toWorld(e.clientX, e.clientY);
  const rad = (e.pointerType === 'touch' ? 16 : 7) / view.k;
  const bend = t.closest('.bend');
  if (bend) { const w = t.closest('.wire'); gest = { type: 'bend', w: w.dataset.w, i: +bend.dataset.bend, moved: false, x0: e.clientX, y0: e.clientY }; e.preventDefault(); return; }
  const g = t.closest('.comp'); const c = g && project.comps.find(x => x.id === g.dataset.id);
  const it = c && interactive(t, c);
  let key = null;
  const pinEl = t.closest('.pin, .hole'); if (pinEl) key = pinEl.dataset.c + '.' + (pinEl.dataset.pin || pinEl.dataset.hole);
  if (!it) { const nk = nearestEnd(wx, wy, rad, e.pointerType === 'touch' ? rad : 3.6); if (nk && (!key || !pinEl.classList.contains('pin') || e.pointerType === 'touch')) key = nk; else if (!nk && pinEl && pinEl.classList.contains('hole')) key = null; }
  if (key && !it) { gest = { type: 'pin', key, x0: e.clientX, y0: e.clientY, moved: false, c, wx, wy };
    if (c && e.pointerType !== 'mouse') gest.lp = setTimeout(() => { if (gest && gest.type === 'pin' && !gest.moved) { gest = { type: 'drag', c, x0: e.clientX, y0: e.clientY, ox: wx - c.x, oy: wy - c.y, moved: false, lp: true }; select({ type: 'comp', id: c.id }); if (navigator.vibrate) navigator.vibrate(15); toast('Drag to move ' + c.id); } }, 450);
    e.preventDefault(); return; }
  if (it) { press(c, it, true); gest = { type: 'press', c, it }; e.preventDefault(); return; }
  if (c) { gest = { type: 'drag', c, x0: e.clientX, y0: e.clientY, ox: wx - c.x, oy: wy - c.y, moved: false };
    if (!(sel && sel.type === 'comp' && sel.id === c.id)) select({ type: 'comp', id: c.id }); e.preventDefault(); return; }
  const w = t.closest('.wire'); if (w && !wiring) { select({ type: 'wire', id: w.dataset.w }); gest = { type: 'pan', x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y, moved: true }; return; }
  gest = { type: 'pan', x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y, moved: false, wx, wy };
});
window.addEventListener('pointermove', (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gest && gest.type === 'pinch' && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; zoomAt(mx, my, d / gest.d); view.x += mx - gest.mx; view.y += my - gest.my; applyView(); gest.d = d; gest.mx = mx; gest.my = my; return; }
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  if (!gest) { if (e.pointerType === 'mouse' && e.target && svg.contains(e.target)) { const k = nearestEnd(wx, wy, 7 / view.k); if (k !== hoverPin || wiring) { hoverPin = k; renderWiring(wiring ? wx : undefined, wy); } svg.style.cursor = k ? 'crosshair' : ''; } return; }
  const dist = Math.hypot(e.clientX - (gest.x0 || 0), e.clientY - (gest.y0 || 0));
  if (gest.type === 'pan') { if (dist > 4) gest.moved = true; if (gest.moved) { view.x = gest.vx + e.clientX - gest.x0; view.y = gest.vy + e.clientY - gest.y0; applyView(); } }
  else if (gest.type === 'drag') { if (!gest.moved && dist > 4) { gest.moved = true; commit('move'); g_dragging(true); }
    if (gest.moved) { const c = gest.c; c.x = Math.round((wx - gest.ox) / 10) * 10; c.y = Math.round((wy - gest.oy) / 10) * 10; placeComp(c); renderWires(); } }
  else if (gest.type === 'pin') { if (dist > 6) { gest.moved = true; clearTimeout(gest.lp); } if (gest.moved) { if (!wiring) startWire(gest.key); hoverPin = nearestEnd(wx, wy, (e.pointerType === 'touch' ? 16 : 7) / view.k); renderWiring(wx, wy); } }
  else if (gest.type === 'bend') { const w = project.wires.find(x => x.id === gest.w); if (!w) return; if (!gest.moved && dist > 3) { gest.moved = true; commit('bend'); } if (gest.moved) { w.pts[gest.i] = [Math.round(wx / 5) * 5, Math.round(wy / 5) * 5]; renderWires(); } }
});
function g_dragging(on) { svg.classList.toggle('dragging', on); }
function endDrag() { const c = gest.c; g_dragging(false); const sn = nearestHoleOffset(project, c); if (sn) { c.x += Math.round(sn.dx); c.y += Math.round(sn.dy); placeComp(c); } sim.setProject(project); renderWires(); changed(); }
function pointerEnd(e) {
  const had = ptrs.delete(e.pointerId); if (!gest) return;
  if (gest.type === 'pinch') { if (ptrs.size === 0) gest = null; return; }
  const g = gest; gest = null; clearTimeout(g.lp); const [wx, wy] = toWorld(e.clientX, e.clientY);
  if (g.type === 'press') { press(g.c, g.it, false); return; }
  if (g.type === 'drag') { if (g.moved) endDrag(); return; }
  if (g.type === 'bend') { if (!g.moved) { const w = project.wires.find(x => x.id === g.w); if (w) { commit('remove bend'); w.pts.splice(g.i, 1); renderWires(); toast('Bend removed'); } } else scheduleSave(); return; }
  if (g.type === 'pin') {
    if (!g.moved) { if (wiring) finishWire(g.key); else startWire(g.key); return; }
    const k = nearestEnd(wx, wy, (e.pointerType === 'touch' ? 16 : 7) / view.k); hoverPin = null;
    if (k && wiring && k !== wiring.from) finishWire(k); else { wiring && (wiring.last = null); renderWiring(); }
    return;
  }
  if (g.type === 'pan' && !g.moved) {
    if (wiring) { wiring.pts.push([Math.round(wx / 5) * 5, Math.round(wy / 5) * 5]); wiring.last = null; renderWiring(); }
    else if (sel) select(null);
  }
}
window.addEventListener('pointerup', pointerEnd); window.addEventListener('pointercancel', pointerEnd);
let pressed = null;
function releasePress() { if (pressed) { press(pressed.c, pressed.it, false); } }
function press(c, it, down) {
  const part = partOf(c), m = MODELS[part.kind];
  if (it.classList.contains('key')) { c.st.keys = c.st.keys || {}; c.st.keys[+it.dataset.k] = down; pressed = down ? { c, it } : null; sim.update('press'); renderInspectorLive(); return; }
  if (it.classList.contains('dipk')) { if (!down) return; c.ctl['s' + it.dataset.i] = !c.ctl['s' + it.dataset.i]; sim.update('ctl'); renderInspector(); scheduleSave(); return; }
  if (it.classList.contains('knob')) { if (!down) return; select({ type: 'comp', id: c.id }); showTab('inspect'); return; }
  const ctrls = (m.controls ? m.controls(part) : []);
  const first = ctrls[0];
  if (!first) return;
  if (first.type === 'momentary') { c.st[first.key] = down; if (m.press) m.press(c, part, down); pressed = down ? { c, it } : null; audio.click(down ? 0.4 : 0.25); sim.update('press'); renderInspectorLive(); return; }
  if (!down) return;
  if (first.type === 'toggle') { c.ctl[first.key] = !(c.ctl[first.key] ?? first.def); }
  else if (first.type === 'select') { const opts = first.options.map(o => o[0]); const cur = c.ctl[first.key] ?? first.def; c.ctl[first.key] = opts[(opts.indexOf(cur) + 1) % opts.length]; }
  audio.click(0.3); sim.update('ctl'); renderInspector(); scheduleSave();
}
window.addEventListener('keydown', (e) => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); toggleRun(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDialog(); return; }
  if (inField) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (e.key === 'Escape') { if (wiring) cancelWire(); else select(null); closeMenu(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
  if (e.key === 'r' || e.key === 'R') { rotateSel(); return; }
});

// ---------------- inspector ----------------
const fmtV = (v) => (Math.abs(v) < 0.005 ? '0 V' : v.toFixed(2) + ' V');
const fmtI = (i) => { const a = Math.abs(i); return a < 1e-6 ? '0 mA' : a < 1e-3 ? (a * 1e6).toFixed(0) + ' µA' : a < 1 ? (a * 1e3).toFixed(a < 0.01 ? 2 : 1) + ' mA' : a.toFixed(2) + ' A'; };
function ctrlList(c, part) { const m = MODELS[part.kind]; return m && m.controls ? m.controls(part) : []; }
function renderInspector() {
  const P = $('#pInspect');
  if (!sel) { P.innerHTML = `<div class="emptyi"><h3>Build a circuit</h3><ol class="small"><li>Find a part in <b>Parts</b> (search or filter) and add it.</li><li>${isTouchUI() ? 'Tap' : 'Click'} a pin, then another pin or a breadboard hole, to run a wire. ${isTouchUI() ? 'Tap' : 'Click'} empty space while wiring to add a bend.</li><li>Drag parts to move them${isTouchUI() ? ' (press and hold to pick up)' : ''}; drop leads into breadboard holes and they connect.</li><li>Write Python in <b>Code</b> and press <b>▶ Run</b>. Or open <b>Examples</b>.</li></ol>
    <p class="small muted">Keys: R rotate · Del delete · Ctrl+Z / Ctrl+Shift+Z undo/redo · Ctrl+D duplicate · Ctrl+Enter run · Esc cancel wire</p></div>`; return; }
  if (sel.type === 'wire') {
    const w = project.wires.find(x => x.id === sel.id); if (!w) { sel = null; return renderInspector(); }
    const a = endPos(w.a); const nodeV = sim.C ? sim.V(project.comps.find(c => c.id === w.a.split('.')[0]), w.a.slice(w.a.indexOf('.') + 1)) : 0;
    P.innerHTML = `<div class="ihead"><div><div class="iname big">Wire ${esc(w.id)}</div><div class="muted small">${esc(endLabel(w.a))} → ${esc(endLabel(w.b))}</div></div></div>
      <div class="readout"><span>Net voltage</span><b id="wireV">${partOf(project.comps.find(c => c.id === w.a.split('.')[0])).kind === 'breadboard' ? '—' : fmtV(nodeV)}</b></div>
      <h4>Colour</h4><div class="swatches">${WIRE_COLORS.map(col => `<button class="sw${col === w.color ? ' on' : ''}" data-col="${col}" style="background:${col}" aria-label="colour ${col}"></button>`).join('')}</div>
      <div class="row"><button class="btn" id="wStraight" ${w.pts && w.pts.length ? '' : 'disabled'}>Remove bends</button><button class="btn danger" id="wDel">Delete wire</button></div>
      <p class="small muted">Drag a bend dot to reshape it; tap a bend dot to remove it.</p>`;
    $$('.swatches .sw', P).forEach(b => b.onclick = () => { commit('colour'); w.color = b.dataset.col; renderWires(); renderInspector(); });
    $('#wDel', P).onclick = deleteSel; $('#wStraight', P).onclick = () => { commit('straighten'); w.pts = []; renderWires(); renderInspector(); };
    return;
  }
  const c = project.comps.find(x => x.id === sel.id); if (!c) { sel = null; return renderInspector(); }
  const part = partOf(c); const isPi = part.kind === 'pi';
  const ctrls = ctrlList(c, part);
  let h = `<div class="ihead"><div><div class="iname big">${esc(c.id)} · ${esc(part.name)}</div><div class="muted small">${esc(part.sub || '')}${part.cat ? ' · ' + esc(part.cat) : ''}</div></div></div>`;
  if (!isPi) h += `<div class="row"><button class="btn" id="iRot">⟳ Rotate</button><button class="btn" id="iDup">Duplicate</button><button class="btn danger" id="iDel">Delete</button></div>`;
  const myIssues = (sim.issues || []).filter(i => i.comp === c);
  if (myIssues.length) h += `<div class="issues">${myIssues.map(i => issueHtml(i)).join('')}</div>`;
  if (ctrls.length) h += `<h4>Controls</h4><div class="ctrls">${ctrls.map(k => ctrlHtml(c, k)).join('')}</div>`;
  h += `<div id="live"></div>`;
  if (isPi) h += piPinTable(c, part);
  else h += `<h4>Pins</h4><div class="pins">${part.kind === 'breadboard' ? '<span class="small muted">Rows a–e and f–j form 5-hole vertical strips; each + and − power rail runs the full length of the board.</span>' : part.pins.map(q => pinChip(c, q)).join('')}</div>`;
  h += `<h4>Specs</h4><ul class="specs">${(part.specs || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
  if (EMULATION[part.kind]) h += `<h4>In the simulator</h4><p class="small">${esc(EMULATION[part.kind])}</p>`;
  P.innerHTML = h;
  if (!isPi) { $('#iRot', P).onclick = rotateSel; $('#iDup', P).onclick = duplicateSel; $('#iDel', P).onclick = deleteSel; }
  bindCtrls(P, c, part, ctrls); renderInspectorLive();
}
function pinChip(c, q) { const n = sim.links(c, q.n); const role = sim.pinRole(c, q.n); return `<span class="pinchip${n > 0 ? ' con' : ''}" title="${n > 0 ? 'connected' : 'not connected'}">${esc(q.n)}${role ? ' <i>' + esc(role) + '</i>' : ''}</span>`; }
function piPinTable(c, part) {
  let h = '<h4>GPIO header</h4><div class="ptable">';
  for (const row of HEADER) { const [phys, name, bcm, role, alt] = row; const g = bcm !== null ? sim.gpio[bcm] : null;
    const st = g ? (g.pwm ? `PWM ${Math.round(g.pwm.freq)}Hz ${Math.round(g.pwm.duty * 100)}%` : g.mode === 'out' ? 'OUT ' + (g.level ? 'HIGH' : 'LOW') : 'IN ' + (sim.levels[bcm] === 2 ? 'float' : sim.levels[bcm] ? 'HIGH' : 'LOW') + (g.pull !== 'off' ? ' ↑↓'.charAt(g.pull === 'up' ? 1 : 2) : '')) : '';
    h += `<div class="prow r-${role}" data-pin="P${phys}"><b>${phys}</b><span>${esc(bcm !== null ? 'GPIO' + bcm : name)}</span><span class="muted">${esc(alt || '')}</span><span class="pst">${esc(st)}</span></div>`; }
  return h + '</div>';
}
function ctrlHtml(c, k) {
  const v = (c.ctl && c.ctl[k.key] !== undefined) ? c.ctl[k.key] : k.def;
  switch (k.type) {
    case 'range': return `<label class="ctl"><span>${esc(k.label)}</span><input type="range" data-k="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}"><output data-o="${k.key}">${fmtCtl(k, v)}</output></label>`;
    case 'toggle': return `<label class="ctl tog"><input type="checkbox" data-k="${k.key}" ${v ? 'checked' : ''}><span>${esc(k.label)}</span></label>`;
    case 'select': return `<label class="ctl"><span>${esc(k.label)}</span><select data-k="${k.key}">${k.options.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
    case 'momentary': return `<button class="btn hold" data-m="${k.key}">${esc(k.label)} <span class="small muted">(hold)</span></button>`;
    case 'action': return `<button class="btn" data-a="${k.key}">${esc(k.label)}</button>`;
    case 'keypad': { const p = partOf(c).p; return `<div class="kp" style="grid-template-columns:repeat(${p.c},1fr)">${p.keys.map((t, i) => `<button class="btn" data-kp="${i}">${esc(t)}</button>`).join('')}</div>`; }
  }
  return '';
}
function fmtCtl(k, v) { if (k.fmt) return k.fmt(+v); const s = +k.step < 0.01 ? (+v).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : +k.step < 1 ? (+v).toFixed(String(k.step).split('.')[1].length) : String(Math.round(+v)); return s + (k.unit ? ' ' + k.unit : ''); }
function bindCtrls(P, c, part, ctrls) {
  const m = MODELS[part.kind]; const byKey = Object.fromEntries(ctrls.map(k => [k.key, k]));
  $$('input[type=range]', P).forEach(inp => inp.addEventListener('input', () => { c.ctl[inp.dataset.k] = +inp.value; $(`[data-o="${inp.dataset.k}"]`, P).textContent = fmtCtl(byKey[inp.dataset.k], inp.value); sim.update('ctl'); scheduleSave(); }));
  $$('input[type=checkbox]', P).forEach(inp => inp.addEventListener('change', () => { c.ctl[inp.dataset.k] = inp.checked; sim.update('ctl'); scheduleSave(); }));
  $$('select', P).forEach(s => s.addEventListener('change', () => { const k = byKey[s.dataset.k]; const o = k.options.find(o => String(o[0]) === s.value); c.ctl[s.dataset.k] = o ? o[0] : s.value; sim.update('ctl'); scheduleSave(); }));
  $$('[data-a]', P).forEach(b => b.addEventListener('click', () => { m.action(c, part, b.dataset.a, sim); audio.click(0.25); sim.update('action'); renderInspectorLive(); }));
  const hold = (el, on, off) => { const dn = (e) => { e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); el.classList.add('down'); on(); }; const up = () => { if (!el.classList.contains('down')) return; el.classList.remove('down'); off(); };
    el.addEventListener('pointerdown', dn); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up); el.addEventListener('contextmenu', (e) => e.preventDefault()); };
  $$('[data-m]', P).forEach(b => hold(b, () => { c.st[b.dataset.m] = true; if (m.press) m.press(c, part, true); audio.click(0.4); sim.update('press'); }, () => { c.st[b.dataset.m] = false; if (m.press) m.press(c, part, false); audio.click(0.25); sim.update('press'); }));
  $$('[data-kp]', P).forEach(b => hold(b, () => { c.st.keys = c.st.keys || {}; c.st.keys[+b.dataset.kp] = true; sim.update('press'); }, () => { c.st.keys[+b.dataset.kp] = false; sim.update('press'); }));
}
function renderInspectorLive() { // readouts that change while running
  if (!sel) return; const box = $('#live');
  if (sel.type === 'wire') { const w = project.wires.find(x => x.id === sel.id); const el = $('#wireV'); if (w && el) { const c = project.comps.find(c => c.id === w.a.split('.')[0]); if (c && partOf(c).kind !== 'breadboard') el.textContent = fmtV(sim.V(c, w.a.slice(w.a.indexOf('.') + 1))); } return; }
  if (!box) return;
  const c = project.comps.find(x => x.id === sel.id); if (!c) return; const part = partOf(c);
  if (part.kind === 'pi') { $$('.prow', $('#pInspect')).forEach(r => { const phys = +r.dataset.pin.slice(1); const row = HEADER[phys - 1]; const bcm = row[2]; if (bcm === null) return; const g = sim.gpio[bcm];
    r.querySelector('.pst').textContent = g.pwm ? `PWM ${Math.round(g.pwm.freq)}Hz ${Math.round(g.pwm.duty * 100)}%` : g.mode === 'out' ? 'OUT ' + (g.level ? 'HIGH' : 'LOW') : 'IN ' + (sim.levels[bcm] === 2 ? 'floating' : sim.levels[bcm] ? 'HIGH' : 'LOW'); });
    const r3 = sim.railCurrents ? sim.railCurrents() : null; box.innerHTML = r3 ? `<div class="readout"><span>3.3V rail</span><b>${fmtI(r3.i3)}</b></div><div class="readout"><span>5V rail</span><b>${fmtI(r3.i5)}</b></div>` : ''; return; }
  const rows = [];
  const pins = part.kind === 'breadboard' ? [] : part.pins;
  for (const q of pins.slice(0, 16)) if (sim.links(c, q.n) > 0) rows.push(`<div class="readout"><span>${esc(q.n)}</span><b>${fmtV(sim.V(c, q.n))}</b></div>`);
  const m = c.m || {};
  if (part.kind === 'led') rows.unshift(`<div class="readout"><span>LED current${c.mdep && c.mdep.i ? ' (PWM avg)' : ''}</span><b>${fmtI(m.i || 0)}</b></div>`);
  if (part.kind === 'resistor' && m.i !== undefined) rows.unshift(`<div class="readout"><span>Current</span><b>${fmtI(m.i)}</b></div><div class="readout"><span>Power</span><b>${((m.p || 0) * 1000).toFixed(1)} mW</b></div>`);
  if (part.kind === 'servo') rows.unshift(`<div class="readout"><span>Pulse</span><b>${c.st.pw ? Math.round(c.st.pw) + ' µs @ ' + Math.round(c.st.freq) + ' Hz' : 'none'}</b></div><div class="readout"><span>Angle</span><b>${c.st.ang !== undefined ? Math.round(c.st.ang) + '°' : '—'}</b></div>`);
  if (part.kind === 'motor') rows.unshift(`<div class="readout"><span>Motor voltage</span><b>${fmtV(m.v || 0)}</b></div>`);
  box.innerHTML = rows.length ? `<h4>Live readings</h4>${rows.join('')}` : '';
}
function issueHtml(i) { return `<div class="issue ${i.sev}" data-comp="${i.comp ? esc(i.comp.id) : ''}"><b>${i.sev === 'error' ? '⛔' : i.sev === 'warn' ? '⚠️' : 'ℹ️'} ${esc(i.msg)}</b>${i.fix ? `<div class="small">${esc(i.fix)}</div>` : ''}${i.also ? `<div class="small">Wired to: ${i.also.map(k => esc(k.id)).join(', ')}</div>` : ''}</div>`; }
function renderChecks() {
  const is = sim.issues || []; const e = is.filter(i => i.sev === 'error').length, w = is.filter(i => i.sev === 'warn').length;
  const n = e + w; $('#chkCount').hidden = !n; $('#chkCount').textContent = n; $('#mChk').hidden = !n; $('#mChk').textContent = n;
  const b = $('#bChecks'); b.classList.toggle('bad', e > 0); b.classList.toggle('meh', !e && w > 0);
  $('#chkIcon').textContent = e ? '⛔' : w ? '⚠️' : '✓'; $('#chkText').textContent = e ? `${e} error${e > 1 ? 's' : ''}` : w ? `${w} warning${w > 1 ? 's' : ''}` : 'All good';
  const order = { error: 0, warn: 1, info: 2 };
  $('#pChecks').innerHTML = is.length ? [...is].sort((a, b) => order[a.sev] - order[b.sev]).map(issueHtml).join('') : '<div class="emptyi"><h3>No problems found</h3><p class="small muted">Pi Lab checks every change for 5V on GPIO pins, LEDs without resistors, shorts, over-current, wrong pin types and unconnected pins.</p></div>';
}
$('#pChecks').addEventListener('click', (e) => { const d = e.target.closest('[data-comp]'); if (!d || !d.dataset.comp) return; select({ type: 'comp', id: d.dataset.comp }); flash(d.dataset.comp); showTab('inspect'); });
$('#pInspect').addEventListener('click', (e) => { const d = e.target.closest('.issue[data-comp]'); if (d) flash(d.dataset.comp); });
function flash(id) { const c = project.comps.find(x => x.id === id); const g = els.get(id); if (!c || !g) return; g.classList.remove('flash'); void g.getBBox(); g.classList.add('flash'); setTimeout(() => g.classList.remove('flash'), 1600);
  const r = svg.getBoundingClientRect(); const b = g.getBBox(); const cx = c.x + b.x + b.width / 2, cy = c.y + b.y + b.height / 2; const sx = view.x + cx * view.k, sy = view.y + cy * view.k; if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) { view.x = r.width / 2 - cx * view.k; view.y = r.height / 2 - cy * view.k; applyView(); } }

// ---------------- tabs, mobile sheet, menus ----------------
function showTab(t) { $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('.tabp').forEach(p => p.classList.toggle('on', p.id === 'p' + t[0].toUpperCase() + t.slice(1))); if (isMobile()) showSheet(t === 'inspect' ? 'inspect' : t); }
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
let sheet = null;
function showSheet(which) {
  sheet = which; document.body.dataset.sheet = which || '';
  $$('#mtabs button').forEach(b => b.classList.toggle('on', b.dataset.m === which));
  if (which === 'inspect' || which === 'code' || which === 'checks') { $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === which)); $$('.tabp').forEach(p => p.classList.toggle('on', p.id === 'p' + which[0].toUpperCase() + which.slice(1))); }
  if (which === 'code') setTimeout(gutterSync, 0);
  if (which === 'console') $('#mtabs [data-m=console]').classList.remove('ping');
}
$('#mtabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; showSheet(sheet === b.dataset.m ? null : b.dataset.m); });
function closeMenu() { $('#menu').hidden = true; }
function openMenu(anchor, items) {
  const m = $('#menu'); m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.html || esc(it.label)}</button>`).join('');
  m.hidden = false; const r = anchor.getBoundingClientRect(); m.style.left = Math.max(6, Math.min(window.innerWidth - m.offsetWidth - 6, r.left)) + 'px'; m.style.top = (r.bottom + 4) + 'px';
  m.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; closeMenu(); items[+b.dataset.i].fn(); };
}
document.addEventListener('pointerdown', (e) => { if (!$('#menu').hidden && !e.target.closest('#menu') && !e.target.closest('#bExamples, #bFile, #bMenu')) closeMenu(); });
const exItems = () => EXAMPLES.map(x => ({ html: `<b>${esc(x.name)}</b><span class="small muted">${esc(x.desc)}</span>`, fn: () => openExample(x) }));
$('#bExamples').onclick = (e) => openMenu(e.currentTarget, exItems());
$('#bMenu').onclick = (e) => openMenu(e.currentTarget, [{ html: '<b>Examples…</b>', fn: () => openMenu($('#bMenu'), exItems()) }, '-', ...fileItems(), '-', { label: 'Fit circuit to screen', fn: fit }]);
function openExample(x) {
  if (project.comps.length > 1 && !confirmReplace()) return;
  commit('example'); load(x.build(), true); setTimeout(fit, 30); showTab('code'); if (isMobile()) showSheet(null);
  toast(`Loaded “${x.name}” — press ▶ Run`); con.sys(`Example loaded: ${x.name}. ${x.desc}`);
}
function confirmReplace() { return window.confirm('Replace the current circuit? (You can Undo, and it is autosaved.)'); }
const fileItems = () => ([
  { label: 'New circuit', fn: () => { if (project.comps.length > 1 && !confirmReplace()) return; commit('new'); load(blank(project.board), true); setTimeout(fit, 30); } },
  { label: 'Save to this browser…', fn: saveDialog },
  { label: 'Open saved…', fn: openDialog },
  '-',
  { label: 'Export project (.json)', fn: exportJson },
  { label: 'Import project (.json)…', fn: () => $('#fileIn').click() },
]);
$('#bFile').onclick = (e) => openMenu(e.currentTarget, fileItems());
function saved() { try { return JSON.parse(localStorage.getItem(STORE + '.projects') || '{}'); } catch (e) { return {}; } }
function modal(html, bind) { $('#mbody').innerHTML = html; $('#modal').hidden = false; bind && bind($('#mbody')); }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
function saveDialog() {
  modal(`<h3>Save to this browser</h3><label class="ctl"><span>Name</span><input id="sName" value="${esc(project.name === 'Untitled' ? '' : project.name)}" placeholder="My circuit" maxlength="60"></label><div class="row"><button class="btn" data-close>Cancel</button><button class="btn run" id="sGo">Save</button></div>`, (b) => {
    const go = () => { const n = $('#sName', b).value.trim() || 'My circuit'; project.name = n; const all = saved(); all[n] = { ...serial(), name: n, saved: Date.now() };
      try { localStorage.setItem(STORE + '.projects', JSON.stringify(all)); closeModal(); toast(`Saved “${n}”`); } catch (e) { $('#mbody').insertAdjacentHTML('beforeend', '<p class="issue error">This browser refused to store it (storage full or private mode). Use Export instead.</p>'); } };
    $('#sGo', b).onclick = go; $('#sName', b).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); setTimeout(() => $('#sName', b).focus(), 50); });
}
function openDialog() {
  const all = saved(); const names = Object.keys(all).sort((a, b) => (all[b].saved || 0) - (all[a].saved || 0));
  modal(`<h3>Saved circuits</h3>${names.length ? '<div class="slist">' + names.map(n => `<div class="srow"><button class="btn sopen" data-n="${esc(n)}"><b>${esc(n)}</b><span class="small muted">${esc(BOARDS[all[n].board] ? BOARDS[all[n].board].name : '')} · ${new Date(all[n].saved || 0).toLocaleString()}</span></button><button class="btn danger sdel" data-n="${esc(n)}" aria-label="Delete ${esc(n)}">✕</button></div>`).join('') + '</div>' : '<p class="muted">Nothing saved yet. Use File → Save to this browser.</p>'}<div class="row"><button class="btn" data-close>Close</button></div>`, (b) => {
    $$('.sopen', b).forEach(x => x.onclick = () => { const p = saved()[x.dataset.n]; if (!p) return; try { commit('open'); load(p, true); closeModal(); setTimeout(fit, 30); toast(`Opened “${x.dataset.n}”`); } catch (e) { alert(e.message); } });
    $$('.sdel', b).forEach(x => x.onclick = () => { if (!confirm(`Delete “${x.dataset.n}”?`)) return; const a = saved(); delete a[x.dataset.n]; localStorage.setItem(STORE + '.projects', JSON.stringify(a)); openDialog(); });
  });
}
function exportJson() {
  const blob = new Blob([JSON.stringify(serial(), null, 1)], { type: 'application/json' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = (project.name || 'circuit').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.pilab.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Exported ' + a.download);
}
$('#fileIn').addEventListener('change', async () => { const f = $('#fileIn').files[0]; $('#fileIn').value = ''; if (!f) return;
  try { const p = JSON.parse(await f.text()); commit('import'); load(p, true); setTimeout(fit, 30); toast(`Imported ${f.name}`); } catch (e) { alert('Could not import ' + f.name + ': ' + e.message); } });
$('#board').innerHTML = Object.values(BOARDS).map(b => `<option value="${b.id}">${esc(b.name.replace('Raspberry ', ''))}</option>`).join('');
$('#board').addEventListener('change', () => { const id = $('#board').value; commit('board'); const pi = project.comps.find(c => partOf(c).kind === 'pi'); project.board = id; pi.part = id;
  // drop wires to header pins that no longer exist (all three boards have the same 40 pins, so none are lost)
  sim.setProject(project); renderAll(); renderInspector(); changed(); toast('Board: ' + BOARDS[id].name + (BOARDS[id].note ? ' — ' + BOARDS[id].note : '')); });
$('#bUndo').onclick = doUndo; $('#bRedo').onclick = doRedo;
let toastT = null;
function toast(s) { const t = $('#toast'); t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }
function showHint(s, cancel) { const h = $('#hint'); h.innerHTML = esc(s) + (cancel ? ' <button class="btn small" id="hCancel">Cancel</button>' : ''); h.hidden = false; if (cancel) $('#hCancel').onclick = cancelWire; }
function hideHint() { $('#hint').hidden = true; }

// ---------------- console ----------------
const con = {
  el: $('#out'), lines: 0, open: null, openCls: null,
  write(s, cls = '') { // streamed text: continue the current line until a newline arrives
    if (!s) return; const atEnd = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 40;
    const parts = s.split('\n');
    parts.forEach((t, i) => {
      if (i > 0) { this.open = null; }
      if (i === parts.length - 1 && t === '') return;
      if (!this.open || this.openCls !== cls) { this.open = document.createElement('div'); if (cls) this.open.className = cls; this.openCls = cls; this.el.appendChild(this.open); if (++this.lines > 2000) { this.el.firstChild.remove(); this.lines--; } }
      this.open.textContent += t;
    });
    if (atEnd) this.el.scrollTop = this.el.scrollHeight;
  },
  out(s) { this.write(s); }, err(s) { this.write(s, 'e'); }, sys(s) { this.open = null; this.write(s + '\n', 's'); this.open = null; },
};
$('#bClear').onclick = () => { con.el.innerHTML = ''; con.lines = 0; con.open = null; };
const ui = {
  out: (s) => con.out(s), err: (s) => { con.err(s); if (isMobile() && sheet !== 'console') { $('#mtabs [data-m=console]').classList.add('ping'); } },
  sys: (s) => con.sys(s),
  status: (kind, s) => { $('#runStatus').textContent = s; $('#runStatus').className = 'small ' + kind; $('#pyState').textContent = s; },
  runState: (st) => { const running = st === 'running' || st === 'starting'; $('#bRun').hidden = running; $('#bStop').hidden = !running; document.body.classList.toggle('running', running); },
  askInput: () => { $('#inForm').hidden = false; if (isMobile()) showSheet('console'); setTimeout(() => $('#inLine').focus(), 30); },
  endInput: () => { $('#inForm').hidden = true; },
  uartTx: () => { },
};
$('#inForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#inLine').value; $('#inLine').value = ''; $('#inForm').hidden = true; bridge.submitInput(v); });
const bridge = new PyBridge(sim, ui);
function toggleRun() { if (bridge.state === 'running' || bridge.state === 'starting') bridge.stop(); else runCode(); }
function runCode() {
  if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) { con.err('Python needs shared memory, which this browser blocked here. Reload once; if it persists, open the site directly in Chrome, Edge, Firefox or Safari (not inside another app’s built-in browser).\n'); return; }
  const errs = (sim.issues || []).filter(i => i.sev === 'error');
  con.sys(`— Running main.py on ${BOARDS[project.board].name}${errs.length ? ` (with ${errs.length} electrical error${errs.length > 1 ? 's' : ''} — see Checks)` : ''} —`);
  if (isMobile()) showSheet('console');
  bridge.run($('#code').value, project.board);
}
$('#bRun').onclick = runCode; $('#bStop').onclick = () => bridge.stop();
$('#bChecks').onclick = () => showTab('checks');

// ---------------- code editor ----------------
const code = $('#code'), gutter = $('#gutter');
function gutterSync() { const n = code.value.split('\n').length; if (gutter.dataset.n !== String(n)) { gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); gutter.dataset.n = n; } gutter.scrollTop = code.scrollTop; }
function codeChanged() { gutterSync(); }
code.addEventListener('input', () => { gutterSync(); scheduleSave(); });
code.addEventListener('scroll', () => { gutter.scrollTop = code.scrollTop; });
code.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart, en = code.selectionEnd; const v = code.value;
    if (s === en && !e.shiftKey) { code.setRangeText('    ', s, en, 'end'); }
    else { const ls = v.lastIndexOf('\n', s - 1) + 1; const block = v.slice(ls, en); const nb = e.shiftKey ? block.replace(/^ {1,4}/gm, '') : block.replace(/^/gm, '    '); code.setRangeText(nb, ls, en, 'select'); }
    gutterSync(); scheduleSave(); }
  else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const s = code.selectionStart; const v = code.value; const ls = v.lastIndexOf('\n', s - 1) + 1; const line = v.slice(ls, s); let ind = (line.match(/^\s*/) || [''])[0]; if (/:\s*(#.*)?$/.test(line)) ind += '    '; code.setRangeText('\n' + ind, s, code.selectionEnd, 'end'); gutterSync(); scheduleSave(); }
});

// ---------------- animation loop ----------------
let lastT = performance.now(), lastIssues = '';
sim.listeners.push(() => {
  const sig = (sim.issues || []).map(i => i.sev + i.msg).join('|');
  if (sig !== lastIssues) { lastIssues = sig; renderChecks(); markIssues(); if (sel && sel.type === 'comp') { const ii = $('#pInspect .issues'); const c = project.comps.find(x => x.id === sel.id); const mine = (sim.issues || []).filter(i => i.comp === c); if (ii || mine.length) renderInspector(); } }
});
function frame(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  try { sim.tick(dt); } catch (e) { console.error(e); }
  for (const c of project.comps) { const g = els.get(c.id); if (!g) continue; try { updateDyn(c, partOf(c), g, dt, sim); } catch (e) { console.error(e); } }
  audio.update(project, sim);
  frame.n = (frame.n || 0) + 1; if (frame.n % 6 === 0) renderInspectorLive();
  requestAnimationFrame(frame);
}

// ---------------- start ----------------
renderCats(); renderLib();
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true, capture: true });
window.addEventListener('resize', () => { if (!isMobile()) { document.body.dataset.sheet = ''; sheet = null; } });
(function init() {
  let p = null;
  const params = new URLSearchParams(location.search);
  const ex = params.get('example');
  try { if (!ex) p = JSON.parse(localStorage.getItem(STORE + '.autosave') || 'null'); } catch (e) { p = null; }
  try { if (p) load(p); } catch (e) { p = null; }
  if (!p) { const x = EXAMPLES.find(e => e.id === ex) || EXAMPLES[0]; load(x.build()); con.sys(`Welcome to Pi Lab. “${x.name}” is loaded — press ▶ Run, or open Examples.`); }
  else con.sys('Welcome back — your last circuit was restored. Examples and File are in the top bar.');
  applyView(); requestAnimationFrame(() => { fit(); requestAnimationFrame(frame); });
  setTimeout(() => { if (!self.crossOriginIsolated) con.err('Python is not available on this page load (no cross-origin isolation). Reload once; circuits and checks work regardless.\n'); }, 4000);
  window.__pilab = { sim, project: () => project, bridge, load, serial, select, addPart, fit, finishWire, startWire, EXAMPLES };
})();
