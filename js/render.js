// SVG rendering of the Pi, breadboard and parts, plus per-frame dynamic updates.
import { bbLayout, partOf } from './geom.js';
import { HEADER } from './pi.js';
import { FONT } from './chips.js';
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const ROLE_COL = { '3v3': '#f39c34', '5v': '#e53935', gnd: '#2b2b2b', gpio: '#2bb673' };
function pinCol(row) { const [phys, name, bcm, role, alt] = row; if (role !== 'gpio') return ROLE_COL[role]; if (/I2C/.test(alt)) return '#3b82f6'; if (/SPI/.test(alt)) return '#a855f7'; if (/UART/.test(alt)) return '#ec4899'; if (/PWM/.test(alt)) return '#14b8a6'; return ROLE_COL.gpio; }
export function pinsSvg(c, part, opts = {}) {
  let s = '';
  for (const p of part.pins) {
    s += `<g class="pin" data-c="${c.id}" data-pin="${esc(p.n)}"><circle class="pin-hit" cx="${p.x}" cy="${p.y}" r="5.5"/><rect class="pin-dot" x="${p.x - 2.6}" y="${p.y - 2.6}" width="5.2" height="5.2" rx="1"/></g>`;
  }
  return s;
}
function piSvg(c, part) {
  const b = part.board, w = b.w, h = b.h; const hx = part.pins[0].x, hy = part.pins[1].y;
  let s = `<rect class="body" x="0" y="0" width="${w}" height="${h}" rx="12" fill="${b.pcb}" stroke="#0d3d1f" stroke-width="1.5"/>`;
  for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) if (!(b.id === 'zero2w' && false)) s += `<circle cx="${x}" cy="${y}" r="5.5" fill="#c9b37a" stroke="#8a7a4a"/><circle cx="${x}" cy="${y}" r="3" fill="#0e0e0e"/>`;
  // header shroud
  s += `<rect x="${hx - 6}" y="${hy - 6}" width="${19 * 10 + 12}" height="22" rx="2" fill="#151515"/>`;
  if (b.id === 'zero2w') {
    s += `<rect x="${w / 2 - 22}" y="${h / 2 - 20}" width="44" height="40" rx="3" fill="#2d2d2d"/><text x="${w / 2}" y="${h / 2 + 3}" class="chiptxt">RP3A0</text>`;
    s += `<rect x="${w - 46}" y="${h - 14}" width="22" height="14" fill="#aaa"/><rect x="${w - 80}" y="${h - 14}" width="22" height="14" fill="#aaa"/><rect x="40" y="${h - 14}" width="30" height="14" fill="#aaa"/>`;
  } else {
    s += `<rect x="${w * 0.36}" y="${h * 0.38}" width="58" height="58" rx="4" fill="#cfd3d6" stroke="#9aa"/><text x="${w * 0.36 + 29}" y="${h * 0.38 + 33}" class="chiptxt dark">${b.soc.split(' ')[0]}</text>`;
    s += `<rect x="${w - 64}" y="${30}" width="64" height="50" fill="#b9c0c6" stroke="#889"/><rect x="${w - 64}" y="${92}" width="64" height="50" fill="#b9c0c6" stroke="#889"/><rect x="${w - 70}" y="${154}" width="70" height="56" fill="#c8ccd0" stroke="#889"/>`;
    s += `<rect x="30" y="${h - 12}" width="34" height="14" rx="3" fill="#aab"/><rect x="90" y="${h - 10}" width="22" height="12" fill="#aab"/><rect x="128" y="${h - 10}" width="22" height="12" fill="#aab"/>`;
    if (b.id === 'pi5') s += `<rect x="${w * 0.36 + 70}" y="${h * 0.38 + 6}" width="34" height="34" rx="3" fill="#2d2d2d"/><text x="${w * 0.36 + 87}" y="${h * 0.38 + 27}" class="chiptxt">RP1</text>`;
  }
  s += `<text x="${18}" y="${h - 22}" class="boardname">${esc(b.name)}</text>`;
  // header pins with role colours + labels
  for (let i = 0; i < 40; i++) {
    const row = HEADER[i], p = part.pins[i];
    const lab = row[2] !== null ? String(row[2]) : row[1].replace('3V3', '3.3').replace('GND', 'G');
    const above = row[0] % 2 === 0;
    s += `<text x="${p.x}" y="${above ? p.y - 8 : p.y + 14}" class="hdrlab" fill="${pinCol(row)}">${lab}</text>`;
  }
  s += `<text x="${hx - 12}" y="${hy + 13}" class="hdrlab" fill="#fff">1</text>`;
  let pins = '';
  for (let i = 0; i < 40; i++) { const p = part.pins[i]; const col = pinCol(HEADER[i]);
    pins += `<g class="pin" data-c="${c.id}" data-pin="${p.n}"><circle class="pin-hit" cx="${p.x}" cy="${p.y}" r="5.5"/><rect x="${p.x - 3.3}" y="${p.y - 3.3}" width="6.6" height="6.6" rx="${i === 0 ? 0 : 3.3}" fill="${col}" stroke="#d4af37" stroke-width="1.2"/></g>`; }
  return s + pins;
}
function bbSvg(c, part) {
  const L = bbLayout(part);
  let s = `<rect class="body" x="0" y="0" width="${L.w}" height="${L.h}" rx="6" fill="#f4f1e8" stroke="#cfc8b4"/>`;
  if (L.railY) {
    const { tp, tn, bn, bp } = L.railY;
    s += `<line x1="12" x2="${L.w - 12}" y1="${tp - 7}" y2="${tp - 7}" stroke="#e53935" stroke-width="1.2"/><line x1="12" x2="${L.w - 12}" y1="${tn + 7}" y2="${tn + 7}" stroke="#1e63d6" stroke-width="1.2"/>`;
    s += `<line x1="12" x2="${L.w - 12}" y1="${bn - 7}" y2="${bn - 7}" stroke="#1e63d6" stroke-width="1.2"/><line x1="12" x2="${L.w - 12}" y1="${bp + 7}" y2="${bp + 7}" stroke="#e53935" stroke-width="1.2"/>`;
    s += `<text x="6" y="${tp + 3}" class="bbtxt red">+</text><text x="6" y="${tn + 3}" class="bbtxt blue">−</text><text x="6" y="${bn + 3}" class="bbtxt blue">−</text><text x="6" y="${bp + 3}" class="bbtxt red">+</text>`;
  }
  s += `<rect x="8" y="${L.top + 45}" width="${L.w - 16}" height="10" fill="#e6e1d2"/>`;
  'abcdefghij'.split('').forEach((r, i) => { const y = L.top + (i < 5 ? i * 10 : 70 + (i - 5) * 10); s += `<text x="9" y="${y + 3}" class="bbtxt">${r}</text>`; });
  const cols = part.p.cols;
  for (let k = 1; k <= cols; k++) if (k === 1 || k % 5 === 0) s += `<text x="${20 + (k - 1) * 10}" y="${L.top - 5}" class="bbtxt num">${k}</text>`;
  let holes = '';
  for (const h of L.holes) holes += `<rect class="hole" data-c="${c.id}" data-hole="${h.n}" x="${h.x - 2.6}" y="${h.y - 2.6}" width="5.2" height="5.2" rx="0.8"/>`;
  return s + holes;
}
const BANDS = ['#000', '#7b3f00', '#e00', '#f80', '#ee0', '#090', '#00c', '#80c', '#888', '#fff'];
function resBands(r, tol) {
  let e = Math.floor(Math.log10(r) + 1e-9) - 1; let d = Math.round(r / Math.pow(10, e)); if (d >= 100) { d = Math.round(d / 10); e++; }
  const cols = [BANDS[Math.floor(d / 10)], BANDS[d % 10], e >= 0 ? BANDS[e] : e === -1 ? '#d4af37' : '#c0c0c0'];
  cols.push(tol === 1 ? '#7b3f00' : '#d4af37');
  return cols;
}
export function compSvg(c, part) {
  if (part.kind === 'pi') return piSvg(c, part);
  if (part.kind === 'breadboard') return bbSvg(c, part);
  const k = part.kind, p = part.p;
  let s = '';
  switch (k) {
    case 'resistor': { const bands = resBands(p.ohms, p.tol); s += `<line x1="0" y1="0" x2="40" y2="0" class="leg"/><rect class="body" x="9" y="-4.5" width="22" height="9" rx="4" fill="${p.body}" stroke="#8a7550" stroke-width=".6"/>`;
      bands.forEach((b, i) => { s += `<rect x="${12 + i * 4.2 + (i === 3 ? 2 : 0)}" y="-4.5" width="2.2" height="9" fill="${b}"/>`; }); break; }
    case 'capacitor': if (p.polar) { const r = Math.min(9, 4 + Math.log10(p.farads * 1e6 + 1) * 1.6); s += `<line x1="0" y1="0" x2="0" y2="-6" class="leg"/><line x1="10" y1="0" x2="10" y2="-6" class="leg"/><rect class="body" x="${5 - r}" y="${-6 - r * 2.4}" width="${r * 2}" height="${r * 2.4}" rx="2" fill="#1d3f8f" stroke="#0b1f4a"/><rect x="${5 + r - 3}" y="${-6 - r * 2.4}" width="3" height="${r * 2.4}" fill="#cfd8ea"/><text x="5" y="${-6 - r * 1.2}" class="tiny light">${p.volts}V</text>`; }
      else s += `<line x1="0" y1="0" x2="2" y2="-5" class="leg"/><line x1="10" y1="0" x2="8" y2="-5" class="leg"/><ellipse class="body" cx="5" cy="-8" rx="6" ry="5" fill="#e3a63b" stroke="#9a6b16"/>`; break;
    case 'diode': s += `<line x1="0" y1="0" x2="40" y2="0" class="leg"/><rect class="body" x="11" y="-3.5" width="18" height="7" rx="1.5" fill="${p.vz ? '#c97a2b' : p.vf < 0.4 ? '#222' : '#1a1a1a'}"/><rect x="25" y="-3.5" width="2.5" height="7" fill="#ddd"/>`; break;
    case 'led': { const col = p.hex, r = p.size === 10 ? 9 : p.size === 3 ? 4.5 : 6;
      if (p.laser) { s += `<rect class="body" x="-6" y="-26" width="22" height="22" rx="2" fill="#222"/><rect x="0" y="-36" width="10" height="12" fill="#c0c0c0"/><circle cx="5" cy="-37" r="2.5" class="glow" fill="${col}" opacity="0"/>`; break; }
      s += `<line x1="0" y1="0" x2="0" y2="-6" class="leg"/><line x1="10" y1="0" x2="10" y2="-4" class="leg"/>`;
      s += `<circle class="glowhalo" cx="5" cy="${-8 - r}" r="${r * 2.6}" fill="${col}" opacity="0"/>`;
      s += `<path class="body" d="M${5 - r} -6 L${5 - r} ${-6 - r} A${r} ${r} 0 0 1 ${5 + r} ${-6 - r} L${5 + r} -6 Z" fill="${col}" fill-opacity="${p.lens === 'water-clear' ? 0.35 : 0.55}" stroke="${col}" stroke-opacity=".9"/>`;
      s += `<path class="glow" d="M${5 - r} -6 L${5 - r} ${-6 - r} A${r} ${r} 0 0 1 ${5 + r} ${-6 - r} L${5 + r} -6 Z" fill="${col}" opacity="0"/><rect x="${4 - r}" y="-7" width="${2 * r + 2}" height="2" fill="${col}" opacity=".7"/>`; break; }
    case 'rgbled': s += `<line x1="0" y1="0" x2="0" y2="-6" class="leg"/><line x1="10" y1="0" x2="10" y2="-6" class="leg"/><line x1="20" y1="0" x2="20" y2="-6" class="leg"/><line x1="30" y1="0" x2="30" y2="-6" class="leg"/>
      <circle class="glowhalo" cx="15" cy="-16" r="20" fill="#fff" opacity="0"/><path class="body" d="M7 -6 L7 -16 A8 8 0 0 1 23 -16 L23 -6 Z" fill="#eef" fill-opacity=".5" stroke="#bbc"/><path class="glow" d="M7 -6 L7 -16 A8 8 0 0 1 23 -16 L23 -6 Z" fill="#000" opacity="0"/>`; break;
    case 'button': if (p.module) { s += moduleBody(c, part); s += `<rect x="1" y="-34" width="18" height="18" rx="2" fill="#bbb"/><circle class="cap" cx="10" cy="-25" r="6" fill="${p.cap}"/>`; break; }
      if (p.two && p.size === 30) { s += `<line x1="0" y1="0" x2="0" y2="-8" class="leg"/><line x1="20" y1="0" x2="20" y2="-8" class="leg"/><circle class="body" cx="10" cy="-24" r="17" fill="#333"/><circle class="cap" cx="10" cy="-24" r="13" fill="${p.cap}"/>`; break; }
      if (p.two) { s += `<rect class="body" x="0" y="-12" width="20" height="12" rx="1" fill="#2a2a2a"/><circle class="cap" cx="10" cy="-6" r="4" fill="${p.cap}"/>`; break; }
      { const sz = p.size === 12 ? 14 : 9; s += `<rect class="body" x="${10 - sz}" y="${15 - sz}" width="${sz * 2}" height="${sz * 2}" rx="2" fill="#2a2a2a" stroke="#555"/><circle class="cap" cx="10" cy="15" r="${sz * 0.62}" fill="${p.cap}" stroke="#000" stroke-opacity=".3"/>`; } break;
    case 'switch': s += switchSvg(c, part); break;
    case 'dip': { const n = p.n; s += `<rect class="body" x="-5" y="4" width="${n * 10}" height="22" rx="1" fill="#c62828"/>`; for (let i = 0; i < n; i++) s += `<rect x="${i * 10 - 2.5}" y="8" width="5" height="14" fill="#fff"/><rect class="dipk" data-i="${i + 1}" x="${i * 10 - 2.5}" y="15" width="5" height="7" fill="#444"/>`; break; }
    case 'pot': { const big = !p.trim; const cx = p.trim ? 10 : 20, R = p.trim ? 8 : 15; s += `<rect class="body" x="${cx - R - 2}" y="${-R * 2 - 6}" width="${(R + 2) * 2}" height="${R * 2 + 4}" rx="3" fill="${p.trim ? '#2a5fb0' : '#3a3a3a'}"/><circle cx="${cx}" cy="${-R - 4}" r="${R - 2}" fill="${p.trim ? '#eee' : '#666'}" stroke="#222"/><line class="knob" x1="${cx}" y1="${-R - 4}" x2="${cx}" y2="${-2 * R + 1}" stroke="${p.trim ? '#333' : '#fff'}" stroke-width="2.5" stroke-linecap="round" style="transform-origin:${cx}px ${-R - 4}px"/>`; break; }
    case 'ldr': s += `<line x1="0" y1="0" x2="5" y2="-6" class="leg"/><line x1="20" y1="0" x2="15" y2="-6" class="leg"/><circle class="body" cx="10" cy="-10" r="7" fill="#d9a441" stroke="#7a5"/><path d="M5 -13 h10 M5 -10 h10 M5 -7 h10" stroke="#a02020" stroke-width="1"/>`; break;
    case 'ntc': s += `<line x1="0" y1="0" x2="8" y2="-8" class="leg"/><line x1="20" y1="0" x2="12" y2="-8" class="leg"/><circle class="body" cx="10" cy="-12" r="5.5" fill="#1d1d1d"/>`; break;
    case 'fsr': case 'flex': s += `<line x1="0" y1="0" x2="0" y2="-8" class="leg"/><line x1="10" y1="0" x2="10" y2="-8" class="leg"/><rect class="body" x="-2" y="${k === 'flex' ? -70 : -34}" width="14" height="${k === 'flex' ? 62 : 26}" rx="${k === 'flex' ? 2 : 7}" fill="#333" stroke="#777"/>`; break;
    case 'antemp': case 'bjt': case 'mosfet': if (part.big) { s += `<line x1="0" y1="0" x2="0" y2="-8" class="leg"/><line x1="10" y1="0" x2="10" y2="-8" class="leg"/><line x1="20" y1="0" x2="20" y2="-8" class="leg"/><rect class="body" x="-4" y="-34" width="28" height="26" rx="1" fill="#1d1d1d"/><rect x="-4" y="-48" width="28" height="15" rx="2" fill="#bbb"/><circle cx="10" cy="-42" r="3.5" fill="#666"/><text x="10" y="-18" class="tiny light">${esc((part.name.split(' ')[0]))}</text>`; }
      else s += `<line x1="0" y1="0" x2="4" y2="-8" class="leg"/><line x1="10" y1="0" x2="10" y2="-8" class="leg"/><line x1="20" y1="0" x2="16" y2="-8" class="leg"/><path class="body" d="M1 -8 L1 -20 A9 9 0 0 1 19 -20 L19 -8 Z" fill="#1d1d1d"/><text x="10" y="-12" class="tiny light">${esc(part.name.split(' ')[0])}</text>`; break;
    case 'buzzer': if (p.module) { s += moduleBody(c, part); s += `<circle class="bz" cx="${(part.pins.length - 1) * 5}" cy="-26" r="10" fill="#111" stroke="#444"/><circle cx="${(part.pins.length - 1) * 5}" cy="-26" r="2" fill="#444"/>`; break; }
      { const disc = part.id.includes('disc'); const R = disc ? 16 : 12; s += `<line x1="0" y1="0" x2="5" y2="-6" class="leg"/><line x1="30" y1="0" x2="25" y2="-6" class="leg"/><circle class="body bz" cx="15" cy="${-6 - R}" r="${R}" fill="${disc ? '#c9a227' : '#111'}" stroke="#555"/><circle cx="15" cy="${-6 - R}" r="${disc ? 10 : 2.5}" fill="${disc ? '#e8e8e8' : '#333'}"/><text x="3" y="-${2 * R + 2}" class="tiny">+</text>`; } break;
    default: s += specialSvg(c, part);
  }
  s += `<g class="badge" visibility="hidden"><circle cx="${badgePos(part)[0]}" cy="${badgePos(part)[1]}" r="7" fill="#e11d48"/><text x="${badgePos(part)[0]}" y="${badgePos(part)[1] + 3.5}" class="badgetxt">!</text></g>`;
  return s + pinsSvg(c, part);
}

