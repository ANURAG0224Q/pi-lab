// Geometry shared by the simulator and the editor: pin positions, breadboard holes, Pi header.
import { PART_BY_ID } from './catalog.js';
import { HEADER, BOARDS } from './pi.js';

export const PITCH = 10;
// Pi boards as parts. Header: 20 columns, odd pins on the inner row (y=10), even pins on the edge row (y=0).
for (const b of Object.values(BOARDS)) {
  const hx = b.id === 'zero2w' ? 33 : 38, hy = 8;
  PART_BY_ID[b.id] = {
    id: b.id, name: b.name, kind: 'pi', cat: 'Board', fam: 'Raspberry Pi', p: { board: b.id }, bb: false,
    pins: HEADER.map(([phys]) => ({ n: 'P' + phys, x: hx + Math.floor((phys - 1) / 2) * PITCH, y: hy + (phys % 2 === 1 ? PITCH : 0) })),
    body: { x: 0, y: 0, w: b.w, h: b.h, color: b.pcb }, specs: [b.soc], board: b,
  };
}
const bbCache = {};
export function bbLayout(part) {
  if (bbCache[part.id]) return bbCache[part.id];
  const { cols, rails } = part.p;
  const holes = []; const strips = [];
  const X = (c) => 20 + (c - 1) * PITCH;
  const top = rails ? 45 : 15;
  const rowsTop = 'abcde', rowsBot = 'fghij';
  for (let c = 1; c <= cols; c++) {
    const s1 = [], s2 = [];
    for (let r = 0; r < 5; r++) { const n = rowsTop[r] + c; holes.push({ n, x: X(c), y: top + r * PITCH }); s1.push(n); }
    for (let r = 0; r < 5; r++) { const n = rowsBot[r] + c; holes.push({ n, x: X(c), y: top + 70 + r * PITCH }); s2.push(n); }
    strips.push(s1, s2);
  }
  let h = top + 70 + 40 + 15;
  if (rails) {
    const railY = { tp: 15, tn: 25, bn: top + 70 + 40 + 20, bp: top + 70 + 40 + 30 };
    h = railY.bp + 15;
    for (const [rk, y] of Object.entries(railY)) {
      const s = [];
      for (let c = 1; c <= cols; c++) { if (c % 6 === 0) continue; const n = rk + c; holes.push({ n, x: X(c), y }); s.push(n); }
      strips.push(s);
    }
    bbCache[part.id] = { holes, strips, w: X(cols) + 20, h, railY, top };
  } else bbCache[part.id] = { holes, strips, w: X(cols) + 20, h, railY: null, top };
  return bbCache[part.id];
}
export function rotPt(x, y, rot) {
  switch (((rot % 360) + 360) % 360) { case 90: return [-y, x]; case 180: return [-x, -y]; case 270: return [y, -x]; default: return [x, y]; }
}
export function partOf(c) { return PART_BY_ID[c.part]; }
export function pinWorld(c, pin) { const [x, y] = rotPt(pin.x, pin.y, c.rot || 0); return [c.x + x, c.y + y]; }
export function pinByName(part, n) { return part.pins.find(p => p.n === n); }
// Which breadboard hole (if any) each component pin is sitting in
export function computeInsertions(project) {
  const boards = project.comps.filter(c => partOf(c) && partOf(c).kind === 'breadboard');
  const map = {};
  const holeIndex = [];
  for (const b of boards) { const L = bbLayout(partOf(b)); for (const h of L.holes) holeIndex.push({ key: b.id + '.' + h.n, x: b.x + h.x, y: b.y + h.y }); }
  if (!holeIndex.length) return map;
  const grid = new Map();
  for (const h of holeIndex) grid.set(Math.round(h.x) + ',' + Math.round(h.y), h);
  for (const c of project.comps) {
    const part = partOf(c); if (!part || !part.bb || part.kind === 'breadboard') continue;
    for (const pin of part.pins) {
      const [x, y] = pinWorld(c, pin);
      let found = null;
      for (let dx = -1; dx <= 1 && !found; dx++) for (let dy = -1; dy <= 1 && !found; dy++) found = grid.get((Math.round(x) + dx) + ',' + (Math.round(y) + dy));
      if (found) map[c.id + '.' + pin.n] = found.key;
    }
  }
  return map;
}
export function nearestHoleOffset(project, c) { // snap offset so that the component's pins land in breadboard holes
  const part = partOf(c); if (!part || !part.bb) return null;
  const boards = project.comps.filter(b => partOf(b) && partOf(b).kind === 'breadboard');
  let best = null;
  for (const pin of part.pins) {
    const [x, y] = pinWorld(c, pin);
    for (const b of boards) {
      const L = bbLayout(partOf(b));
      if (x < b.x - 10 || y < b.y - 10 || x > b.x + L.w + 10 || y > b.y + L.h + 10) continue;
      for (const h of L.holes) { const dx = b.x + h.x - x, dy = b.y + h.y - y; const d = dx * dx + dy * dy; if (d < 64 && (!best || d < best.d)) best = { d, dx, dy }; }
    }
  }
  return best;
}