function badgePos(part) { if (part.body) return [part.body.x + part.body.w - 4, part.body.y + 4]; return [part.pins.length > 1 ? part.pins[part.pins.length - 1].x + 6 : 8, -24]; }
function shortName(part) { let n = part.name.replace(/ module| sensor| \(.*?\)/gi, ''); return n.length > 22 ? n.slice(0, 21) + '…' : n; }
export function moduleBody(c, part) {
  const b = part.body; let s = `<rect class="body" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" fill="${b.color}" stroke="#000" stroke-opacity=".35"/>`;
  for (const p of part.pins) s += `<rect x="${p.x - 3.5}" y="${-6}" width="7" height="6" fill="#1a1a1a"/><text x="${p.x}" y="-9" class="pinlab" transform="rotate(-90 ${p.x} -9)">${esc(p.n)}</text>`;
  const labelY = b.y + 11; s += `<text x="${b.x + b.w / 2}" y="${labelY}" class="modlab">${esc(shortName(part))}</text>`;
  if (b.w > 60) s += `<circle class="pwrled" cx="${b.x + b.w - 8}" cy="${b.y + 8}" r="2.4" fill="#300"/>`;
  return s;
}
function switchSvg(c, part) {
  const p = part.p;
  if (part.pins.length === 2 && !p.magnet) return `<rect class="body" x="-4" y="-16" width="${part.pins[1].x + 8}" height="12" rx="2" fill="#333"/><rect class="sw" x="${p.tilt || p.momentary ? 6 : 2}" y="-24" width="8" height="10" rx="1" fill="#ddd"/>`;
  if (p.magnet) return `<line x1="0" y1="0" x2="8" y2="-4" class="leg"/><line x1="40" y1="0" x2="32" y2="-4" class="leg"/><rect class="body" x="6" y="-8" width="28" height="8" rx="4" fill="#cfe8f0" fill-opacity=".7" stroke="#79a"/><line class="reed" x1="10" y1="-4" x2="21" y2="-4" stroke="#b8860b" stroke-width="1.5"/><line x1="30" y1="-4" x2="19" y2="-4" stroke="#b8860b" stroke-width="1.5"/>`;
  return `<rect class="body" x="-4" y="-16" width="28" height="12" rx="2" fill="#333"/><rect class="sw" x="2" y="-22" width="8" height="8" rx="1" fill="#ddd"/>`;
}
function specialSvg(c, part) {
  const k = part.kind, p = part.p;
  if (part.body && !['lcd', 'servo', 'motor', 'stepper', 'load', 'battery', 'keypad', 'ws2812', 'seg7', 'mcpadc', 'sr595', 'relay', 'dht', 'ds18b20'].includes(k) || (k === 'dht' && !p.bare) || (k === 'ds18b20' && p.mod)) {
    let s = moduleBody(c, part); const b = part.body, cx = b.x + b.w / 2, cy = b.y + b.h / 2 + 4;
    switch (k) {
      case 'pir': s += `<circle class="face" cx="${cx}" cy="${cy}" r="${Math.min(b.w, b.h) * 0.3}" fill="#f5f5f0" stroke="#ccc"/><path d="M${cx - 10} ${cy} q10 -10 20 0 M${cx - 10} ${cy + 5} q10 -10 20 0" stroke="#ddd" fill="none"/>`; break;
      case 'ultrasonic': s += `<circle cx="${cx - 26}" cy="${cy}" r="15" fill="#c0c4c8" stroke="#888"/><circle cx="${cx - 26}" cy="${cy}" r="9" fill="#333"/><circle cx="${cx + 26}" cy="${cy}" r="15" fill="#c0c4c8" stroke="#888"/><circle cx="${cx + 26}" cy="${cy}" r="9" fill="#333"/><text x="${cx}" y="${cy + 3}" class="tiny light dist"></text>`; break;
      case 'oled': s += `<rect x="${b.x + 6}" y="${b.y + 16}" width="${b.w - 12}" height="${(b.w - 12) * p.h / p.w}" fill="#050505" stroke="#333"/><image class="screen" x="${b.x + 6}" y="${b.y + 16}" width="${b.w - 12}" height="${(b.w - 12) * p.h / p.w}" style="image-rendering:pixelated"/>`; break;
      case 'tm1637': s += `<rect x="${b.x + 6}" y="${b.y + 16}" width="${b.w - 12}" height="${b.h - 22}" fill="#111"/>` + [0, 1, 2, 3].map(i => segDigit(b.x + 14 + i * 27, b.y + 20, 0.9, `tm${i}`)).join('') + `<circle class="tmcol" cx="${b.x + 66}" cy="${b.y + 30}" r="1.6" fill="#300"/><circle class="tmcol" cx="${b.x + 66}" cy="${b.y + 40}" r="1.6" fill="#300"/>`; break;
      case 'max7219': { const n = p.chain; let g = `<rect x="${b.x + 4}" y="${b.y + 14}" width="${b.w - 8}" height="${b.h - 18}" fill="#111"/>`; const cw = (b.w - 8) / (8 * n); for (let d = 0; d < n; d++) for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) g += `<circle class="mx" data-k="${d},${r},${col}" cx="${b.x + 4 + (d * 8 + col + 0.5) * cw}" cy="${b.y + 14 + (r + 0.5) * (b.h - 18) / 8}" r="${cw * 0.36}" fill="#2a0a0a"/>`; s += g; break; }
      case 'relaymod': for (let i = 0; i < p.ch; i++) { const x = b.x + 8 + i * (b.w - 16) / p.ch; s += `<rect x="${x}" y="${b.y + 18}" width="${(b.w - 16) / p.ch - 6}" height="34" rx="2" fill="#1e5fd8" stroke="#0a2a66"/><text x="${x + 4}" y="${b.y + 38}" class="tiny light">SRD</text><circle class="rled" data-i="${i + 1}" cx="${x + 6}" cy="${b.y + 60}" r="2.6" fill="#300"/><line class="rarm" data-i="${i + 1}" x1="${x + 10}" y1="${b.y + 66}" x2="${x + 24}" y2="${b.y + 60}" stroke="#ddd" stroke-width="1.6"/>`; } break;
      case 'hbridge': s += `<rect x="${cx - 20}" y="${cy - 16}" width="40" height="28" fill="#222"/><text x="${cx}" y="${cy + 2}" class="tiny light">${esc(p.chip)}</text>`; break;
      case 'uln2003': s += `<rect x="${cx - 30}" y="${cy - 14}" width="34" height="20" fill="#222"/><text x="${cx - 13}" y="${cy}" class="tiny light">ULN2003</text>` + [0, 1, 2, 3].map(i => `<circle class="phled" data-i="${i}" cx="${cx + 14 + (i % 2) * 10}" cy="${cy - 8 + Math.floor(i / 2) * 12}" r="3" fill="#300"/>`).join(''); break;
      case 'encoder': s += `<circle cx="${cx}" cy="${cy}" r="14" fill="#999"/><circle cx="${cx}" cy="${cy}" r="9" fill="#ccc" stroke="#777"/><line class="knob" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 9}" stroke="#333" stroke-width="2.5" style="transform-origin:${cx}px ${cy}px"/>`; break;
      case 'joystick': s += `<circle cx="${cx}" cy="${cy}" r="26" fill="#333"/><circle class="stick" cx="${cx}" cy="${cy}" r="14" fill="#555" stroke="#111"/>`; break;
      case 'gps': s += `<rect x="${cx - 22}" y="${cy - 16}" width="44" height="34" fill="#c9a24a" stroke="#7a5"/><circle class="fixled" cx="${b.x + 10}" cy="${b.y + b.h - 10}" r="3" fill="#300"/>`; break;
      case 'rc522': s += `<rect x="${b.x + 10}" y="${b.y + 18}" width="${b.w - 20}" height="${b.h - 30}" rx="6" fill="none" stroke="#c9a24a" stroke-width="3"/><rect class="card" x="${cx - 26}" y="${cy - 34}" width="52" height="34" rx="4" fill="#fff" stroke="#999" opacity="0"/>`; break;
      case 'i2c': s += `<rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" rx="2" fill="#bbb" stroke="#555"/>`; break;
      case 'anamod': if (p.ctl === 'ppm') s += `<circle cx="${cx}" cy="${cy}" r="18" fill="#bbb" stroke="#777"/><circle cx="${cx}" cy="${cy}" r="12" fill="#eee" stroke="#999" stroke-dasharray="2 2"/>`; else s += `<circle class="doled" cx="${b.x + 8}" cy="${b.y + b.h - 10}" r="2.4" fill="#300"/>`; break;
      case 'digimod': s += `<circle cx="${cx}" cy="${cy}" r="6" fill="#222"/><circle class="doled" cx="${b.x + 8}" cy="${b.y + b.h - 10}" r="2.4" fill="#300"/>`; break;
      case 'hx711': s += `<rect x="${cx - 14}" y="${cy - 10}" width="28" height="18" fill="#222"/><text x="${cx}" y="${cy + 2}" class="tiny light">HX711</text>`; break;
      case 'dht': s += `<rect x="${cx - 13}" y="${b.y + 14}" width="26" height="34" rx="2" fill="${p.t === 11 ? '#3a8ad8' : '#f0f0f0'}"/>` + [0, 1, 2, 3, 4].map(i => `<rect x="${cx - 9}" y="${b.y + 18 + i * 6}" width="18" height="3" fill="#000" opacity=".25"/>`).join(''); break;
      case 'ds18b20': s += `<path d="M${cx - 8} ${cy + 6} L${cx - 8} ${cy - 6} A8 8 0 0 1 ${cx + 8} ${cy - 6} L${cx + 8} ${cy + 6} Z" fill="#111"/>`; break;
      default: break;
    }
    return s;
  }
  switch (k) {
    case 'dht': { const b = part.body; let s = `<rect class="body" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h - 4}" rx="2" fill="${b.color}" stroke="#777"/>`; for (let i = 0; i < 6; i++) s += `<rect x="${b.x + 5}" y="${b.y + 8 + i * 9}" width="${b.w - 10}" height="4" fill="#000" opacity=".22"/>`; return s + `<text x="${b.x + b.w / 2}" y="${b.y + b.h - 10}" class="tiny">${p.t === 11 ? 'DHT11' : 'DHT22'}</text>`; }
    case 'ds18b20': if (p.probe) return `<rect class="body" x="-2" y="-18" width="24" height="12" rx="2" fill="#111"/><line x1="10" y1="-18" x2="10" y2="-50" stroke="#111" stroke-width="5"/><rect x="5" y="-82" width="10" height="34" rx="5" fill="#c0c0c0" stroke="#888"/>`;
      return `<line x1="0" y1="0" x2="3" y2="-8" class="leg"/><line x1="10" y1="0" x2="10" y2="-8" class="leg"/><line x1="20" y1="0" x2="17" y2="-8" class="leg"/><path class="body" d="M1 -8 L1 -20 A9 9 0 0 1 19 -20 L19 -8 Z" fill="#1d1d1d"/><text x="10" y="-12" class="tiny light">18B20</text>`;
    case 'seg7': return seg7Svg(c, part);
    case 'lcd': { const W = p.cols * 12 + 30, H = p.rows * 18 + 30; let s = `<rect class="body" x="-10" y="${-H - 10}" width="${W}" height="${H}" rx="4" fill="#1d6b33" stroke="#0d3d1f"/><rect x="0" y="${-H}" width="${W - 20}" height="${H - 20}" fill="${p.bg}" opacity=".95"/><image class="screen" x="4" y="${-H + 4}" width="${W - 28}" height="${H - 28}" style="image-rendering:pixelated"/>`;
      if (p.bus === 'i2c') s += `<rect x="-10" y="-14" width="56" height="10" fill="#1b4f9c"/>`; for (const q of part.pins) s += `<text x="${q.x}" y="-${p.bus === 'i2c' ? 16 : 6}" class="pinlab" transform="rotate(-90 ${q.x} -${p.bus === 'i2c' ? 16 : 6})">${esc(q.n)}</text>`; return s; }
    case 'servo': { const big = p.big; const w = big ? 70 : 46; let s = `<rect x="-6" y="-8" width="32" height="6" rx="2" fill="#222"/><path d="M0 -8 C0 -18, 10 -18, 10 -28" stroke="#6b3e26" stroke-width="2.4" fill="none"/><path d="M10 -8 C10 -18, 18 -18, 18 -28" stroke="#d33" stroke-width="2.4" fill="none"/><path d="M20 -8 C20 -18, 26 -18, 26 -28" stroke="#f39c12" stroke-width="2.4" fill="none"/>`;
      s += `<rect class="body" x="${-10}" y="${-28 - w * 0.6}" width="${w}" height="${w * 0.6}" rx="4" fill="${big ? '#222' : '#2a5fb8'}" stroke="#0a1f4a"/><circle cx="${w * 0.25}" cy="${-28 - w * 0.3}" r="${w * 0.16}" fill="#eee"/><g class="arm" style="transform-origin:${w * 0.25}px ${-28 - w * 0.3}px"><rect x="${w * 0.25 - 3}" y="${-28 - w * 0.3 - w * 0.55}" width="6" height="${w * 0.55}" rx="3" fill="#f8f8f8" stroke="#999"/></g><text x="${w * 0.6}" y="${-34}" class="tiny light">${esc(part.name.split(' ')[0])}</text><text x="${w * 0.6}" y="${-24 - w * 0.6 + 12}" class="tiny light ang"></text>`; return s; }
    case 'motor': { const fan = p.style === 'fan', pump = p.style === 'pump'; let s = `<line x1="0" y1="0" x2="0" y2="-10" stroke="#d33" stroke-width="2"/><line x1="10" y1="0" x2="10" y2="-10" stroke="#222" stroke-width="2"/>`;
      if (fan) s += `<rect class="body" x="-16" y="-52" width="42" height="42" rx="5" fill="#222"/><g class="rotor" style="transform-origin:5px -31px">` + [0, 72, 144, 216, 288].map(a => `<path d="M5 -31 q 10 -6 14 -2 q -6 6 -14 2" fill="#555" transform="rotate(${a} 5 -31)"/>`).join('') + `</g><circle cx="5" cy="-31" r="5" fill="#333"/>`;
      else if (pump) s += `<rect class="body" x="-8" y="-46" width="26" height="36" rx="6" fill="#222"/><rect x="0" y="-56" width="10" height="12" fill="#555"/><g class="rotor" style="transform-origin:5px -28px"><line x1="5" y1="-36" x2="5" y2="-20" stroke="#777" stroke-width="2"/></g>`;
      else s += `<rect class="body" x="-14" y="-46" width="38" height="36" rx="${part.id.includes('tt') ? 3 : 10}" fill="${part.id.includes('tt') ? '#f2c12e' : '#b0b6bc'}" stroke="#666"/><g class="rotor" style="transform-origin:5px -28px"><circle cx="5" cy="-28" r="9" fill="#ddd" stroke="#777"/><rect x="3.5" y="-37" width="3" height="9" fill="#d33"/></g>`;
      return s; }
    case 'stepper': { const uni = p.uni; let s = ''; part.pins.forEach((q, i) => { s += `<line x1="${q.x}" y1="0" x2="${q.x}" y2="-10" stroke="${uni ? ['#36c', '#f6c', '#ec3', '#f80', '#d33'][i] : ['#d33', '#36c', '#3a4', '#222'][i]}" stroke-width="2"/>`; });
      const cx = uni ? 20 : 15; s += `<rect class="body" x="${cx - 30}" y="-72" width="60" height="62" rx="${uni ? 30 : 6}" fill="${uni ? '#b0b6bc' : '#333'}" stroke="#555"/><g class="rotor" style="transform-origin:${cx}px -41px"><circle cx="${cx}" cy="-41" r="10" fill="#ddd"/><rect x="${cx - 2}" y="-55" width="4" height="14" fill="#d33"/></g><text x="${cx}" y="-14" class="tiny ${uni ? '' : 'light'} ang"></text>`; return s; }
    case 'load': { if (p.style === 'bulb') return `<line x1="0" y1="0" x2="0" y2="-10" class="leg"/><line x1="10" y1="0" x2="10" y2="-10" class="leg"/><rect x="-4" y="-20" width="18" height="10" fill="#bbb"/><circle class="glowhalo" cx="5" cy="-32" r="26" fill="#ffd27a" opacity="0"/><circle class="body glow2" cx="5" cy="-32" r="13" fill="#fff8e0" stroke="#bbb"/>`;
      return `<line x1="0" y1="0" x2="0" y2="-10" stroke="#d33" stroke-width="2"/><line x1="10" y1="0" x2="10" y2="-10" stroke="#222" stroke-width="2"/><rect class="body" x="-14" y="-46" width="38" height="36" rx="3" fill="#888" stroke="#555"/><rect class="plunger" x="22" y="-32" width="16" height="8" fill="#ccc"/>`; }
    case 'battery': { const big = p.v >= 12; return `<line x1="0" y1="0" x2="0" y2="-10" stroke="#d33" stroke-width="2"/><line x1="10" y1="0" x2="10" y2="-10" stroke="#222" stroke-width="2"/><rect class="body" x="-20" y="-56" width="50" height="46" rx="5" fill="${big ? '#222' : part.id.includes('9v') ? '#1d1d1d' : '#2e7d32'}" stroke="#000"/><text x="5" y="-30" class="tiny light">${p.v}V</text><text x="5" y="-20" class="tiny light">${esc(part.name.split(' ').slice(0, 2).join(' '))}</text>`; }
    case 'keypad': { const W = p.c * 22 + 10, H = p.r * 22 + 10; let s = `<rect class="body" x="${-10}" y="${-H - 30}" width="${W}" height="${H}" rx="4" fill="#1a1a1a"/>`; for (let i = 0; i < p.r; i++) for (let j = 0; j < p.c; j++) s += `<g class="key" data-k="${i * p.c + j}"><rect x="${-5 + j * 22}" y="${-H - 25 + i * 22}" width="18" height="18" rx="3" fill="#e8e8e8"/><text x="${4 + j * 22}" y="${-H - 12 + i * 22}" class="keytxt">${esc(p.keys[i * p.c + j])}</text></g>`;
      s += `<path d="M0 -30 L0 -8 M${(part.pins.length - 1) * 10} -30 L${(part.pins.length - 1) * 10} -8" stroke="#888"/><rect x="-4" y="-30" width="${(part.pins.length - 1) * 10 + 8}" height="22" fill="#ccc" opacity=".6"/>`; return s; }
    case 'ws2812': { const n = p.count; let s = ''; const lay = p.layout;
      if (lay === 'ring') { const R = 10 + n * 2; s += `<circle class="body" cx="10" cy="${-R - 14}" r="${R + 8}" fill="#111"/><circle cx="10" cy="${-R - 14}" r="${R - 8}" fill="#f0f0f0"/>`; for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI - Math.PI / 2; s += `<rect class="px" data-i="${i}" x="${10 + R * Math.cos(a) - 4}" y="${-R - 14 + R * Math.sin(a) - 4}" width="8" height="8" rx="1.5" fill="#222"/>`; } }
      else if (lay.startsWith('grid')) { const g = lay === 'grid8' ? 8 : 16, cs = g === 8 ? 12 : 8; s += `<rect class="body" x="-5" y="${-g * cs - 16}" width="${g * cs + 6}" height="${g * cs + 6}" fill="#111"/>`; for (let i = 0; i < n; i++) { const r = Math.floor(i / g), cc = r % 2 ? g - 1 - (i % g) : i % g; s += `<rect class="px" data-i="${i}" x="${-2 + cc * cs}" y="${-g * cs - 13 + r * cs}" width="${cs - 3}" height="${cs - 3}" rx="1" fill="#222"/>`; } }
      else { const sp = n > 30 ? 7 : 12; s += `<rect class="body" x="-5" y="-26" width="${n * sp + 10}" height="16" rx="2" fill="#f0f0f0" stroke="#ccc"/>`; for (let i = 0; i < n; i++) s += `<rect class="px" data-i="${i}" x="${i * sp}" y="-23" width="${sp - 2}" height="10" rx="1.5" fill="#222"/>`; }
      return s; }
    case 'mcpadc': case 'sr595': case 'hbridge': { const n = part.pins.length / 2; return `<rect class="body" x="-5" y="4" width="${n * 10}" height="22" rx="2" fill="#1d1d1d"/><circle cx="1" cy="15" r="2.5" fill="#444"/><text x="${n * 5 - 5}" y="18" class="tiny light">${esc(part.name.split(' ')[0])}</text>`; }
    case 'relay': return `<rect class="body" x="-5" y="-5" width="50" height="50" rx="3" fill="#1e5fd8" stroke="#0a2a66"/><text x="20" y="18" class="tiny light">SRD-${p.v < 10 ? '0' + p.v : p.v}VDC</text><line class="rarm" data-i="1" x1="12" y1="30" x2="30" y2="24" stroke="#ddd" stroke-width="1.6"/>`;
  }
  return `<rect class="body" x="-5" y="-30" width="${Math.max(30, part.pins.length * 10)}" height="26" rx="3" fill="#555"/>`;
}
const SEGPATH = { a: [2, 0, 10, 0], b: [12, 2, 12, 10], c: [12, 14, 12, 22], d: [2, 24, 10, 24], e: [0, 14, 0, 22], f: [0, 2, 0, 10], g: [2, 12, 10, 12] };
function segDigit(x, y, sc, key) { let s = `<g transform="translate(${x} ${y}) scale(${sc})">`; for (const [n, [x1, y1, x2, y2]] of Object.entries(SEGPATH)) s += `<line class="seg" data-k="${key}${n}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#300" stroke-width="2.6" stroke-linecap="round"/>`; return s + `<circle class="seg" data-k="${key}DP" cx="15" cy="24" r="1.4" fill="#300"/></g>`; }
function seg7Svg(c, part) {
  const p = part.p; if (p.digits === 1) return `<rect class="body" x="-5" y="4" width="50" height="52" rx="2" fill="#222"/>` + segDigit(14, 12, 1.4, 'COM');
  return `<rect class="body" x="-5" y="4" width="60" height="52" rx="2" fill="#222"/>` + [1, 2, 3, 4].map(i => segDigit(-1 + (i - 1) * 14, 16, 0.85, 'D' + i)).join('');
}

// ---------- dynamic state (called every animation frame for visible parts) ----------
const lerp = (a, b, f) => a + (b - a) * f;
function smooth(c, key, target, dt, tau = 0.025) { const st = c.vis || (c.vis = {}); const v = st[key] === undefined ? target : st[key]; const nv = v + (target - v) * (1 - Math.exp(-dt / tau)); st[key] = nv; return nv; }
function hexMix(hex, k) { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return `rgb(${Math.round(lerp(40, r, k))},${Math.round(lerp(20, g, k))},${Math.round(lerp(20, b, k))})`; }
const canvasCache = new WeakMap();
function screenURL(c, w, h, draw) {
  let cv = canvasCache.get(c); if (!cv) { cv = document.createElement('canvas'); canvasCache.set(c, cv); }
  cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true }); draw(g); return cv.toDataURL();
}
export function updateDyn(c, part, el, dt, sim) {
  const k = part.kind, p = part.p, m = c.m || {}, st = c.st || {};
  const q = (sel) => el.querySelector(sel), qa = (sel) => el.querySelectorAll(sel);
  switch (k) {
    case 'led': { const raw = Math.max(0, Math.min(1, (m.i || 0) / p.imax)); const b = smooth(c, 'b', raw > 0.0005 ? Math.pow(raw, 0.5) : 0, dt);
      const g = q('.glow'), h = q('.glowhalo'); if (g) g.setAttribute('opacity', (p.ir ? 0.25 : 0.95) * b); if (h) h.setAttribute('opacity', (p.ir ? 0.1 : 0.45) * b); break; }
    case 'rgbled': { const f = (i) => Math.pow(Math.max(0, Math.min(1, i / 0.02)), 0.5); const r = smooth(c, 'r', f(m.r || 0), dt), g = smooth(c, 'g', f(m.g || 0), dt), b = smooth(c, 'b', f(m.b || 0), dt);
      const mx = Math.max(r, g, b); const col = `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`; q('.glow').setAttribute('fill', col); q('.glow').setAttribute('opacity', mx * 0.95); q('.glowhalo').setAttribute('fill', col); q('.glowhalo').setAttribute('opacity', mx * 0.5); break; }
    case 'seg7': for (const s of qa('.seg')) { const key = s.dataset.k; const i = m[key] || 0; const b = smooth(c, key, Math.pow(Math.max(0, Math.min(1, i / 0.015)), 0.5), dt, 0.04); const col = b > 0.02 ? hexMix(p.hex, 0.25 + 0.75 * b) : '#3a1010';
      if (s.tagName === 'line') s.setAttribute('stroke', col); else s.setAttribute('fill', col); } break;
    case 'button': { const cap = q('.cap'); if (cap) cap.setAttribute('transform', st.pressed ? 'translate(0 1.2) scale(1)' : ''); if (cap) cap.style.filter = st.pressed ? 'brightness(.7)' : ''; break; }
    case 'switch': { const s = q('.sw'); if (s) { const on = p.type === 'spdt' ? (p.momentary ? st.pressed : (c.ctl && c.ctl.pos)) : p.tilt ? (c.ctl && c.ctl.tilted) : p.momentary ? st.pressed : c.ctl && c.ctl.on; s.setAttribute('x', on ? (part.pins.length === 2 ? 10 : 12) : 2); }
      const r = q('.reed'); if (r) r.setAttribute('x2', c.ctl && c.ctl.magnet ? 21 : 18); break; }
    case 'dip': for (const kk of qa('.dipk')) { const on = c.ctl && c.ctl['s' + kk.dataset.i]; kk.setAttribute('y', on ? 8 : 15); } break;
    case 'pot': { const kn = q('.knob'); if (kn) kn.style.transform = `rotate(${((c.ctl && c.ctl.pos !== undefined ? c.ctl.pos : 0.5) - 0.5) * 270}deg)`; break; }
    case 'encoder': { const kn = q('.knob'); if (kn) kn.style.transform = `rotate(${(st.q || 0) * 4.5}deg)`; break; }
    case 'joystick': { const s = q('.stick'); if (s) { const cx = +s.getAttribute('cx'), cy = +s.getAttribute('cy'); s.setAttribute('transform', `translate(${((c.ctl && c.ctl.x) || 0) * 10} ${-((c.ctl && c.ctl.y) || 0) * 10})`); s.setAttribute('fill', st.pressed ? '#888' : '#555'); } break; }
    case 'keypad': for (const kk of qa('.key rect')) { const i = +kk.parentNode.dataset.k; kk.setAttribute('fill', st.keys && st.keys[i] ? '#9cf' : '#e8e8e8'); } break;
    case 'buzzer': { const d = (m.drive || 0); const on = d > 0.05 && (p.active || (c.mdep && c.mdep.drive)); const bz = q('.bz'); if (bz) bz.setAttribute('stroke', on ? '#facc15' : '#555'); if (bz) bz.setAttribute('stroke-width', on ? 2.5 + Math.sin(performance.now() / 40) : 1); break; }
    case 'servo': { const a = q('.arm'); const ang = st.ang === undefined ? (p.continuous ? 0 : 90) : st.ang; if (a) a.style.transform = `rotate(${p.continuous ? ang : ang - 90}deg)`; const t = q('.ang'); if (t) t.textContent = p.continuous ? (st.spin ? (st.spin > 0 ? '⟳' : '⟲') + Math.round(Math.abs(st.spin) * 100) + '%' : 'stop') : Math.round(ang) + '°'; break; }
    case 'motor': { const r = q('.rotor'); if (r) r.style.transform = `rotate(${st.ang || 0}deg)`; break; }
    case 'stepper': { const r = q('.rotor'); if (r) r.style.transform = `rotate(${st.ang || 0}deg)`; const t = q('.ang'); if (t) t.textContent = (st.ang || 0).toFixed(1) + '°'; break; }
    case 'load': { const v = Math.abs(m.v || 0) / p.v; if (p.style === 'bulb') { const b = smooth(c, 'b', Math.min(1, v * v), dt, 0.08); q('.glow2').setAttribute('fill', hexMix('#ffd060', 0.3 + 0.7 * b)); q('.glowhalo').setAttribute('opacity', 0.6 * b); } else { const pl = q('.plunger'); if (pl) pl.setAttribute('x', v > 0.6 ? 14 : 22); } break; }
    case 'relaymod': for (const l of qa('.rled')) l.setAttribute('fill', st.led && st.led[+l.dataset.i] ? '#ff2020' : '#300'); for (const a of qa('.rarm')) { const on = st.on && st.on[+a.dataset.i]; a.setAttribute('y2', +a.getAttribute('y1') - (on ? 0 : 6)); } break;
    case 'relay': { const a = q('.rarm'); if (a) a.setAttribute('y2', st.on ? 30 : 24); break; }
    case 'pir': { const f = q('.face'); if (f) f.setAttribute('fill', st.out ? '#fff3b0' : '#f5f5f0'); break; }
    case 'ultrasonic': { const t = q('.dist'); if (t) t.textContent = (c.ctl && c.ctl.dist !== undefined ? c.ctl.dist : 50) + 'cm'; break; }
    case 'uln2003': for (const l of qa('.phled')) l.setAttribute('fill', st.ph && st.ph[+l.dataset.i] ? '#ff2020' : '#300'); break;
    case 'digimod': { const l = q('.doled'); if (l) l.setAttribute('fill', st.out !== null && st.out !== undefined && (p.act === 'high' ? st.out : !st.out) ? '#2f2' : '#030'); break; }
    case 'anamod': { const l = q('.doled'); if (l) l.setAttribute('fill', st.pw && st.do === (p.ctl === 'light' || (p.ctl === 'sound' && part.id !== 'snd-lm393')) ? '#2f2' : '#030'); break; }
    case 'gps': { const l = q('.fixled'); if (l) l.setAttribute('fill', (c.ctl ? c.ctl.fix !== false : true) && sim && sim.V(c, 'VCC') - sim.V(c, 'GND') > 2.7 && Math.floor(performance.now() / 500) % 2 ? '#2f2' : '#030'); break; }
    case 'rc522': { const cd = q('.card'); if (cd) cd.setAttribute('opacity', (c.ctl && c.ctl.hold) || (st.tapUntil && sim && sim.now() < st.tapUntil) ? 0.9 : 0); break; }
    case 'ws2812': { if (st.pxVer === c.vis_px) break; c.vis_px = st.pxVer; const pw = (st.vcc || 0) > 2.7; for (const r of qa('.px')) { const v = pw ? (st.px[+r.dataset.i] || 0) : 0; const R = (v >> 16) & 255, G = (v >> 8) & 255, B = v & 255; const mx = Math.max(R, G, B); r.setAttribute('fill', mx ? `rgb(${Math.min(255, R * 255 / mx * (0.35 + 0.65 * mx / 255)) | 0},${Math.min(255, G * 255 / mx * (0.35 + 0.65 * mx / 255)) | 0},${Math.min(255, B * 255 / mx * (0.35 + 0.65 * mx / 255)) | 0})` : '#222'); } break; }
    case 'max7219': { const mx = st.mx; if (!mx || c.vis_mx === mx.ver) break; c.vis_mx = mx.ver; const pw = (st.vcc || 0) > 3; for (const d of qa('.mx')) { const [dev, r, col] = d.dataset.k.split(',').map(Number); const R = mx.regs[mx.regs.length - 1 - dev]; const on = pw && R && R.shut && (R.test || ((R.digits[r] >> (7 - col)) & 1) && r <= R.scan); d.setAttribute('fill', on ? p.hex : '#2a0a0a'); d.setAttribute('opacity', on ? 0.45 + 0.55 * ((R.intensity + 1) / 16) : 1); } break; }
    case 'tm1637': { const tm = st.tm; if (!tm) break; const map = ['a', 'b', 'c', 'd', 'e', 'f', 'g']; for (let i = 0; i < 4; i++) for (let b = 0; b < 7; b++) { const s = el.querySelector(`[data-k="tm${i}${map[b]}"]`); const on = tm.on && (tm.seg[i] >> b) & 1; s.setAttribute('stroke', on ? p.hex : '#300'); }
      for (const d of qa('.tmcol')) d.setAttribute('fill', tm.on && part.id === 'tm1637-056' && (tm.seg[1] & 0x80) ? p.hex : '#300'); break; }
    case 'lcd': { const L = st.lcd; if (!L) break; const vcc = st.vcc || 0; const blink = Math.floor(performance.now() / 500) % 2; const key = L.ver + ':' + (vcc > 4.2 ? 1 : vcc > 2.5 ? 2 : 0) + ':' + (L.cursor || L.blink ? blink : 0) + ':' + L.bl;
      if (c.vis_lcd === key) break; c.vis_lcd = key; const img = q('.screen'); const W = p.cols * 6 - 1, H = p.rows * 9 - 1;
      img.setAttribute('href', screenURL(c, W * 4, H * 4, (g) => { const on = vcc > 2.5 && L.disp, faint = vcc <= 4.2; const bl = p.bus === 'parallel' ? (m.bl || 0) > 0.002 : L.bl;
        g.fillStyle = bl && vcc > 2.5 ? p.bg : '#3a4a3a'; g.fillRect(0, 0, W * 4, H * 4);
        for (let r = 0; r < p.rows; r++) for (let col = 0; col < p.cols; col++) { const code = L.charAt(r, col); const rows = L.glyph(code);
          for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) { let lit = on && ((rows[y] >> (4 - x)) & 1); const isCur = on && r === L.cursorRow && col === L.cursorCol;
            g.fillStyle = lit ? (faint ? p.fg + '33' : p.fg) : 'rgba(255,255,255,0.08)'; g.fillRect((col * 6 + x) * 4, (r * 9 + y) * 4, 3.4, 3.4); } } })); break; }
    case 'oled': { const O = st.oled; if (!O) break; const vcc = st.vcc || 0; const key = O.ver + ':' + (vcc > 2.8); if (c.vis_oled === key) break; c.vis_oled = key; const img = q('.screen');
      img.setAttribute('href', screenURL(c, p.w, p.h, (g) => { g.fillStyle = '#050505'; g.fillRect(0, 0, p.w, p.h); if (vcc < 2.8 || !O.visible()) return; const im = g.getImageData(0, 0, p.w, p.h); const d = im.data;
        const pal = p.scheme === 'blue' ? [80, 180, 255] : [235, 245, 255];
        for (let y = 0; y < p.h; y++) { const col = p.scheme === 'yb' && y < 16 ? [255, 214, 40] : p.scheme === 'yb' ? [80, 180, 255] : pal; for (let x = 0; x < p.w; x++) if (O.pixel(x, y)) { const i = (y * p.w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; } }
        g.putImageData(im, 0, 0); })); break; }
  }
  // generic power LED for modules
  const pl = el.querySelector('.pwrled'); if (pl && sim) { let pw = false; const vn = ['VCC', 'VDD', 'VIN', '+', '+5V', '5V', '3.3V', '3V3', 'V+'].find(n => part.pins.some(x => x.n === n)); const gn = ['GND', '−', 'G'].find(n => part.pins.some(x => x.n === n)); if (vn && gn) pw = sim.V(c, vn) - sim.V(c, gn) > 2.5; pl.setAttribute('fill', pw ? '#ff3030' : '#300'); }
}
