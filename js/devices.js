// Device models: how each part behaves electrically and logically.
// Each model may implement: init, bridges, stamp (add elements), post (nonlinear iteration),
// logic (edge/latch behaviour on the settled solution), measure, after, links (DC paths), check, tick.
import { HEADER, BOARDS, BCM_TO_PHYS, PHYS_TO_BCM } from './pi.js';
import { partOf as partOfC } from './geom.js';
export const MODELS = {};
const has = (part, n) => part.pins.some(p => p.n === n);
export const pick = (part, names) => names.find(n => has(part, n));
const VCCN = ['VCC', 'VDD', 'VIN', '+', '+5V', '5V', '+Vs', 'V+', '3V3', '3.3V'];
const GNDN = ['GND', '−', 'AGND', 'VSS', 'G'];
export const vccOf = (part) => pick(part, VCCN);
export const gndOf = (part) => pick(part, GNDN);
export const mA = (i) => (Math.abs(i) * 1000).toFixed(Math.abs(i) < 0.01 ? 1 : 0) + 'mA';
export const V2 = (v) => v.toFixed(2) + 'V';
export function supply(ctx, c, part) { const a = vccOf(part), b = gndOf(part); return a && b ? ctx.V(c, a) - ctx.V(c, b) : 0; }
// ---- piecewise-linear diode helper (state kept per component) ----
export function diode(ctx, c, key, a, k, vf, ron, vz, rz) {
  const D = c.st.d || (c.st.d = {}); const s = D[key] || (D[key] = { on: false, z: false });
  s.a = a; s.k = k; s.vf = vf; s.ron = ron; s.vz = vz; s.rz = rz; s.used = true;
  if (a < 0 || k < 0) return s;
  if (s.on) ctx.C.vs(a, k, vf, ron); else if (s.z && vz) ctx.C.vs(k, a, vz, rz); else ctx.C.g(a, k, 1e-9);
  return s;
}
export function diodePost(ctx, c) {
  if (!c.st.d || ctx.iter > 60) return false;
  let ch = false; const C = ctx.C;
  for (const key in c.st.d) {
    const s = c.st.d[key]; if (!s.used || s.a < 0 || s.k < 0) continue;
    const vd = C.V(s.a) - C.V(s.k);
    if (s.on) { if ((vd - s.vf) / s.ron < -1e-7) { s.on = false; ch = true; } }
    else if (vd > s.vf + 1e-4) { s.on = true; s.z = false; ch = true; continue; }
    if (s.vz) {
      if (s.z) { if ((-vd - s.vz) / s.rz < -1e-7) { s.z = false; ch = true; } }
      else if (!s.on && -vd > s.vz + 1e-4) { s.z = true; ch = true; }
    }
  }
  return ch;
}
export function diodeI(ctx, s) {
  if (!s || s.a < 0) return 0; const vd = ctx.C.V(s.a) - ctx.C.V(s.k);
  if (s.on) return Math.max(0, (vd - s.vf) / s.ron);
  if (s.z && s.vz) return -Math.max(0, (-vd - s.vz) / s.rz);
  return 0;
}
export const N = (ctx, c, n) => ctx.node(c, n);
export function needPins(ctx, c, part, add, names) {
  for (const n of names) if (has(part, n) && ctx.sim.links(c, n) <= 0) add('warn', c, `${n} pin of ${label(c, part)} is not connected`, 'Wire it up — the part will not work without it.');
}
export function label(c, part) { return (c.label || c.id) + ' · ' + part.name; }

// ================= Raspberry Pi =================
const RAIL3 = 'P1', RAIL5 = 'P2';
const gpOn = (g) => (g.pwm && g.pwm.duty > 0 && g.pwm.duty < 1 ? g.phase : g.level);
MODELS.pi = {
  stamp(ctx, c) {
    const C = ctx.C, sim = ctx.sim;
    C.vs(N(ctx, c, RAIL3), 0, 3.3, 0.05);
    C.vs(N(ctx, c, RAIL5), 0, 5.0, 0.03);
    for (let b = 0; b < 28; b++) {
      const nd = N(ctx, c, 'P' + BCM_TO_PHYS[b]); const g = sim.gpio[b];
      if (g.mode === 'out') C.vs(nd, 0, gpOn(g) ? 3.3 : 0, 30);
      else if (g.pull === 'up') C.vs(nd, 0, 3.3, 50e3);
      else if (g.pull === 'down') C.r(nd, 0, 50e3);
      if (b === 2 || b === 3) C.vs(nd, 0, 3.3, 1800);
    }
  },
  links(ctx, c) {
    const L = [[RAIL3, '*'], [RAIL5, '*']];
    for (let b = 0; b < 28; b++) { const g = ctx.sim.gpio[b]; if (g.mode === 'out' || g.pull !== 'off' || b === 2 || b === 3) L.push(['P' + BCM_TO_PHYS[b], '*']); }
    return L;
  },
  measure(ctx, c) {
    const m = { i3: (3.3 - ctx.V(c, RAIL3)) / 0.05, i5: (5 - ctx.V(c, RAIL5)) / 0.03 };
    for (let b = 0; b < 28; b++) { const g = ctx.sim.gpio[b]; if (g.mode === 'out') m['g' + b] = ((gpOn(g) ? 3.3 : 0) - ctx.V(c, 'P' + BCM_TO_PHYS[b])) / 30; }
    return m;
  },
  check(ctx, c, part, add) {
    const sim = ctx.sim, B = part.board, mb = c.mbase || {};
    // the parts wired to a header pin, so a warning about that pin highlights them too
    const onNet = (phys) => { const r = sim.root(c, 'P' + phys), out = [];
      for (const o of sim.project.comps) { if (o === c) continue; const pp = partOfC(o); if (!pp || pp.kind === 'breadboard') continue; if (pp.pins.some(q => sim.root(o, q.n) === r)) out.push(o); }
      return out; };
    const outNets = [];
    if (sim.root(c, RAIL3) === sim.root(c, RAIL5)) add('error', c, 'Short circuit: the 3.3V and 5V pins are connected together', 'Remove the wire joining 3.3V and 5V.');
    if (sim.root(c, RAIL3) === sim.gndRoot) add('error', c, 'Short circuit: 3.3V is wired straight to GND', 'Remove that wire — a short can kill the Pi’s regulator.');
    else if (mb.i3 > 1.0) add('error', c, `3.3V rail is supplying ${mA(mb.i3)} — almost a short`, 'Look for a missing resistor or a 3.3V→GND path.');
    else if (mb.i3 > 0.5) add('warn', c, `3.3V rail load is ${mA(mb.i3)} (keep it under ≈500mA)`, 'Power big loads from 5V or an external supply.');
    if (sim.root(c, RAIL5) === sim.gndRoot) add('error', c, 'Short circuit: 5V is wired straight to GND', 'Remove that wire immediately — this browns out or damages the supply.');
    else if (mb.i5 > 3) add('error', c, `5V rail is supplying ${mA(mb.i5)} — a short or far too much load`, 'Use an external supply for motors and LED strips.');
    else if (mb.i5 > B.rail5vLimit) add('warn', c, `5V pin load ${mA(mb.i5)} is over the ${B.short} budget (${B.rail5vLimit}A)`, B.note);
    let total = 0;
    for (let bc = 0; bc < 28; bc++) {
      const phys = BCM_TO_PHYS[bc]; const v = ctx.V(c, 'P' + phys); const g = sim.gpio[bc];
      if (sim.links(c, 'P' + phys) <= 0) continue;
      if (v > 4.0) add('error', c, `GPIO${bc} (pin ${phys}) sees ${V2(v)} — Pi GPIOs are 3.3V only; this will damage the Pi`, 'Use a voltage divider (1kΩ/2kΩ) or a level shifter, or power the module from 3.3V.', onNet(phys));
      else if (v > 3.6) add('warn', c, `GPIO${bc} (pin ${phys}) is at ${V2(v)}, above the 3.3V limit`, 'Usually 5V pull-ups on a module; a level shifter makes it safe.', onNet(phys));
      if (v < -0.4) add('error', c, `GPIO${bc} (pin ${phys}) is pulled to ${V2(v)} (negative)`, 'Check the polarity of external supplies.');
      if (g.mode === 'out') {
        const i = mb['g' + bc] || 0; total += Math.abs(i); if (Math.abs(i) > 0.001) outNets.push(phys);
        if (Math.abs(i) > 0.05) add('error', c, `GPIO${bc} output is shorted (${mA(i)})`, 'The output is wired straight to a supply, GND or another output.', onNet(phys));
        else if (Math.abs(i) > 0.016) add('error', c, `GPIO${bc} is ${i > 0 ? 'sourcing' : 'sinking'} ${mA(i)} — over the 16mA per-pin limit`, 'Add or raise the series resistor (≥220Ω for an LED), or switch the load with a transistor.', onNet(phys));
      } else if (g.user && sim.levels[bc] === 2) add('warn', c, `GPIO${bc} is an input with nothing driving it (floating) — it reads random values`, 'Use pull_up_down=GPIO.PUD_UP / PUD_DOWN or a 10k resistor.');
      else if (g.user && v > 0.8 && v < 2.0) add('warn', c, `GPIO${bc} input sits at ${V2(v)}, between valid LOW (<0.8V) and HIGH (>2.0V)`, 'The reading is unreliable — check pull resistors and dividers.');
      if ((bc === 0 || bc === 1) && g.user) add('info', c, `GPIO${bc} is reserved for the HAT ID EEPROM`, 'It works, but avoid it if you plan to add a HAT.');
    }
    if (total > 0.05) add('warn', c, `Total GPIO output current ${mA(total)} is above the ≈50mA guideline`, 'Drive LEDs at 5–10mA or use transistors.', [...new Set(outNets.flatMap(onNet))]);
    if (c.part === 'pi5' && sim.usedRPiGPIO) add('info', c, 'Real Pi 5: RPi.GPIO needs the rpi-lgpio drop-in package', BOARDS.pi5.gpioLib);
  },
};

export const ctl = (c, k, d) => (c.ctl && c.ctl[k] !== undefined ? c.ctl[k] : d);
// ================= Passives =================
MODELS.resistor = {
  stamp(ctx, c, part) { ctx.C.r(N(ctx, c, '1'), N(ctx, c, '2'), ctl(c, 'ohms', part.p.ohms)); },
  links: () => [['1', '2']],
  measure(ctx, c, part) { const R = ctl(c, 'ohms', part.p.ohms); const v = ctx.V(c, '1') - ctx.V(c, '2'); return { i: v / R, p: v * v / R }; },
  check(ctx, c, part, add) {
    const p = (c.m && c.m.p) || 0;
    if (p > part.p.watts * 2) add('error', c, `${label(c, part)} dissipates ${p.toFixed(2)}W — rated ${part.p.watts}W; it will burn`, 'Use a larger resistance or a higher power rating.');
    else if (p > part.p.watts) add('warn', c, `${label(c, part)} dissipates ${p.toFixed(2)}W, above its ${part.p.watts}W rating`, 'Pick a higher wattage resistor.');
  },
};
MODELS.capacitor = {
  check(ctx, c, part, add) {
    const a = part.p.polar ? '+' : '1', b = part.p.polar ? '−' : '2';
    const v = ctx.V(c, a) - ctx.V(c, b);
    if (part.p.polar && v < -0.5) add('error', c, `${label(c, part)} is reverse-biased (${V2(v)})`, 'Turn it around: the + (long) leg goes to the higher voltage.');
    if (Math.abs(v) > part.p.volts) add('error', c, `${label(c, part)} sees ${V2(Math.abs(v))}, above its ${part.p.volts}V rating`, 'Use a capacitor rated at least 1.5× the voltage.');
  },
};
MODELS.diode = {
  stamp(ctx, c, part) { const p = part.p; diode(ctx, c, 'd', N(ctx, c, 'A'), N(ctx, c, 'K'), p.vf, p.ron, p.vz, p.rz); },
  post: (ctx, c) => diodePost(ctx, c),
  links: (ctx, c) => (c.st.d && c.st.d.d && (c.st.d.d.on || c.st.d.d.z) ? [['A', 'K']] : []),
  measure(ctx, c) { return { i: diodeI(ctx, c.st.d && c.st.d.d) }; },
  check(ctx, c, part, add) {
    const i = (c.mbase && c.mbase.i) || 0, vr = ctx.V(c, 'K') - ctx.V(c, 'A');
    if (Math.abs(i) > part.p.imax * 1.05) add('error', c, `${label(c, part)} carries ${mA(i)}, above its ${part.p.imax}A rating`, 'Limit the current with a resistor.');
    if (!part.p.vz && vr > part.p.vrrm) add('error', c, `${label(c, part)} reverse voltage ${V2(vr)} exceeds ${part.p.vrrm}V`, 'Use a diode with a higher voltage rating.');
  },
};
// LEDs: Vf + dynamic resistance; brightness from (PWM-averaged) current
MODELS.led = {
  stamp(ctx, c, part) {
    const p = part.p; const off = p.flash && !c.st.flashOn;
    if (off) { c.st.d && c.st.d.d && (c.st.d.d.on = false); ctx.C.g(N(ctx, c, 'A'), N(ctx, c, 'K'), 1e-9); return; }
    diode(ctx, c, 'd', N(ctx, c, p.laser ? 'S' : 'A'), N(ctx, c, p.laser ? '−' : 'K'), p.vf, 15 + (p.rser || 0));
  },
  post: (ctx, c) => diodePost(ctx, c),
  links: (ctx, c, part) => (c.st.d && c.st.d.d && c.st.d.d.on ? [[part.p.laser ? 'S' : 'A', part.p.laser ? '−' : 'K']] : []),
  measure(ctx, c) { return { i: diodeI(ctx, c.st.d && c.st.d.d) }; },
  tick(c, part, t) { if (!part.p.flash) return false; const on = Math.floor(t * part.p.flash * 2) % 2 === 0; if (on !== c.st.flashOn) { c.st.flashOn = on; return true; } return false; },
  check(ctx, c, part, add) {
    const i = (c.mbase && c.mbase.i) || 0; const a = part.p.laser ? 'S' : 'A', k = part.p.laser ? '−' : 'K';
    if (i > part.p.iabs) add('error', c, `${label(c, part)} over-current: ${mA(i)} (max ${mA(part.p.iabs)}) — it will burn out`, 'Add a series resistor: (3.3V − Vf) / 0.01A ≈ 130–220Ω.');
    else if (i > part.p.imax * 1.1) add('warn', c, `${label(c, part)} runs at ${mA(i)}, above the ${mA(part.p.imax)} rating`, 'Use a larger series resistor.');
    const vr = ctx.V(c, k) - ctx.V(c, a);
    if (vr > 5) add('warn', c, `${label(c, part)} has ${V2(vr)} reverse voltage (LEDs tolerate ≈5V)`, 'Check orientation: long leg (anode) to the positive side.');
  },
};
MODELS.rgbled = {
  stamp(ctx, c, part) {
    const p = part.p, com = p.common === 'cathode' ? 'K' : 'A';
    for (const [ch, vf] of [['R', p.vfr], ['G', p.vfg], ['B', p.vfb]]) {
      if (p.common === 'cathode') diode(ctx, c, ch, N(ctx, c, ch), N(ctx, c, com), vf, 15); else diode(ctx, c, ch, N(ctx, c, com), N(ctx, c, ch), vf, 15);
    }
  },
  post: (ctx, c) => diodePost(ctx, c),
  links(ctx, c, part) { const com = part.p.common === 'cathode' ? 'K' : 'A'; return ['R', 'G', 'B'].filter(k => c.st.d && c.st.d[k] && c.st.d[k].on).map(k => [k, com]); },
  measure(ctx, c) { const d = c.st.d || {}; return { r: diodeI(ctx, d.R), g: diodeI(ctx, d.G), b: diodeI(ctx, d.B) }; },
  check(ctx, c, part, add) {
    const m = c.mbase || {};
    for (const k of ['r', 'g', 'b']) if (m[k] > 0.03) add('error', c, `${label(c, part)} ${k.toUpperCase()} channel over-current: ${mA(m[k])}`, 'Each colour needs its own series resistor (≈150–330Ω).');
  },
};
const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'DP'];
MODELS.seg7 = {
  bridges: (part) => (part.p.digits === 1 ? [['COM', 'COM2']] : []),
  stamp(ctx, c, part) {
    const p = part.p, digs = p.digits === 1 ? ['COM'] : ['D1', 'D2', 'D3', 'D4'];
    for (const d of digs) for (const s of SEGS) {
      const sn = N(ctx, c, s), dn = N(ctx, c, d);
      if (p.common === 'cathode') diode(ctx, c, d + s, sn, dn, p.vf, 15); else diode(ctx, c, d + s, dn, sn, p.vf, 15);
    }
  },
  post: (ctx, c) => diodePost(ctx, c),
  links(ctx, c, part) { const L = []; for (const k in (c.st.d || {})) if (c.st.d[k].on) { const d = part.p.digits === 1 ? 'COM' : k.slice(0, 2); L.push([k.slice(d.length), d]); } return L; },
  measure(ctx, c, part) { const m = {}; for (const k in (c.st.d || {})) m[k] = diodeI(ctx, c.st.d[k]); return m; },
  check(ctx, c, part, add) {
    const m = c.mbase || {}; let worst = 0; for (const k in m) worst = Math.max(worst, m[k]);
    if (worst > 0.03) add('error', c, `${label(c, part)} segment current ${mA(worst)} — too high`, 'Put a resistor (≈220–330Ω) on every segment line, not on the common pin.');
    let comI = 0; for (const k in m) comI += m[k];
    if (part.p.digits === 1 && comI > 0.016 && ctx.sim.gpioAt(c, 'COM').length) add('warn', c, `Common pin carries ${mA(comI)} through a GPIO (16mA max)`, 'Tie COM to GND/3.3V directly, or switch it with a transistor.');
  },
};
// ================= Switches & inputs =================
MODELS.button = {
  bridges: (part) => (part.p.two || part.p.module ? [] : [['1', '2'], ['3', '4']]),
  stamp(ctx, c, part) {
    const C = ctx.C, on = !!c.st.pressed;
    if (part.p.module) { C.r(N(ctx, c, '+'), N(ctx, c, 'S'), 1e4); if (on) C.r(N(ctx, c, 'S'), N(ctx, c, '−'), 0.05); return; }
    if (on) C.r(N(ctx, c, '1'), N(ctx, c, part.p.two ? '2' : '3'), 0.05);
  },
  links(ctx, c, part) { if (part.p.module) return c.st.pressed ? [['+', 'S'], ['S', '−']] : [['+', 'S']]; return c.st.pressed ? [['1', part.p.two ? '2' : '3']] : []; },
  controls: () => [{ key: 'pressed', type: 'momentary', label: 'Press' }],
};
MODELS.switch = {
  stamp(ctx, c, part) {
    const C = ctx.C, p = part.p;
    if (p.type === 'spdt') { const pos = p.momentary ? (c.st.pressed ? 1 : 0) : ctl(c, 'pos', 0);
      if (part.pins.some(q => q.n === 'COM') && part.pins.some(q => q.n === 'NO')) C.r(N(ctx, c, 'COM'), N(ctx, c, pos ? 'NO' : 'NC'), 0.05);
      else C.r(N(ctx, c, 'COM'), N(ctx, c, pos ? '2' : '1'), 0.05); return; }
    const closed = p.momentary ? !!c.st.pressed : p.tilt ? !ctl(c, 'tilted', false) : p.magnet ? !!ctl(c, 'magnet', false) : !!ctl(c, 'on', false);
    if (closed) C.r(N(ctx, c, '1'), N(ctx, c, '2'), 0.05);
  },
  links(ctx, c, part) { return []; },
  controls(part) {
    const p = part.p;
    if (p.momentary) return [{ key: 'pressed', type: 'momentary', label: p.type === 'spdt' ? 'Press lever' : 'Shake' }];
    if (p.type === 'spdt') return [{ key: 'pos', type: 'select', label: 'Position', options: [[0, 'COM–1'], [1, 'COM–2']], def: 0 }];
    if (p.tilt) return [{ key: 'tilted', type: 'toggle', label: 'Tilted', def: false }];
    if (p.magnet) return [{ key: 'magnet', type: 'toggle', label: 'Magnet nearby', def: false }];
    return [{ key: 'on', type: 'toggle', label: 'Switch ON', def: false }];
  },
};
MODELS.dip = {
  stamp(ctx, c, part) { const n = part.p.n; for (let i = 1; i <= n; i++) if (ctl(c, 's' + i, false)) ctx.C.r(N(ctx, c, '' + i), N(ctx, c, '' + (2 * n + 1 - i)), 0.05); },
  controls: (part) => Array.from({ length: part.p.n }, (_, i) => ({ key: 's' + (i + 1), type: 'toggle', label: 'Switch ' + (i + 1), def: false })),
};
MODELS.keypad = {
  stamp(ctx, c, part) {
    const { r, c: cols } = part.p; const pr = c.st.keys || {};
    for (let i = 0; i < r; i++) for (let j = 0; j < cols; j++) if (pr[i * cols + j]) ctx.C.r(N(ctx, c, 'R' + (i + 1)), N(ctx, c, 'C' + (j + 1)), 0.1);
  },
  controls: () => [{ key: 'keys', type: 'keypad' }],
};
const taper = (pos, t) => (t === 'log' ? (Math.pow(10, 2 * pos) - 1) / 99 : pos);
MODELS.pot = {
  stamp(ctx, c, part) {
    const R = part.p.ohms, f = taper(ctl(c, 'pos', 0.5), part.p.taper);
    ctx.C.r(N(ctx, c, '1'), N(ctx, c, 'W'), Math.max(1, R * f)); ctx.C.r(N(ctx, c, 'W'), N(ctx, c, '3'), Math.max(1, R * (1 - f)));
  },
  links: () => [['1', 'W'], ['W', '3']],
  controls: () => [{ key: 'pos', type: 'range', label: 'Knob position', min: 0, max: 1, step: 0.005, def: 0.5, fmt: (v) => Math.round(v * 100) + '%' }],
  measure(ctx, c, part) { const v = ctx.V(c, '1') - ctx.V(c, '3'); return { p: v * v / part.p.ohms }; },
  check(ctx, c, part, add) { const p = (c.m && c.m.p) || 0; if (p > 0.5) add('warn', c, `${label(c, part)} dissipates ${p.toFixed(2)}W`, 'Potentiometers are usually rated 0.1–0.5W.'); },
};
const R2 = (rf) => ({ stamp(ctx, c, part) { ctx.C.r(N(ctx, c, '1'), N(ctx, c, '2'), rf(c, part)); }, links: () => [['1', '2']] });
export const ldrR = (lux, p) => (lux <= 0.05 ? p.dark : Math.min(p.dark, Math.max(50, p.r10 * Math.pow(lux / 10, -p.g))));
export const ntcR = (T, p) => p.r25 * Math.exp(p.beta * (1 / (T + 273.15) - 1 / 298.15));
MODELS.ldr = { ...R2((c, part) => ldrR(ctl(c, 'lux', 300), part.p)), controls: () => [{ key: 'lux', type: 'range', label: 'Light', min: 0, max: 2000, step: 1, unit: 'lux', def: 300 }] };
MODELS.ntc = { ...R2((c, part) => ntcR(ctl(c, 'temp', 25), part.p)), controls: () => [{ key: 'temp', type: 'range', label: 'Temperature', min: -20, max: 120, step: 0.5, unit: '°C', def: 25 }] };
MODELS.fsr = { ...R2((c) => { const g = ctl(c, 'grams', 0); return g < 5 ? 2e7 : 250 * 10000 / g; }), controls: () => [{ key: 'grams', type: 'range', label: 'Force', min: 0, max: 10000, step: 10, unit: 'g', def: 0 }] };
MODELS.flex = { ...R2((c) => 25000 + 75000 * ctl(c, 'bend', 0) / 180), controls: () => [{ key: 'bend', type: 'range', label: 'Bend angle', min: 0, max: 180, step: 1, unit: '°', def: 0 }] };
MODELS.ldrmod = {
  stamp(ctx, c, part) { ctx.C.r(N(ctx, c, '+'), N(ctx, c, 'S'), 1e4); ctx.C.r(N(ctx, c, 'S'), N(ctx, c, '−'), ldrR(ctl(c, 'lux', 300), part.p)); },
  links: () => [['+', 'S'], ['S', '−']], controls: () => MODELS.ldr.controls(),
};
MODELS.ntcmod = {
  stamp(ctx, c, part) { ctx.C.r(N(ctx, c, '+'), N(ctx, c, 'S'), 1e4); ctx.C.r(N(ctx, c, 'S'), N(ctx, c, '−'), ntcR(ctl(c, 'temp', 25), part.p)); },
  links: () => [['+', 'S'], ['S', '−']], controls: () => MODELS.ntc.controls(),
};
MODELS.antemp = {
  stamp(ctx, c, part) {
    const vs = ctx.V(c, '+Vs') - ctx.V(c, 'GND'); const lm = part.p.model === 'lm35';
    ctx.C.r(N(ctx, c, '+Vs'), N(ctx, c, 'GND'), 5 / 60e-6);
    const T = ctl(c, 'temp', 25), on = vs >= (lm ? 4 : 2.7);
    c.st.on = on;
    if (on) { const v = lm ? Math.max(0.02, 0.01 * T) : Math.max(0.1, 0.5 + 0.01 * T); ctx.C.vs(N(ctx, c, 'Vout'), N(ctx, c, 'GND'), Math.min(v, vs - 0.5), 100); }
  },
  post(ctx, c, part) { const vs = ctx.V(c, '+Vs') - ctx.V(c, 'GND'); const on = vs >= (part.p.model === 'lm35' ? 4 : 2.7); return on !== c.st.on && ctx.iter < 20; },
  links: (ctx, c) => (c.st.on ? [['Vout', '*']] : []),
  controls: () => [{ key: 'temp', type: 'range', label: 'Temperature', min: -40, max: 125, step: 0.5, unit: '°C', def: 25 }],
  check(ctx, c, part, add) {
    needPins(ctx, c, part, add, ['+Vs', 'GND', 'Vout']);
    const vs = ctx.V(c, '+Vs') - ctx.V(c, 'GND');
    if (part.p.model === 'lm35' && vs > 0.5 && vs < 4) add('warn', c, `LM35 needs 4–30V; it only gets ${V2(vs)}`, 'Power it from 5V (its output stays well under 3.3V).');
    if (ctx.sim.gpioAt(c, 'Vout').length) add('warn', c, `${label(c, part)} gives an analog voltage, but the Pi has no analog inputs`, 'Read it through an MCP3008 or ADS1115.');
  },
};

// ================= Transistors =================
MODELS.bjt = {
  stamp(ctx, c, part) {
    const p = part.p, npn = p.pol === 'npn';
    const B = N(ctx, c, 'B'), E = N(ctx, c, 'E'), Cn = N(ctx, c, 'C');
    const vbe = p.darl ? 1.3 : 0.65, rbe = p.darl ? 200 : 25, vsat = p.darl ? 0.9 : 0.15;
    const s = npn ? diode(ctx, c, 'be', B, E, vbe, rbe) : diode(ctx, c, 'be', E, B, vbe, rbe);
    const mode = c.st.mode || 'off';
    if (!s.on) { ctx.C.g(Cn, E, 1e-9); return; }
    const gm = p.hfe / rbe, i0 = p.hfe * vbe / rbe;
    if (mode === 'sat') { if (npn) ctx.C.vs(Cn, E, vsat, 0.5); else ctx.C.vs(E, Cn, vsat, 0.5); }
    else if (npn) ctx.C.vccs(Cn, E, B, E, gm, i0); else ctx.C.vccs(E, Cn, E, B, gm, i0);
  },
  post(ctx, c, part) {
    const p = part.p, npn = p.pol === 'npn';
    let ch = diodePost(ctx, c);
    const s = c.st.d && c.st.d.be; const vsat = p.darl ? 0.9 : 0.15;
    const vce = npn ? ctx.V(c, 'C') - ctx.V(c, 'E') : ctx.V(c, 'E') - ctx.V(c, 'C');
    const ib = diodeI(ctx, s); const mode = c.st.mode || 'off';
    if (ctx.iter > 60) return ch;
    if (!s || !s.on) { if (mode !== 'off') { c.st.mode = 'off'; ch = true; } return ch; }
    if (mode === 'off') { c.st.mode = 'act'; return true; }
    if (mode === 'act' && vce < vsat - 1e-3) { c.st.mode = 'sat'; return true; }
    if (mode === 'sat') { const ic = (vce - vsat) / 0.5; if (ic > p.hfe * ib * 1.0001) { c.st.mode = 'act'; return true; } }
    return ch;
  },
  measure(ctx, c, part) {
    const p = part.p, npn = p.pol === 'npn'; const s = c.st.d && c.st.d.be; const ib = diodeI(ctx, s);
    const vsat = p.darl ? 0.9 : 0.15; const vce = npn ? ctx.V(c, 'C') - ctx.V(c, 'E') : ctx.V(c, 'E') - ctx.V(c, 'C');
    let ic = 0; if (s && s.on) ic = c.st.mode === 'sat' ? Math.max(0, (vce - vsat) / 0.5) : p.hfe * ib;
    return { ib, ic: Math.abs(ic), vce };
  },
  check(ctx, c, part, add) {
    const m = c.mbase || {};
    if (m.ic > part.p.ic * 1.05) add('error', c, `${label(c, part)} collector current ${mA(m.ic)} exceeds ${part.p.ic}A`, 'Use a bigger transistor or a MOSFET.');
    if (m.ib > 0.02) add('warn', c, `${label(c, part)} base current ${mA(m.ib)} — missing base resistor?`, 'Put ≈1kΩ between the GPIO and the base.');
  },
};
export function mosRds(vgs, p) { if (vgs <= p.vth) return 1e8; const r = p.rds * (p.vspec - p.vth) / (vgs - p.vth); return Math.max(p.rds * 0.8, Math.min(1e8, r)); }
MODELS.mosfet = {
  stamp(ctx, c, part) {
    const p = part.p, n = p.pol === 'n';
    const vgs = c.st.vgs || 0; const r = mosRds(n ? vgs : -vgs, p);
    ctx.C.r(N(ctx, c, 'D'), N(ctx, c, 'S'), r);
    if (n) diode(ctx, c, 'body', N(ctx, c, 'S'), N(ctx, c, 'D'), 0.8, 0.05); else diode(ctx, c, 'body', N(ctx, c, 'D'), N(ctx, c, 'S'), 0.8, 0.05);
  },
  post(ctx, c, part) {
    let ch = diodePost(ctx, c);
    const vgs = ctx.V(c, 'G') - ctx.V(c, 'S'); const old = c.st.vgs || 0;
    const r1 = mosRds(part.p.pol === 'n' ? vgs : -vgs, part.p), r0 = mosRds(part.p.pol === 'n' ? old : -old, part.p);
    if (Math.abs(Math.log(r1 / r0)) > 0.002 && ctx.iter < 70) { c.st.vgs = old + (vgs - old) * (ctx.iter > 30 ? 0.5 : 1); ch = true; }
    return ch;
  },
  measure(ctx, c, part) { const vgs = ctx.V(c, 'G') - ctx.V(c, 'S'); const r = mosRds(part.p.pol === 'n' ? vgs : -vgs, part.p); const vds = ctx.V(c, 'D') - ctx.V(c, 'S'); return { id: Math.abs(vds / r), vgs, rds: r }; },
  check(ctx, c, part, add) {
    const m = c.mbase || {}, p = part.p, sim = ctx.sim;
    if (m.id > p.id) add('error', c, `${label(c, part)} drain current ${mA(m.id)} exceeds ${p.id}A`, 'Use a bigger MOSFET.');
    if (m.id * m.id * m.rds > 1 && !p.big) add('warn', c, `${label(c, part)} dissipates ${(m.id * m.id * m.rds).toFixed(2)}W`, 'It will get hot.');
    if (!p.logic && sim.gpioAt(c, 'G').length) add('warn', c, `${label(c, part)} is not logic-level: a 3.3V gate gives Rds ≈ ${fmtR(mosRds(3.3, p))} (it barely turns on)`, 'Use a logic-level MOSFET (IRLZ44N, IRLB8721) or a gate driver.');
    if (sim.gpioAt(c, 'G').length && sim.links(c, 'G') <= 1) add('info', c, `${label(c, part)} gate has no pull-down resistor`, 'Add 10–100kΩ G→S so the load stays off while the Pi boots.');
  },
};
const fmtR = (r) => (r > 1e6 ? '∞' : r >= 1000 ? (r / 1000).toFixed(1) + 'kΩ' : r.toFixed(r < 1 ? 3 : 1) + 'Ω');
// ================= Power =================
MODELS.battery = {
  stamp(ctx, c, part) { ctx.C.vs(N(ctx, c, '+'), N(ctx, c, '−'), part.p.v, part.p.rint); },
  measure(ctx, c, part) { const v = ctx.V(c, '+') - ctx.V(c, '−'); return { i: (part.p.v - v) / part.p.rint }; },
  check(ctx, c, part, add) {
    const i = (c.mbase && c.mbase.i) || 0, sim = ctx.sim;
    if (sim.root(c, '+') === sim.root(c, '−')) add('error', c, `${label(c, part)} is short-circuited`, 'Remove the wire across its terminals.');
    else if (i > part.p.imax * 1.5) add('error', c, `${label(c, part)} supplies ${mA(i)} — far beyond its ≈${part.p.imax}A`, 'Check for a short or use a bigger supply.');
    else if (i > part.p.imax) add('warn', c, `${label(c, part)} supplies ${mA(i)}, over its ≈${part.p.imax}A`, 'Use a stronger supply.');
    if (i < -0.01) add('warn', c, `${label(c, part)} is being charged backwards (${mA(i)})`, 'Two supplies are fighting — check polarity and connections.');
    if (sim.links(c, '+') > 0 && sim.root(c, '−') !== sim.gndRoot && sim.links(c, '−') > 0) {
      // only matters if this supply shares signals with the Pi
      add('info', c, `${label(c, part)}: its − is not joined to the Pi GND`, 'If a Pi GPIO controls something powered by this supply, connect the grounds.');
    }
  },
};
MODELS.regulator = {
  stamp(ctx, c, part) {
    const p = part.p, [inP, inM, outP, outM] = part.pins.length === 3 ? [part.pins[0].n, part.pins[1].n, part.pins[2].n, part.pins[1].n] : part.pins.map(q => q.n);
    const vin = ctx.V(c, inP) - ctx.V(c, inM); c.st.vin = vin;
    let vout = p.boost ? (vin > 2 ? p.vout : 0) : Math.max(0, Math.min(p.vout, vin - p.drop));
    if (vin < 0.5) vout = 0;
    ctx.C.vs(N(ctx, c, outP), N(ctx, c, outM), vout, 0.1);
    const iout = c.st.iout || 0; if (iout > 0) ctx.C.i(N(ctx, c, inP), N(ctx, c, inM), p.drop > 0 && !part.id.includes('lm2596') ? iout : iout * vout / Math.max(vin, 1) / 0.88);
    c.st.pins = [inP, inM, outP, outM]; c.st.vout = vout;
  },
  post(ctx, c, part) {
    const [inP, inM, outP, outM] = c.st.pins; const vin = ctx.V(c, inP) - ctx.V(c, inM);
    const v = ctx.V(c, outP) - ctx.V(c, outM); const io = (c.st.vout - v) / 0.1;
    let ch = false;
    if (Math.abs(vin - c.st.vin) > 0.01 && ctx.iter < 50) ch = true;
    if (Math.abs(io - (c.st.iout || 0)) > 0.001 && ctx.iter < 50) { c.st.iout = Math.max(0, io); ch = true; }
    return ch;
  },
  check(ctx, c, part, add) {
    const p = part.p; const [inP, inM] = c.st.pins || [];
    if (!inP) return; const vin = ctx.V(c, inP) - ctx.V(c, inM);
    if (!p.boost && vin > 0.5 && vin < p.vout + p.drop - 0.05) add('warn', c, `${label(c, part)} input ${V2(vin)} is below ${(p.vout + p.drop).toFixed(1)}V — output sags`, 'Feed it a higher input voltage.');
    if ((c.st.iout || 0) > p.imax) add('warn', c, `${label(c, part)} output ${mA(c.st.iout)} exceeds ${p.imax}A`, 'Use a bigger regulator.');
  },
};
MODELS.mb102 = {
  bridges: () => [['GND', 'GNDIN']],
  stamp(ctx, c) { const vin = ctx.V(c, 'VIN') - ctx.V(c, 'GND'); c.st.vin = vin; if (vin > 6.0) { ctx.C.vs(N(ctx, c, '5V'), N(ctx, c, 'GND'), 5, 0.1); ctx.C.vs(N(ctx, c, '3V3'), N(ctx, c, 'GND'), 3.3, 0.1); } },
  post(ctx, c) { const vin = ctx.V(c, 'VIN') - ctx.V(c, 'GND'); return (vin > 6.0) !== (c.st.vin > 6.0) && ctx.iter < 20; },
  check(ctx, c, part, add) { const vin = ctx.V(c, 'VIN') - ctx.V(c, 'GND'); if (ctx.sim.links(c, '5V') > 0 && vin < 6.0) add('warn', c, `${label(c, part)} has no input (needs 6.5–12V on VIN)`, 'Connect a 9V battery or 12V adapter to VIN/GNDIN.'); },
};

// ================= Actuators =================
MODELS.buzzer = {
  stamp(ctx, c, part) {
    const p = part.p, C = ctx.C;
    if (p.module === 'low') { // PNP low-side trigger module: I/O pulled up, buzzer on when I/O sits >0.6V below VCC
      C.r(N(ctx, c, 'VCC'), N(ctx, c, 'I/O'), 1e4);
      diode(ctx, c, 'eb', N(ctx, c, 'VCC'), N(ctx, c, 'I/O'), 0.65, 1000);
      if (c.st.d && c.st.d.eb && c.st.d.eb.on) C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), p.v / p.i);
      return;
    }
    const a = p.module ? 'S' : '+', k = p.module ? 'GND' : '−';
    diode(ctx, c, 'bz', N(ctx, c, a), N(ctx, c, k), 0.3, p.module ? (p.active ? 250 : 400) : p.v / p.i);
  },
  post: (ctx, c) => diodePost(ctx, c),
  measure(ctx, c, part) {
    const p = part.p;
    if (p.module === 'low') { const on = c.st.d && c.st.d.eb && c.st.d.eb.on; const vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); return { drive: on && vcc > 2.5 ? Math.min(1, vcc / p.v) : 0 }; }
    const a = p.module ? 'S' : '+', k = p.module ? 'GND' : '−'; const v = ctx.V(c, a) - ctx.V(c, k);
    return { drive: p.active ? (v > Math.min(2.4, p.v * 0.45) ? Math.min(1, v / p.v) : 0) : Math.max(0, v / Math.max(3.3, p.v)) };
  },
  check(ctx, c, part, add) {
    const p = part.p;
    if (p.module === 'low' && ctx.V(c, 'VCC') - ctx.V(c, 'GND') > 4 && ctx.sim.gpioAt(c, 'I/O').length) add('warn', c, `${label(c, part)} runs from 5V: a 3.3V HIGH cannot fully turn its PNP off, so it may never go quiet`, 'Power the module from 3.3V.');
    if (!p.active && c.m && c.m.drive > 0.05 && !(c.mdep && c.mdep.drive)) add('info', c, `${label(c, part)} is passive: steady DC only clicks, it needs a PWM tone`, 'Use GPIO.PWM(pin, 440) or gpiozero TonalBuzzer.');
  },
};
MODELS.motor = {
  stamp(ctx, c, part) { const p = part.p; ctx.C.r(N(ctx, c, '+'), N(ctx, c, '−'), p.v / p.i); },
  measure(ctx, c) { return { v: ctx.V(c, '+') - ctx.V(c, '−') }; },
  tick(c, part, t, dt) {
    const p = part.p, v = (c.m && c.m.v) || 0; let sp = Math.abs(v) < p.v * 0.15 ? 0 : v / p.v; if (p.style === 'fan' && sp < 0) sp = 0;
    c.st.speed = (c.st.speed || 0) + (sp - (c.st.speed || 0)) * Math.min(1, dt * 4);
    c.st.ang = ((c.st.ang || 0) + c.st.speed * Math.min(p.rpm || 300, 300) * 6 * dt) % 360;
    return false;
  },
  check(ctx, c, part, add) {
    const sim = ctx.sim, p = part.p, v = (c.mbase && c.mbase.v) || 0;
    if (sim.gpioAt(c, '+').length || sim.gpioAt(c, '−').length) add('error', c, `${label(c, part)} is wired to a GPIO pin — a motor needs ≈${mA(p.i)}, a GPIO gives 16mA`, 'Drive it with an L298N/TB6612/DRV8833 or a logic-level MOSFET + flyback diode.');
    if (p.style === 'fan' && v < -0.5) add('warn', c, `${label(c, part)} is wired backwards — brushless fans don't run reversed`, 'Swap + and −.');
    if (Math.abs(v) > p.v * 1.3) add('warn', c, `${label(c, part)} gets ${V2(Math.abs(v))}, above its ${p.v}V rating`, 'Lower the supply voltage.');
  },
};
MODELS.load = {
  stamp(ctx, c, part) { const p = part.p; ctx.C.r(N(ctx, c, '+'), N(ctx, c, '−'), p.v / p.i); },
  measure(ctx, c) { return { v: ctx.V(c, '+') - ctx.V(c, '−') }; },
  check(ctx, c, part, add) {
    const p = part.p, sim = ctx.sim;
    if (sim.gpioAt(c, '+').length || sim.gpioAt(c, '−').length) add('error', c, `${label(c, part)} needs ${p.i}A — never from a GPIO`, 'Switch it with a relay or MOSFET.');
    if (p.style === 'solenoid' && !hasFlyback(ctx, c, '+', '−')) add('warn', c, `${label(c, part)} is inductive and has no flyback diode`, 'Put a 1N4007 across it (band to +).');
  },
};
export function hasFlyback(ctx, c, a, b) {
  const sim = ctx.sim, ra = sim.root(c, a), rb = sim.root(c, b);
  for (const d of sim.project.comps) { if (!d.part.startsWith('d-') && !d.part.startsWith('z-')) continue; const A = sim.root(d, 'A'), K = sim.root(d, 'K'); if ((A === ra && K === rb) || (A === rb && K === ra)) return true; }
  return false;
}
MODELS.servo = {
  stamp(ctx, c, part) { ctx.C.r(N(ctx, c, 'V+'), N(ctx, c, 'GND'), 5 / 0.008); ctx.C.r(N(ctx, c, 'SIG'), N(ctx, c, 'GND'), 1e5); },
  measure(ctx, c) { return { sig: ctx.V(c, 'SIG') - ctx.V(c, 'GND'), vcc: ctx.V(c, 'V+') - ctx.V(c, 'GND') }; },
  after(ctx, c, part) {
    const p = part.p, m = c.m || {}, src = c.mdep && c.mdep.sig, vcc = (c.mbase && c.mbase.vcc) || 0;
    c.st.vcc = vcc;
    if (!src || !src.length) { c.st.pw = null; c.st.freq = null; return; }
    const s = src[0]; c.st.freq = s.freq; c.st.pw = s.duty / s.freq * 1e6; // µs
    if (vcc < p.vmin * 0.75 || (c.mbase.sig || 0) < 1.5) return;
    const pw = Math.max(p.pmin, Math.min(p.pmax, c.st.pw));
    if (p.continuous) { const mid = (p.pmin + p.pmax) / 2; const x = (c.st.pw - 1500) / ((p.pmax - p.pmin) / 2); c.st.spin = Math.abs(c.st.pw - 1500) < 25 ? 0 : Math.max(-1, Math.min(1, x)); }
    else c.st.target = (pw - p.pmin) / (p.pmax - p.pmin) * p.range;
  },
  tick(c, part, t, dt) {
    const p = part.p; if (c.st.ang === undefined) c.st.ang = p.continuous ? 0 : p.range / 2;
    if (p.continuous) { c.st.ang = (c.st.ang + (c.st.spin || 0) * p.rpm * 6 * dt) % 360; return false; }
    if (c.st.target === undefined) return false;
    const rate = 60 / p.speed; const d = c.st.target - c.st.ang; const stp = rate * dt;
    c.st.moving = Math.abs(d) > 0.5; c.st.ang += Math.abs(d) <= stp ? d : Math.sign(d) * stp;
    return false;
  },
  controls: () => [],
  check(ctx, c, part, add) {
    const p = part.p, vcc = c.st.vcc || 0, sim = ctx.sim;
    needPins(ctx, c, part, add, ['GND', 'V+', 'SIG']);
    if (vcc > 0.5 && vcc < p.vmin * 0.75) add('warn', c, `${label(c, part)} gets only ${V2(vcc)} — servos need ${p.vmin}–${p.vmax}V`, 'Power V+ from 5V (pin 2/4) or an external 5–6V supply.');
    if (vcc > p.vmax + 0.3) add('error', c, `${label(c, part)} supply ${V2(vcc)} exceeds ${p.vmax}V`, 'Lower the supply.');
    if (c.st.freq && (c.st.freq < 30 || c.st.freq > 400)) add('warn', c, `${label(c, part)} gets ${Math.round(c.st.freq)}Hz PWM; servos expect ≈50Hz`, 'Use GPIO.PWM(pin, 50) and duty 2.5–12.5%.');
    if (sim.links(c, 'SIG') > 0 && !c.st.pw && sim.pinRole(c, 'SIG')) add('info', c, `${label(c, part)}: no PWM pulses on SIG yet`, 'Start PWM on that pin (RPi.GPIO PWM, gpiozero Servo, or a PCA9685).');
    if (sim.pinRole(c, 'V+') === '3V3') add('warn', c, `${label(c, part)} powered from 3.3V — too weak and it can brown out the Pi`, 'Use 5V or a separate supply.');
  },
};
MODELS.relay = {
  stamp(ctx, c, part) { const C = ctx.C; C.r(N(ctx, c, 'C1'), N(ctx, c, 'C2'), part.p.r); C.r(N(ctx, c, 'COM'), N(ctx, c, c.st.on ? 'NO' : 'NC'), 0.02); },
  logic(ctx, c, part) {
    const v = Math.abs(ctx.V(c, 'C1') - ctx.V(c, 'C2')); const p = part.p; let on = c.st.on;
    if (!on && v >= 0.75 * p.v) on = true; else if (on && v < 0.1 * p.v) on = false;
    if (on !== !!c.st.on) { c.st.on = on; c.st.click = performance.now(); return true; } return false;
  },
  check(ctx, c, part, add) {
    const sim = ctx.sim; const v = Math.abs(ctx.V(c, 'C1') - ctx.V(c, 'C2'));
    if (sim.gpioAt(c, 'C1').length || sim.gpioAt(c, 'C2').length) add('error', c, `${label(c, part)} coil needs ≈${mA(part.p.v / part.p.r)} — too much for a GPIO`, 'Switch the coil with an NPN (2N2222 + 1k base) and add a flyback diode.');
    else if (v > 0.5 && !hasFlyback(ctx, c, 'C1', 'C2')) add('warn', c, `${label(c, part)} coil has no flyback diode`, 'Put a 1N4007 across the coil (band towards +).');
    if (v > 0.5 && v < 0.75 * part.p.v) add('warn', c, `${label(c, part)} coil gets ${V2(v)} — not enough to pull in (needs ${(0.75 * part.p.v).toFixed(1)}V)`, 'Use the right coil voltage.');
  },
};
MODELS.relaymod = {
  stamp(ctx, c, part) {
    const p = part.p, C = ctx.C, ch = p.ch; c.st.on = c.st.on || [];
    for (let i = 1; i <= ch; i++) {
      if (p.trig === 'low') diode(ctx, c, 'in' + i, N(ctx, c, 'VCC'), N(ctx, c, 'IN' + i), 2.4, 1000);
      else { diode(ctx, c, 'in' + i, N(ctx, c, 'IN' + i), N(ctx, c, 'GND'), 1.2, 1000); }
      const on = !!c.st.on[i];
      if (on) C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), p.coilV / p.coilI);
      C.r(N(ctx, c, 'COM' + i), N(ctx, c, (on ? 'NO' : 'NC') + i), 0.02);
    }
  },
  post: (ctx, c) => diodePost(ctx, c),
  logic(ctx, c, part) {
    const p = part.p, vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); let ch = false;
    for (let i = 1; i <= p.ch; i++) {
      const led = c.st.d && c.st.d['in' + i] && diodeI(ctx, c.st.d['in' + i]) > 0.0004;
      const on = led && vcc >= 0.75 * p.coilV;
      c.st.led = c.st.led || []; c.st.led[i] = led;
      if (on !== !!c.st.on[i]) { c.st.on[i] = on; c.st.click = performance.now(); ch = true; }
    }
    return ch;
  },
  check(ctx, c, part, add) {
    const p = part.p, vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND');
    needPins(ctx, c, part, add, ['VCC', 'GND']);
    if (vcc > 0.5 && vcc < 0.75 * p.coilV) add('warn', c, `${label(c, part)} VCC is ${V2(vcc)}: the input LED lights but the ${p.coilV}V coil cannot pull in`, 'Power VCC from 5V (pin 2/4).');
    if (vcc > 0.5) for (let i = 1; i <= p.ch; i++) if (ctx.sim.links(c, 'IN' + i) <= 0 && p.trig === 'low') add('info', c, `IN${i} of ${label(c, part)} is unconnected (stays OFF)`, '');
    if (p.ssr) add('info', c, 'SSR G3MB-202P switches AC only — with a DC load it may never turn off', 'Use a mechanical relay or MOSFET for DC.');
  },
};

// ================= Sensor modules =================
export function drive(ctx, c, pin, gnd, level, vhigh, type) {
  const C = ctx.C, a = N(ctx, c, pin), g = N(ctx, c, gnd);
  if (type === 'oc') { if (!level) C.r(a, g, 30); return; }
  if (type === 'pp') { C.vs(a, g, level ? vhigh : 0, 100); return; }
  if (level) C.vs(a, g, vhigh, 1e4); else C.vs(a, g, 0, 50); // LM393 open collector + 10k pull-up to VCC
}
function powerCheck(ctx, c, part, add, vmin, vmax) {
  const v = supply(ctx, c, part); const vn = vccOf(part);
  needPins(ctx, c, part, add, [vn, gndOf(part)].filter(Boolean));
  if (ctx.sim.links(c, vn) > 0 && v > 0.3 && v < vmin * 0.95) add('warn', c, `${label(c, part)} gets ${V2(v)} — needs at least ${vmin}V`, vmin > 3.4 ? 'Power it from the 5V pin.' : 'Check the supply wiring.');
  if (v > vmax + 0.25) add('error', c, `${label(c, part)} gets ${V2(v)}, above its ${vmax}V maximum — it will be damaged`, 'Power it from 3.3V.');
  return v;
}
function outToGpio(ctx, c, part, add, pin, vhigh) {
  if (!pin || !ctx.sim.gpioAt(c, pin).length) return;
  if (vhigh > 3.6) add('warn', c, `${label(c, part)}: ${pin} swings up to ${V2(vhigh)} into a 3.3V GPIO`, 'Power the module from 3.3V if it supports it, or add a 1k/2k divider / level shifter.');
}
const CTL_LABEL = { detect: 'Obstacle in front', touch: 'Touch', black: 'Over black line', block: 'Beam blocked', tilt: 'Tilted', vibrate: 'Vibration', magnet: 'Magnet nearby' };
MODELS.digimod = {
  stamp(ctx, c, part) {
    const p = part.p, v = supply(ctx, c, part); const vn = vccOf(part), gn = gndOf(part);
    ctx.C.r(N(ctx, c, vn), N(ctx, c, gn), 5 / p.iq);
    c.st.pw = v >= p.vmin * 0.9;
    const outPin = pick(part, ['OUT', 'DO', 'S', 'I/O']);
    let active = p.toggle ? !!c.st.latched : p.latch ? !!c.st.latched : !!(c.st.pressed || ctl(c, 'on', false));
    const level = p.act === 'high' ? active : !active;
    if (c.st.pw) drive(ctx, c, outPin, gn, level, v, p.out === 'vcc' ? 'vcc' : p.out);
    if (p.ao && c.st.pw) ctx.C.vs(N(ctx, c, 'AO'), N(ctx, c, gn), active ? v * 0.8 : v * 0.2, 1000);
    c.st.out = c.st.pw ? level : null;
  },
  post(ctx, c, part) { const v = supply(ctx, c, part); return (v >= part.p.vmin * 0.9) !== c.st.pw && ctx.iter < 20; },
  controls(part) {
    const p = part.p;
    if (p.latch) return [{ key: 'south', type: 'action', label: 'South pole near (latch)' }, { key: 'north', type: 'action', label: 'North pole near (release)' }];
    if (p.ctl === 'touch' || p.ctl === 'vibrate') return [{ key: 'pressed', type: 'momentary', label: p.ctl === 'touch' ? 'Touch pad' : 'Knock / shake' }];
    return [{ key: 'on', type: 'toggle', label: CTL_LABEL[p.ctl] || 'Active', def: false }];
  },
  action(c, part, key) { if (key === 'south') c.st.latched = true; if (key === 'north') c.st.latched = false; },
  press(c, part, down) { if (part.p.toggle && down) c.st.latched = !c.st.latched; },
  check(ctx, c, part, add) {
    const p = part.p; const v = powerCheck(ctx, c, part, add, p.vmin, p.vmax);
    const outPin = pick(part, ['OUT', 'DO', 'S', 'I/O']);
    if (p.out !== 'oc') outToGpio(ctx, c, part, add, outPin, v);
    if (p.out === 'oc' && ctx.sim.gpioAt(c, outPin).length) {
      const pull = ctx.sim.gpioAt(c, outPin).some(b => ctx.sim.gpio[b].pull === 'up');
      if (!pull && !hasPullUp(ctx, c, outPin)) add('warn', c, `${label(c, part)} has an open-collector output with no pull-up — it floats when inactive`, 'Use pull_up_down=GPIO.PUD_UP (or Button(pin) in gpiozero) or add a 10k to 3.3V.');
    }
  },
};
export function hasPullUp(ctx, c, pin) {
  const sim = ctx.sim, r = sim.root(c, pin); const pi = sim.pi(); if (!pi) return false;
  const rails = [sim.root(pi, 'P1'), sim.root(pi, 'P2')];
  for (const d of sim.project.comps) { if (!d.part.startsWith('res-')) continue; const a = sim.root(d, '1'), b = sim.root(d, '2'); if ((a === r && rails.includes(b)) || (b === r && rails.includes(a))) return true; }
  for (const d of sim.project.comps) { const pp = d.part; if (pp === c.part) continue; }
  return false;
}
// analog modules with optional comparator output
function anaFrac(c, p, vcc) {
  switch (p.ctl) {
    case 'light': { const lux = ctl(c, 'lux', 300); const r = ldrR(lux, { r10: 15e3, dark: 1e6, g: 0.6 }); return r / (r + 1e4); }
    case 'lux': return Math.min(1, ctl(c, 'lux', 300) * 0.005 / vcc);
    case 'ppm': { const ppm = ctl(c, 'ppm', 0); return ppm <= 0 ? 0.06 : Math.min(0.97, 0.06 + 0.88 * Math.log10(1 + 9 * ppm / p.lo) / Math.log10(1 + 9 * p.hi / p.lo)); }
    case 'moisture': return 0.92 - 0.6 * ctl(c, 'moisture', 30) / 100;
    case 'wet': return 0.95 - 0.75 * ctl(c, 'wet', 0) / 100;
    case 'level': return 0.02 + 0.65 * ctl(c, 'level', 0) / 40;
    case 'flame': return 0.95 - 0.85 * ctl(c, 'flame', 0) / 100;
    case 'sound': { const db = ctl(c, 'db', 40); return 0.5 + Math.max(0, (db - 35) / 75) * 0.45 * (Math.random() * 2 - 1); }
    case 'field': return Math.max(0.04, Math.min(0.96, 0.5 + ctl(c, 'gauss', 0) * 0.00036));
  }
  return 0.5;
}
const ANA_CTL = {
  light: { key: 'lux', label: 'Light', min: 0, max: 2000, step: 1, unit: 'lux', def: 300 }, lux: { key: 'lux', label: 'Light', min: 0, max: 1000, step: 1, unit: 'lux', def: 300 },
  moisture: { key: 'moisture', label: 'Soil moisture', min: 0, max: 100, step: 1, unit: '%', def: 30 }, wet: { key: 'wet', label: 'Rain on the plate', min: 0, max: 100, step: 1, unit: '%', def: 0 },
  level: { key: 'level', label: 'Water depth', min: 0, max: 40, step: 0.5, unit: 'mm', def: 0 }, flame: { key: 'flame', label: 'Flame intensity', min: 0, max: 100, step: 1, unit: '%', def: 0 },
  sound: { key: 'db', label: 'Sound level', min: 30, max: 110, step: 1, unit: 'dB', def: 40 }, field: { key: 'gauss', label: 'Magnetic field', min: -1000, max: 1000, step: 10, unit: 'G', def: 0 },
};
// DO behaviour: which way the comparator trips
const DO_LOW_WHEN_HIGH_AO = { ppm: true }; // MQ: DO LOW above threshold
MODELS.anamod = {
  stamp(ctx, c, part) {
    const p = part.p, v = supply(ctx, c, part), vn = vccOf(part), gn = gndOf(part);
    ctx.C.r(N(ctx, c, vn), N(ctx, c, gn), 5 / p.iq);
    c.st.pw = v >= (p.ctl === 'ppm' ? 2.5 : p.vmin * 0.9);
    if (!c.st.pw) { c.st.do = null; return; }
    const f = anaFrac(c, p, v); c.st.frac = f;
    const ao = pick(part, ['AO', 'AOUT', 'SIG']) || (!p.dout || p.onlyDo ? null : null) || (!p.dout ? pick(part, ['OUT', 'S']) : null);
    if (ao && !p.onlyDo) ctx.C.vs(N(ctx, c, ao), N(ctx, c, gn), f * v, p.temt ? 1e4 : 1000);
    if (p.dout) {
      const doPin = pick(part, ['DO', 'OUT']); const thr = ctl(c, 'thr', 0.5);
      let trig;
      if (p.ctl === 'sound') trig = ctl(c, 'db', 40) >= 35 + thr * 75; else if (p.ctl === 'light') trig = f > thr; else trig = DO_LOW_WHEN_HIGH_AO[p.ctl] ? f > thr : f < thr;
      let level = !trig; // most LM393 boards pull DO LOW when triggered
      if (p.ctl === 'light') level = trig; // DO HIGH in the dark
      if (p.ctl === 'sound' && part.id !== 'snd-lm393') level = trig; // KY-037/038: DO HIGH on loud sound
      c.st.do = level; drive(ctx, c, doPin, gn, level, v, 'vcc');
    }
  },
  post(ctx, c, part) { const v = supply(ctx, c, part); return (v >= (part.p.ctl === 'ppm' ? 2.5 : part.p.vmin * 0.9)) !== c.st.pw && ctx.iter < 20; },
  controls(part) { const L = [ANA_CTL[part.p.ctl] || ANA_CTL[part.p.ctl === 'ppm' ? 'x' : part.p.ctl]].filter(Boolean);
    if (part.p.ctl === 'ppm') L.push({ key: 'ppm', label: 'Gas concentration', min: 0, max: part.p.hi, step: Math.max(1, part.p.hi / 500), unit: part.id === 'gas-mq131' ? 'ppb' : 'ppm', def: 0 });
    if (part.p.dout) L.push({ key: 'thr', label: 'Sensitivity pot (threshold)', min: 0.05, max: 0.95, step: 0.01, def: 0.5, fmt: (v) => Math.round(v * 100) + '%' });
    return L; },
  check(ctx, c, part, add) {
    const p = part.p, v = powerCheck(ctx, c, part, add, p.ctl === 'ppm' ? 4.5 : p.vmin, p.vmax);
    const ao = pick(part, ['AO', 'AOUT', 'SIG']) || (!p.dout ? pick(part, ['OUT', 'S']) : null);
    if (ao && !p.onlyDo && ctx.sim.gpioAt(c, ao).length) add('warn', c, `${label(c, part)} ${ao} is analog — the Pi has no analog inputs`, 'Read it with an MCP3008 (SPI) or ADS1115 (I2C).');
    if (ao && v > 3.6 && ctx.sim.gpioAt(c, ao).length) add('warn', c, `${label(c, part)} ${ao} can reach ${V2(v)}`, 'Use a divider.');
    if (p.dout) outToGpio(ctx, c, part, add, pick(part, ['DO', 'OUT']), v);
    if (p.ctl === 'ppm') add('info', c, `${part.name}: heater draws ≈150mA from 5V`, 'Readings settle after a warm-up on real hardware (minutes to 24h burn-in).');
  },
};

MODELS.pir = {
  stamp(ctx, c, part) {
    const p = part.p, isR = part.id.startsWith('radar'); const vn = isR ? 'VIN' : 'VCC';
    const v = ctx.V(c, vn) - ctx.V(c, 'GND'); ctx.C.r(N(ctx, c, vn), N(ctx, c, 'GND'), 5 / (isR ? 0.003 : p.iq));
    c.st.pw = v >= p.vmin * 0.95 && v <= p.vmax + 0.5;
    if (isR && c.st.pw) ctx.C.vs(N(ctx, c, '3V3'), N(ctx, c, 'GND'), 3.3, 5);
    const high = c.st.pw && (ctx.t < (c.st.until || 0) || ctl(c, 'motion', false));
    c.st.out = c.st.pw ? high : null;
    if (c.st.pw) ctx.C.vs(N(ctx, c, 'OUT'), N(ctx, c, 'GND'), high ? Math.min(p.outV, v) : 0, 100);
  },
  post(ctx, c, part) { const isR = part.id.startsWith('radar'); const v = ctx.V(c, isR ? 'VIN' : 'VCC') - ctx.V(c, 'GND'); return (v >= part.p.vmin * 0.95 && v <= part.p.vmax + 0.5) !== c.st.pw && ctx.iter < 20; },
  controls: (part) => [{ key: 'wave', type: 'action', label: 'Walk past the sensor' }, { key: 'motion', type: 'toggle', label: 'Keep moving in front', def: false }, { key: 'hold', type: 'range', label: 'Hold time (delay pot)', min: 1, max: 30, step: 1, unit: 's', def: part.p.hold }],
  action(c, part, key, sim) { if (key === 'wave') c.st.until = sim.now() + ctl(c, 'hold', part.p.hold); },
  tick(c, part, t) { const m = ctl(c, 'motion', false); if (c.st.motionWas && !m) c.st.until = t + ctl(c, 'hold', part.p.hold); c.st.motionWas = m; const high = t < (c.st.until || 0) || m; return !!c.st.pw && high !== c.st.out; },
  check(ctx, c, part, add) { const isR = part.id.startsWith('radar'); const v = ctx.V(c, isR ? 'VIN' : 'VCC') - ctx.V(c, 'GND');
    needPins(ctx, c, part, add, [isR ? 'VIN' : 'VCC', 'GND', 'OUT']);
    if (ctx.sim.links(c, isR ? 'VIN' : 'VCC') > 0 && v > 0.3 && v < part.p.vmin * 0.95) add('warn', c, `${label(c, part)} needs ${part.p.vmin}–${part.p.vmax}V but gets ${V2(v)}`, part.p.vmin > 3.4 ? 'Power VCC from the 5V pin — its OUT stays 3.3V, safe for GPIO.' : 'Check power wiring.'); },
};
MODELS.ultrasonic = {
  stamp(ctx, c, part) {
    const p = part.p, v = ctx.V(c, 'VCC') - ctx.V(c, 'GND');
    ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / p.iq);
    c.st.pw = v >= p.vmin * 0.93;
    if (c.st.pw) ctx.C.vs(N(ctx, c, 'Echo'), N(ctx, c, 'GND'), c.st.echo ? v : 0, 100);
    ctx.C.r(N(ctx, c, 'Trig'), N(ctx, c, 'GND'), 1e5);
  },
  post(ctx, c, part) { const v = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); return (v >= part.p.vmin * 0.93) !== c.st.pw && ctx.iter < 20; },
  logic(ctx, c, part) {
    if (ctx.whatIf) return false;
    const trig = ctx.V(c, 'Trig') - ctx.V(c, 'GND') > 1.5; const prev = c.st.trig; c.st.trig = trig;
    if (prev && !trig && c.st.pw) ctx.sim.fireEcho(c, part);
    return false;
  },
  controls: (part) => [{ key: 'dist', type: 'range', label: 'Distance to object', min: 0, max: 500, step: 0.5, unit: 'cm', def: 50 }],
  check(ctx, c, part, add) {
    const p = part.p, v = ctx.V(c, 'VCC') - ctx.V(c, 'GND');
    needPins(ctx, c, part, add, ['VCC', 'GND', 'Trig', 'Echo']);
    if (ctx.sim.links(c, 'VCC') > 0 && v > 0.3 && v < p.vmin * 0.93) add('warn', c, `${label(c, part)} needs ${p.vmin}–${p.vmax}V (gets ${V2(v)}) — it won't range`, 'Power it from 5V and divide Echo down to 3.3V.');
    if (v > 3.6 && ctx.sim.gpioAt(c, 'Echo').length) add('error', c, `${label(c, part)} Echo drives ${V2(v)} straight into a 3.3V GPIO`, 'Add a voltage divider: Echo → 1kΩ → GPIO → 2kΩ → GND.');
    const d = ctl(c, 'dist', 50);
    if (d < p.minD || d > p.maxD) add('info', c, `${label(c, part)}: ${d}cm is outside its ${p.minD}–${p.maxD}cm range — no valid echo`, '');
  },
};
MODELS.dht = {
  stamp(ctx, c, part) {
    ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.0015);
    if (!part.p.bare) ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'DATA'), 1e4);
  },
  controls: (part) => [{ key: 'temp', type: 'range', label: 'Temperature', min: part.p.t === 11 ? 0 : -40, max: part.p.t === 11 ? 50 : 80, step: 0.1, unit: '°C', def: 24 }, { key: 'hum', type: 'range', label: 'Humidity', min: part.p.t === 11 ? 20 : 0, max: part.p.t === 11 ? 90 : 100, step: 0.1, unit: '%RH', def: 55 }],
  check(ctx, c, part, add) {
    const v = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); needPins(ctx, c, part, add, ['VCC', 'GND', 'DATA']);
    if (ctx.sim.links(c, 'VCC') > 0 && v > 0.3 && v < 3.0) add('warn', c, `${label(c, part)} needs 3.3–5.5V (gets ${V2(v)})`, '');
    if (v > 5.7) add('error', c, `${label(c, part)} gets ${V2(v)}, above 5.5V`, '');
    if (part.p.bare && !hasPullUp(ctx, c, 'DATA')) add('warn', c, `${label(c, part)} DATA has no pull-up resistor`, 'Add 4.7k–10kΩ from DATA to VCC (modules have one built in).');
    if (v > 3.6 && part.p.bare === false && ctx.sim.gpioAt(c, 'DATA').length) add('info', c, `${label(c, part)} at ${V2(v)}: its pull-up lifts DATA to ${V2(v)}`, 'Power DHT modules from 3.3V when wired to a Pi GPIO.');
  },
};
MODELS.ds18b20 = {
  stamp(ctx, c, part) { ctx.C.r(N(ctx, c, 'VDD'), N(ctx, c, 'GND'), 5 / 0.001); if (part.p.mod) ctx.C.r(N(ctx, c, 'VDD'), N(ctx, c, 'DQ'), 4700); },
  controls: () => [{ key: 'temp', type: 'range', label: 'Temperature', min: -55, max: 125, step: 0.0625, unit: '°C', def: 22.5 }],
  check(ctx, c, part, add) {
    needPins(ctx, c, part, add, ['VDD', 'GND', 'DQ']);
    const g = ctx.sim.gpioAt(c, 'DQ');
    if (ctx.sim.links(c, 'DQ') > 0 && !g.includes(4)) add('warn', c, `${label(c, part)} DQ is not on GPIO4 — the default 1-Wire pin (physical pin 7)`, 'Move DQ to GPIO4 (dtoverlay=w1-gpio uses GPIO4).');
    if (!part.p.mod && !hasPullUp(ctx, c, 'DQ')) add('warn', c, `${label(c, part)} needs a 4.7kΩ pull-up from DQ to 3.3V`, 'Without it the bus never sees the sensor.');
    const v = ctx.V(c, 'VDD') - ctx.V(c, 'GND'); if (v > 3.6 && g.length) add('warn', c, `${label(c, part)} VDD is ${V2(v)} — with the pull-up to VDD that puts ${V2(v)} on GPIO`, 'Power DS18B20 from 3.3V on a Pi.');
  },
};
function busCheck(ctx, c, part, add, sda, scl) {
  const sim = ctx.sim, gs = sim.gpioLogical ? sim.gpioLogical(c, sda) : sim.gpioAt(c, sda), gc = sim.gpioLogical ? sim.gpioLogical(c, scl) : sim.gpioAt(c, scl);
  if (sim.links(c, sda) > 0 && !gs.includes(2)) add('error', c, `${label(c, part)} ${sda} must go to GPIO2 (SDA, pin 3)${gs.length ? ' — it is on GPIO' + gs[0] : ''}`, 'I2C bus 1 lives on pins 3 (SDA) and 5 (SCL).');
  if (sim.links(c, scl) > 0 && !gc.includes(3)) add('error', c, `${label(c, part)} ${scl} must go to GPIO3 (SCL, pin 5)${gc.length ? ' — it is on GPIO' + gc[0] : ''}`, 'Swap SDA/SCL if they are crossed.');
  if (gs.includes(3) && gc.includes(2)) add('error', c, `${label(c, part)}: SDA and SCL are swapped`, 'SDA → pin 3, SCL → pin 5.');
}
export const I2C_SDA = (part) => pick(part, ['SDA']); export const I2C_SCL = (part) => pick(part, ['SCL']);
MODELS.i2c = {
  init(c, part) { const chip = CHIPS[part.p.chip]; if (chip && chip.init) chip.init(c, part); },
  stamp(ctx, c, part) {
    const vn = vccOf(part), gn = gndOf(part); const p = part.p;
    ctx.C.r(N(ctx, c, vn), N(ctx, c, gn), 5 / (p.iq || 0.001));
    ctx.C.r(N(ctx, c, vn), N(ctx, c, 'SDA'), 1e4); ctx.C.r(N(ctx, c, vn), N(ctx, c, 'SCL'), 1e4);
    const chip = CHIPS[p.chip]; if (chip && chip.stamp) chip.stamp(ctx, c, part);
  },
  post(ctx, c, part) { const chip = CHIPS[part.p.chip]; return chip && chip.post ? chip.post(ctx, c, part) : false; },
  pwmSources(c, part, sim) { const chip = CHIPS[part.p.chip]; return chip && chip.pwmSources ? chip.pwmSources(c, part, sim) : []; },
  controls(part) { const chip = CHIPS[part.p.chip]; return chip && chip.controls ? chip.controls(part) : []; },
  check(ctx, c, part, add) {
    const p = part.p; const v = powerCheck(ctx, c, part, add, p.vmin, p.vmax);
    busCheck(ctx, c, part, add, 'SDA', 'SCL');
    const chip = CHIPS[p.chip]; if (chip && chip.check) chip.check(ctx, c, part, add);
    for (const d of ctx.sim.project.comps) { if (d === c || !d.part) continue; const q = ctx.sim.partOf(d); if (!q || !q.p || q.p.addr !== p.addr || q.p.bus === 'parallel') continue;
      if (ctx.sim.root(d, 'SDA') === ctx.sim.root(c, 'SDA') && d.id > c.id) add('error', c, `I2C address clash: ${label(c, part)} and ${label(d, q)} are both 0x${p.addr.toString(16).toUpperCase()}`, 'Change one module’s address jumper (ADDR/AD0/A0) or use a TCA9548A multiplexer.'); }
  },
};
export const CHIPS = {}; // filled by i2cchips.js

// ================= Displays =================
import { HD44780, SSD1306 } from './chips.js';
MODELS.lcd = {
  init(c, part) { c.st.lcd = new HD44780(part.p.cols, part.p.rows); c.st.port = 0; },
  stamp(ctx, c, part) {
    const p = part.p, C = ctx.C;
    if (p.bus === 'i2c') { C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.025); C.r(N(ctx, c, 'VCC'), N(ctx, c, 'SDA'), 4700); C.r(N(ctx, c, 'VCC'), N(ctx, c, 'SCL'), 4700); }
    else { C.r(N(ctx, c, 'VDD'), N(ctx, c, 'VSS'), 5 / 0.0015); diode(ctx, c, 'bl', N(ctx, c, 'A'), N(ctx, c, 'K'), 3.0, 20); }
  },
  post: (ctx, c) => diodePost(ctx, c),
  logic(ctx, c, part) { // parallel HD44780: latch on E falling edge
    if (part.p.bus !== 'parallel' || ctx.whatIf) return false;
    const g = (n) => ctx.V(c, n) - ctx.V(c, 'VSS') > 1.6;
    const e = g('E'); const prev = c.st.e; c.st.e = e;
    if (prev && !e && c.st.lcd) { const d = ['D4', 'D5', 'D6', 'D7'].reduce((a, n, i) => a | ((g(n) ? 1 : 0) << i), 0); const lo = ['D0', 'D1', 'D2', 'D3'].reduce((a, n, i) => a | ((g(n) ? 1 : 0) << i), 0);
      c.st.lcd.strobe(g('RS') ? 1 : 0, d, lo); c.st.dirty = true; }
    return false;
  },
  measure(ctx, c, part) { return part.p.bus === 'parallel' ? { bl: diodeI(ctx, c.st.d && c.st.d.bl), v: ctx.V(c, 'VDD') - ctx.V(c, 'VSS') } : { v: ctx.V(c, 'VCC') - ctx.V(c, 'GND') }; },
  after(ctx, c, part) { c.st.vcc = (c.mbase && c.mbase.v) || 0; },
  check(ctx, c, part, add) {
    const p = part.p, v = c.st.vcc || 0;
    if (p.bus === 'i2c') { needPins(ctx, c, part, add, ['GND', 'VCC', 'SDA', 'SCL']); busCheck(ctx, c, part, add, 'SDA', 'SCL'); }
    else { needPins(ctx, c, part, add, ['VSS', 'VDD', 'RS', 'E', 'D4', 'D5', 'D6', 'D7']); if (ctx.sim.links(c, 'RW') <= 0) add('warn', c, 'LCD RW pin is unconnected', 'Tie RW to GND (write-only).'); if (ctx.sim.links(c, 'V0') <= 0) add('info', c, 'LCD V0 (contrast) unconnected — text may be invisible on real hardware', 'Use a 10k pot or tie V0 to GND through ≈1–2kΩ.'); }
    if (v > 0.3 && v < 4.2) add('warn', c, `${label(c, part)} runs at ${V2(v)} — a 5V LCD shows very faint text at 3.3V`, 'Power the LCD from 5V.');
    if (p.bus === 'i2c' && v > 4.2 && ctx.sim.gpioAt(c, 'SDA').length) add('info', c, `${label(c, part)} at 5V pulls SDA/SCL towards 5V through its 4.7k resistors`, 'Most people get away with it (the Pi’s 1.8k pull-ups win); a level shifter is the safe fix.');
  },
};
MODELS.oled = {
  init(c, part) { c.st.oled = new SSD1306(part.p.w, part.p.h, part.p.ctrl); },
  stamp(ctx, c, part) { ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.02); ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'SDA'), 1e4); ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'SCL'), 1e4); },
  measure(ctx, c) { return { v: ctx.V(c, 'VCC') - ctx.V(c, 'GND') }; },
  after(ctx, c) { c.st.vcc = (c.mbase && c.mbase.v) || 0; },
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['GND', 'VCC', 'SDA', 'SCL']); busCheck(ctx, c, part, add, 'SDA', 'SCL'); const v = c.st.vcc || 0; if (ctx.sim.links(c, 'VCC') > 0 && v > 0.3 && v < 3.0) add('warn', c, `${label(c, part)} needs 3.3–5V`, ''); },
};
MODELS.max7219 = {
  init(c, part) { const n = part.p.chain; c.st.mx = { regs: Array.from({ length: n }, () => ({ digits: new Array(8).fill(0), decode: 0, intensity: 0, scan: 0, shut: 0, test: 0 })), sr: [] }; },
  stamp(ctx, c) { ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.01); },
  measure(ctx, c) { let on = 0; const mx = c.st.mx; if (mx) for (const r of mx.regs) if (r.shut) for (const d of r.digits) for (let b = 0; b < 8; b++) on += (d >> b) & 1; return { v: ctx.V(c, 'VCC') - ctx.V(c, 'GND'), on }; },
  after(ctx, c) { c.st.vcc = (c.mbase && c.mbase.v) || 0; },
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['VCC', 'GND', 'DIN', 'CS', 'CLK']); spiCheck(ctx, c, part, add, { DIN: 10, CLK: 11 }, 'CS'); },
};
export function spiCheck(ctx, c, part, add, map, csPin) {
  const sim = ctx.sim;
  const G = (p) => (sim.gpioLogical ? sim.gpioLogical(c, p) : sim.gpioAt(c, p));
  for (const [pin, bcm] of Object.entries(map)) if (sim.links(c, pin) > 0 && !G(pin).includes(bcm)) add('error', c, `${label(c, part)} ${pin} must go to GPIO${bcm} (${{ 10: 'MOSI, pin 19', 9: 'MISO, pin 21', 11: 'SCLK, pin 23' }[bcm]})`, 'SPI0 uses fixed pins.');
  const cs = G(csPin);
  if (sim.links(c, csPin) > 0 && !cs.includes(8) && !cs.includes(7)) add('warn', c, `${label(c, part)} ${csPin} is not on CE0 (GPIO8) or CE1 (GPIO7)`, 'spidev.open(0, 0) uses CE0, open(0, 1) uses CE1.');
}
MODELS.tm1637 = {
  init(c) { c.st.tm = { seg: [0, 0, 0, 0], on: false, bright: 7, state: 'idle', bits: 0, n: 0, bytes: [], addr: 0 }; },
  stamp(ctx, c) { ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.02); ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'CLK'), 1e4); ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'DIO'), 1e4); },
  logic(ctx, c) {
    if (ctx.whatIf) return false;
    const vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); if (vcc < 2.5) return false;
    const th = vcc * 0.5; const clk = ctx.V(c, 'CLK') - ctx.V(c, 'GND') > th, dio = ctx.V(c, 'DIO') - ctx.V(c, 'GND') > th;
    const s = c.st.tm, pc = s.clk, pd = s.dio; s.clk = clk; s.dio = dio;
    if (pc === undefined) return false;
    if (clk && pc && pd && !dio) { s.state = 'data'; s.bits = 0; s.n = 0; s.bytes = []; return false; } // start
    if (clk && pc && !pd && dio) { tmFrame(s); s.state = 'idle'; c.st.dirty = true; return false; } // stop
    if (s.state === 'data' && clk && !pc) { // rising edge: sample a bit (LSB first); 9th clock = ACK
      if (s.n < 8) { s.bits |= (dio ? 1 : 0) << s.n; s.n++; } else { s.bytes.push(s.bits); s.bits = 0; s.n = 0; }
    }
    return false;
  },
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['CLK', 'DIO', 'VCC', 'GND']); },
};
function tmFrame(s) {
  const b = s.bytes; if (!b.length) return;
  const cmd = b[0];
  if ((cmd & 0xC0) === 0x40) { s.fixed = !!(cmd & 0x04); }
  else if ((cmd & 0xC0) === 0xC0) { let a = cmd & 0x03; for (let i = 1; i < b.length; i++) { if (a < 4) s.seg[a] = b[i]; if (!s.fixed) a++; } }
  else if ((cmd & 0xF0) === 0x80) { s.on = !!(cmd & 0x08); s.bright = cmd & 0x07; }
}
MODELS.ws2812 = {
  init(c, part) { c.st.px = new Array(part.p.count).fill(0); },
  stamp(ctx, c, part) {
    ctx.C.r(N(ctx, c, '5V'), N(ctx, c, 'GND'), 5 / (0.0006 * part.p.count));
    let amps = 0; for (const v of c.st.px || []) amps += (((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255)) / 255 * 0.02;
    if (amps > 0) { const vv = ctx.V(c, '5V') - ctx.V(c, 'GND'); if (vv > 2.5) ctx.C.i(N(ctx, c, '5V'), N(ctx, c, 'GND'), amps * Math.min(1, vv / 5)); }
    c.st.amps = amps;
  },
  measure(ctx, c) { return { v: ctx.V(c, '5V') - ctx.V(c, 'GND') }; },
  after(ctx, c) { c.st.vcc = (c.mbase && c.mbase.v) || 0; },
  check(ctx, c, part, add) {
    needPins(ctx, c, part, add, ['5V', 'DIN', 'GND']); const v = c.st.vcc || 0, sim = ctx.sim;
    const g = sim.gpioAt(c, 'DIN');
    if (g.length && ![18, 10, 12, 21].includes(g[0])) add('error', c, `${label(c, part)} DIN is on GPIO${g[0]} — WS2812 needs GPIO18 (PWM), GPIO12, GPIO21 (PCM) or GPIO10 (SPI)`, 'Move DIN to GPIO18 (pin 12).');
    if (v > 0.3 && v < 4.0) add('warn', c, `${label(c, part)} gets ${V2(v)} — WS2812B is a 5V part (colours go wrong below ≈3.7V)`, 'Power it from 5V.');
    if (c.st.amps > 0.5 && sim.pinRole(c, '5V') === '5V') add('warn', c, `${label(c, part)} draws ≈${mA(c.st.amps)} from the Pi’s 5V pin`, 'Use a separate 5V supply (≈60mA per LED at full white) and join the grounds.');
    if (g.length) add('info', c, `${label(c, part)}: 3.3V data into a 5V strip is out of spec (VIH ≈3.5V)`, 'Usually works; a 74AHCT125 level shifter makes it reliable.');
  },
};

// ================= Drivers =================
const VIH = { L298N: 2.3, L293D: 2.3, TB6612: 0.5, DRV8833: 1.5, L9110S: 2.0, MX1508: 1.8, BTS7960: 2.0 };
MODELS.hbridge = {
  bridges: (part) => (part.p.chip === 'L293D' ? [['GND', 'GND2', 'GND3', 'GND4']] : []),
  stamp(ctx, c, part) {
    const p = part.p, C = ctx.C, g = p.gnd, vs = Math.max(0, ctx.V(c, p.vs) - ctx.V(c, g)); c.st.vs = vs;
    const th = p.chip === 'TB6612' ? 0.7 * Math.max(2.7, ctx.V(c, 'VCC') - ctx.V(c, g)) * 0.7 : VIH[p.chip];
    const hi = (n) => ctx.V(c, n) - ctx.V(c, g) > th;
    if (p.logic === '5V' && vs > 7) C.vs(N(ctx, c, '5V'), N(ctx, c, g), 5, 1); // L298N onboard 78M05
    c.st.out = [];
    if (p.bts) { // BTS7960: R_EN/L_EN + RPWM/LPWM
      const en = hi('R_EN') && hi('L_EN'); const f = hi('RPWM'), r = hi('LPWM');
      if (en) { C.vs(N(ctx, c, 'M+'), N(ctx, c, g), f ? vs - p.drop : 0, 0.05); C.vs(N(ctx, c, 'M−'), N(ctx, c, g), r ? vs - p.drop : 0, 0.05); }
      c.st.out = [en ? (f && !r ? 1 : r && !f ? -1 : 0) : null]; return;
    }
    const stby = p.stby ? hi(p.stby) : true;
    for (const [en, a, b, o1, o2] of p.ch) {
      const enabled = stby && (en === null ? true : (p.chip === 'L298N' && ctx.sim.links(c, en) <= 0) ? true : hi(en));
      const A = hi(a), B = hi(b);
      let s1 = null, s2 = null;
      if (enabled) {
        if (p.chip === 'DRV8833' || p.chip === 'L9110S' || p.chip === 'MX1508') { if (A || B) { s1 = A; s2 = B; } } // both low = coast
        else { s1 = A; s2 = B; }
      }
      if (s1 !== null) C.vs(N(ctx, c, o1), N(ctx, c, g), s1 ? Math.max(0, vs - p.drop / 2) : p.drop / 2, 0.3);
      if (s2 !== null) C.vs(N(ctx, c, o2), N(ctx, c, g), s2 ? Math.max(0, vs - p.drop / 2) : p.drop / 2, 0.3);
      c.st.out.push(s1 === null ? null : (s1 && !s2 ? 1 : s2 && !s1 ? -1 : 0));
    }
  },
  post(ctx, c, part) { const vs = Math.max(0, ctx.V(c, part.p.vs) - ctx.V(c, part.p.gnd)); return Math.abs(vs - (c.st.vs || 0)) > 0.01 && ctx.iter < 40; },
  check(ctx, c, part, add) {
    const p = part.p, sim = ctx.sim, vs = c.st.vs || 0;
    const ins = p.bts ? ['RPWM', 'LPWM', 'R_EN', 'L_EN'] : p.ch.flatMap(x => x.slice(0, 3)).filter(Boolean);
    const usedGpio = ins.some(n => sim.gpioAt(c, n).length);
    if (usedGpio && sim.root(c, p.gnd) !== sim.gndRoot) add('error', c, `${label(c, part)} GND is not connected to the Pi GND — logic signals have no reference`, 'Join the driver GND, the motor supply − and a Pi GND pin.');
    if (usedGpio && vs < 1) add('warn', c, `${label(c, part)} has no motor supply on ${p.vs}`, 'Connect the battery/adapter + to ' + p.vs + ' and − to GND.');
    if (p.logic && p.logic !== '5V' && sim.links(c, p.logic) <= 0 && usedGpio) add('warn', c, `${label(c, part)} logic supply ${p.logic} is not connected`, 'Feed it 5V (L293D VCC1) or 3.3V (TB6612 VCC).');
    if (p.stby && usedGpio && sim.links(c, p.stby) <= 0) add('warn', c, `${label(c, part)} STBY is unconnected — the driver stays in standby`, 'Tie STBY to 3.3V or a GPIO set HIGH.');
    if (p.chip === 'L298N' && vs > 0 && vs < 6.5 && usedGpio) add('info', c, `${label(c, part)} drops ≈2V: with ${V2(vs)} in, motors get ≈${V2(Math.max(0, vs - 2))}`, 'Use ≥7V for 6V motors, or a MOSFET driver (TB6612/DRV8833).');
  },
};
MODELS.uln2003 = {
  bridges: () => [['V+', 'MV+']],
  stamp(ctx, c) {
    const C = ctx.C; c.st.ph = [];
    for (let i = 1; i <= 4; i++) { const on = ctx.V(c, 'IN' + i) - ctx.V(c, 'GND') > 1.4; c.st.ph.push(on); C.r(N(ctx, c, 'IN' + i), N(ctx, c, 'GND'), 2700 + 7200); if (on) C.vs(N(ctx, c, 'M' + i), N(ctx, c, 'GND'), 0.9, 1.0); }
  },
  post(ctx, c) { for (let i = 1; i <= 4; i++) if ((ctx.V(c, 'IN' + i) - ctx.V(c, 'GND') > 1.4) !== c.st.ph[i - 1] && ctx.iter < 30) return true; return false; },
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['V+', 'GND']); const sim = ctx.sim;
    if (['IN1', 'IN2', 'IN3', 'IN4'].some(n => sim.gpioAt(c, n).length) && sim.root(c, 'GND') !== sim.gndRoot) add('error', c, `${label(c, part)} GND is not joined to the Pi GND`, 'Connect GND to a Pi GND pin.'); },
};
const MS_TABLE = { 16: { '000': 1, '100': 2, '010': 4, '110': 8, '111': 16 }, 32: { '000': 1, '100': 2, '010': 4, '110': 8, '001': 16, '101': 32, '011': 32, '111': 32 } };
MODELS.stepdir = {
  bridges: () => [['GND', 'GND2']],
  stamp(ctx, c) { ctx.C.r(N(ctx, c, 'VDD'), N(ctx, c, 'GND'), 5 / 0.005); },
  logic(ctx, c, part) {
    if (ctx.whatIf) return false;
    const vdd = ctx.V(c, 'VDD') - ctx.V(c, 'GND'); const sim = ctx.sim;
    const hi = (n, def) => (sim.links(c, n) <= 0 ? def : ctx.V(c, n) - ctx.V(c, 'GND') > Math.max(1.2, vdd * 0.5));
    const tmc = part.id.includes('tmc');
    const en = !hi('EN', false), run = vdd > 2.8 && en && (tmc || (hi('RST', false) && hi('SLP', true))) && ctx.V(c, 'VMOT') - ctx.V(c, 'GND') > 6;
    const ms = (hi('MS1', false) ? '1' : '0') + (hi('MS2', false) ? '1' : '0') + (hi('MS3', false) ? '1' : '0');
    c.st.micro = tmc ? ({ '00': 8, '10': 2, '01': 4, '11': 16 })[ms.slice(0, 2)] : (MS_TABLE[part.p.ms][ms] || 1);
    const step = hi('STEP', false), prev = c.st.step; c.st.step = step; c.st.run = run;
    if (run && step && prev === false) { c.st.pos = (c.st.pos || 0) + (hi('DIR', false) ? 1 : -1); c.st.dirty = true; }
    return false;
  },
  check(ctx, c, part, add) {
    const sim = ctx.sim; needPins(ctx, c, part, add, ['STEP', 'DIR', 'VDD', 'GND', 'VMOT']);
    if (!part.id.includes('tmc') && sim.links(c, 'RST') <= 0) add('warn', c, `${label(c, part)} RST is floating — the driver may stay in reset`, 'Connect RST to SLP (jumper them together).');
    if (sim.links(c, 'VMOT') > 0 && ctx.V(c, 'VMOT') - ctx.V(c, 'GND') < 8) add('warn', c, `${label(c, part)} VMOT needs 8–35V`, 'Use a 12V supply and a 100µF capacitor across VMOT/GND.');
    if (sim.root(c, 'GND') !== sim.gndRoot && sim.gpioAt(c, 'STEP').length) add('error', c, `${label(c, part)} logic GND is not joined to the Pi GND`, 'Connect GND to a Pi GND pin.');
  },
};
const HALF = ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001'];
MODELS.stepper = {
  stamp(ctx, c, part) {
    const p = part.p, C = ctx.C;
    if (p.uni) for (let i = 1; i <= 4; i++) C.r(N(ctx, c, 'V+'), N(ctx, c, 'IN' + i), p.coilR);
    else { C.r(N(ctx, c, '1A'), N(ctx, c, '1B'), p.coilR); C.r(N(ctx, c, '2A'), N(ctx, c, '2B'), p.coilR); }
  },
  measure(ctx, c, part) {
    const p = part.p;
    if (p.uni) { const m = {}; for (let i = 1; i <= 4; i++) m['c' + i] = (ctx.V(c, 'V+') - ctx.V(c, 'IN' + i)) / p.coilR; return m; }
    return { a: (ctx.V(c, '1A') - ctx.V(c, '1B')) / p.coilR, b: (ctx.V(c, '2A') - ctx.V(c, '2B')) / p.coilR };
  },
  after(ctx, c, part) {
    const p = part.p, m = c.mbase || {}; const th = p.i * 0.3;
    // driven by a STEP/DIR driver? follow its position directly
    const drv = ctx.sim.project.comps.find(d => d.part.startsWith('drv-a4988') || d.part.startsWith('drv-drv8825') || d.part.startsWith('drv-tmc2208') ? ctx.sim.root(d, '1A') === ctx.sim.root(c, '1A') || ctx.sim.root(d, '1A') === ctx.sim.root(c, '1B') : false);
    if (drv && !p.uni) { c.st.driver = drv.id; c.st.target = (drv.st.pos || 0) * 1.8 / (drv.st.micro || 1); c.st.energised = !!drv.st.run; return; }
    c.st.driver = null;
    let idx = -1;
    if (p.uni) { const pat = [1, 2, 3, 4].map(i => (m['c' + i] > th ? '1' : '0')).join(''); idx = HALF.indexOf(pat); c.st.energised = pat !== '0000'; }
    else { const a = m.a > th ? 1 : m.a < -th ? -1 : 0, b = m.b > th ? 1 : m.b < -th ? -1 : 0; const tbl = { '1,0': 0, '1,1': 1, '0,1': 2, '-1,1': 3, '-1,0': 4, '-1,-1': 5, '0,-1': 6, '1,-1': 7 }; idx = tbl[a + ',' + b] ?? -1; c.st.energised = a !== 0 || b !== 0; }
    if (idx < 0) return;
    if (c.st.idx !== undefined && c.st.idx >= 0) { let d = (idx - c.st.idx + 8) % 8; if (d === 4) d = 0; const delta = d <= 3 ? d : d - 8; c.st.half = (c.st.half || 0) + delta; }
    c.st.idx = idx;
    c.st.target = p.uni ? (c.st.half || 0) * 360 / 4096 : (c.st.half || 0) * 0.9;
  },
  tick(c, part, t, dt) { if (c.st.target === undefined) return false; c.st.ang = c.st.ang === undefined ? c.st.target : c.st.ang + (c.st.target - c.st.ang) * Math.min(1, dt * 20); return false; },
  check(ctx, c, part, add) {
    const sim = ctx.sim, p = part.p;
    const pins = p.uni ? ['IN1', 'IN2', 'IN3', 'IN4'] : ['1A', '1B', '2A', '2B'];
    if (pins.some(n => sim.gpioAt(c, n).length)) add('error', c, `${label(c, part)} coils are wired straight to GPIO pins`, p.uni ? 'Drive it through a ULN2003 board.' : 'Drive it with an A4988/DRV8825/TMC2208 or L298N.');
    if (p.uni && sim.links(c, 'V+') <= 0) add('warn', c, `${label(c, part)} common (red, V+) is not connected`, 'Connect V+ to the ULN2003 MV+ / 5V.');
  },
};
MODELS.mosmodule = {
  bridges: () => [['GND', 'GND2'], ['VIN', 'V+']],
  stamp(ctx, c, part) { const vgs = c.st.vgs || 0; ctx.C.r(N(ctx, c, 'SIG'), N(ctx, c, 'GND'), 11000); ctx.C.r(N(ctx, c, 'V−'), N(ctx, c, 'GND'), mosRds(vgs, { ...part.p, vspec: part.p.vfull })); },
  post(ctx, c, part) { const vgs = (ctx.V(c, 'SIG') - ctx.V(c, 'GND')) * 10 / 11; const o = c.st.vgs || 0; const p = { ...part.p, vspec: part.p.vfull }; if (Math.abs(Math.log(mosRds(vgs, p) / mosRds(o, p))) > 0.002 && ctx.iter < 60) { c.st.vgs = vgs; return true; } return false; },
  check(ctx, c, part, add) { const sim = ctx.sim; if (sim.gpioAt(c, 'SIG').length) add('warn', c, `${label(c, part)}: IRF520 at a 3.3V gate has Rds ≈ ${(mosRds(3.0, { ...part.p, vspec: part.p.vfull })).toFixed(1)}Ω — the load gets little power and the MOSFET heats`, 'Use a logic-level MOSFET module (e.g. IRLZ44N / D4184 based).');
    if (sim.gpioAt(c, 'SIG').length && sim.root(c, 'GND') !== sim.gndRoot) add('error', c, `${label(c, part)} GND is not joined to the Pi GND`, 'Connect module GND to Pi GND.'); },
};

// ================= Misc inputs / ICs =================
const QUAD = [[1, 1], [0, 1], [0, 0], [1, 0]]; // KY-040 detent rests with both contacts open (HIGH)
MODELS.encoder = {
  stamp(ctx, c, part) {
    const C = ctx.C, q = QUAD[((c.st.q || 0) % 4 + 4) % 4], ky = part.p.pullups;
    const com = ky ? 'GND' : 'C', A = ky ? 'CLK' : 'A', B = ky ? 'DT' : 'B';
    if (ky) { C.r(N(ctx, c, '+'), N(ctx, c, A), 1e4); C.r(N(ctx, c, '+'), N(ctx, c, B), 1e4); }
    if (!q[0]) C.r(N(ctx, c, A), N(ctx, c, com), 1); if (!q[1]) C.r(N(ctx, c, B), N(ctx, c, com), 1);
    if (c.st.pressed) C.r(N(ctx, c, ky ? 'SW' : 'SW1'), N(ctx, c, ky ? 'GND' : 'SW2'), 0.5);
  },
  controls: () => [{ key: 'ccw', type: 'action', label: '⟲ Turn left' }, { key: 'cw', type: 'action', label: 'Turn right ⟳' }, { key: 'pressed', type: 'momentary', label: 'Push knob' }],
  action(c, part, key, sim) { const dir = key === 'cw' ? 1 : -1; let k = 0; const stepq = () => { c.st.q = (c.st.q || 0) + dir; c.st.detent = (c.st.detent || 0) + (k === 3 ? dir : 0); sim.update('encoder'); if (++k < 4) setTimeout(stepq, 3); }; stepq(); },
  check(ctx, c, part, add) { if (part.p.pullups) { needPins(ctx, c, part, add, ['CLK', 'DT', '+', 'GND']); const v = ctx.V(c, '+') - ctx.V(c, 'GND'); if (v > 3.6 && ctx.sim.gpioAt(c, 'CLK').length) add('error', c, `${label(c, part)} + is ${V2(v)}: its pull-ups put ${V2(v)} on the GPIOs`, 'Power the encoder from 3.3V.'); } },
};
MODELS.joystick = {
  stamp(ctx, c, part) {
    const C = ctx.C, R = part.p.ohms;
    for (const [pin, k] of [['VRx', 'x'], ['VRy', 'y']]) { const f = (ctl(c, k, 0) + 1) / 2; C.r(N(ctx, c, '+5V'), N(ctx, c, pin), Math.max(1, R * (1 - f))); C.r(N(ctx, c, pin), N(ctx, c, 'GND'), Math.max(1, R * f)); }
    if (c.st.pressed) C.r(N(ctx, c, 'SW'), N(ctx, c, 'GND'), 0.5);
  },
  controls: () => [{ key: 'x', type: 'range', label: 'X axis', min: -1, max: 1, step: 0.01, def: 0 }, { key: 'y', type: 'range', label: 'Y axis', min: -1, max: 1, step: 0.01, def: 0 }, { key: 'pressed', type: 'momentary', label: 'Press stick' }],
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['GND', '+5V']); for (const p of ['VRx', 'VRy']) if (ctx.sim.gpioAt(c, p).length) add('warn', c, `${label(c, part)} ${p} is analog — the Pi cannot read it directly`, 'Use an MCP3008 or ADS1115.'); if (ctx.V(c, '+5V') - ctx.V(c, 'GND') > 3.6) add('info', c, 'Joystick on 5V: its outputs reach 5V', 'Run it from 3.3V when it feeds a 3.3V ADC.'); },
};
MODELS.flow = {
  stamp(ctx, c) { ctx.C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.015); if (!c.st.lvl) ctx.C.r(N(ctx, c, 'OUT'), N(ctx, c, 'GND'), 30); },
  controls: () => [{ key: 'flow', type: 'range', label: 'Water flow', min: 0, max: 30, step: 0.1, unit: 'L/min', def: 0 }],
  tick(c, part, t, dt, sim) {
    const f = ctl(c, 'flow', 0) * part.p.ppl; const v = sim.V(c, 'VCC') - sim.V(c, 'GND'); if (f <= 0 || v < 4) return false;
    const ph0 = c.st.ph || 0; const ph1 = ph0 + f * dt; c.st.ph = ph1;
    const pulses = Math.floor(ph1) - Math.floor(ph0); if (pulses > 0) sim.pulseTrain(c, 'OUT', pulses, dt, t);
    return false;
  },
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['VCC', 'GND', 'OUT']); if (ctx.sim.gpioAt(c, 'OUT').length && !hasPullUp(ctx, c, 'OUT') && !ctx.sim.gpioAt(c, 'OUT').some(b => ctx.sim.gpio[b].pull === 'up')) add('warn', c, `${label(c, part)} OUT needs a pull-up to 3.3V`, 'Use pull_up_down=GPIO.PUD_UP.'); },
};
MODELS.loadcell = {
  stamp(ctx, c, part) {
    const d = 1e-3 * ctl(c, 'kg', 0) / part.p.kg, R = 1000, C = ctx.C;
    C.r(N(ctx, c, 'E+'), N(ctx, c, 'A+'), R * (1 - d)); C.r(N(ctx, c, 'A+'), N(ctx, c, 'E−'), R * (1 + d));
    C.r(N(ctx, c, 'E+'), N(ctx, c, 'A−'), R * (1 + d)); C.r(N(ctx, c, 'A−'), N(ctx, c, 'E−'), R * (1 - d));
  },
  controls: (part) => [{ key: 'kg', type: 'range', label: 'Weight on the cell', min: 0, max: part.p.kg, step: part.p.kg / 1000, unit: 'kg', def: 0 }],
};
MODELS.hx711 = {
  bridges: () => [['E−', 'GND']],
  init(c) { c.st.hx = { n: 0, data: 0, ready: true }; c.st.offset = 8423 + Math.floor(Math.random() * 3000); },
  stamp(ctx, c) {
    const C = ctx.C, vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.0015);
    if (vcc > 2.5) { C.vs(N(ctx, c, 'E+'), N(ctx, c, 'GND'), Math.min(4.3, vcc * 0.87), 1); const s = c.st.hx; const bit = s.out !== undefined ? s.out : (s.ready ? 0 : 1); C.vs(N(ctx, c, 'DT'), N(ctx, c, 'GND'), bit ? vcc : 0, 100); }
  },
  logic(ctx, c) {
    if (ctx.whatIf) return false;
    const vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); if (vcc < 2.5) return false;
    const sck = ctx.V(c, 'SCK') - ctx.V(c, 'GND') > vcc * 0.5; const s = c.st.hx; const prev = s.sck; s.sck = sck;
    if (sck && prev === false) {
      if (!s.ready) return false; // pulses while converting (gain-select pulses 26/27) change nothing here
      if (s.n === 0) { const ex = Math.min(4.3, vcc * 0.87); const vd = ctx.V(c, 'A+') - ctx.V(c, 'A−'); let raw = Math.round(vd / (0.5 * ex / 128) * 8388608) + c.st.offset; raw = Math.max(-8388608, Math.min(8388607, raw)); s.data = raw & 0xFFFFFF; }
      if (s.n < 24) { s.out = (s.data >> (23 - s.n)) & 1; s.n++; } else { s.n = 0; s.out = 1; s.ready = false; s.readyAt = ctx.sim.now() + 0.1; }
      return true;
    }
    return false;
  },
  tick(c, part, t) { const s = c.st.hx; if (s && !s.ready && t >= s.readyAt) { s.ready = true; s.out = undefined; s.n = 0; return true; } return false; },
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['VCC', 'GND', 'DT', 'SCK']); if (ctx.V(c, 'VCC') - ctx.V(c, 'GND') > 3.6 && ctx.sim.gpioAt(c, 'DT').length) add('warn', c, `${label(c, part)} at 5V drives DT at 5V`, 'Power the HX711 from 3.3V.'); },
};
MODELS.acs712 = {
  stamp(ctx, c, part) {
    const C = ctx.C, vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.01); C.r(N(ctx, c, 'IP+'), N(ctx, c, 'IP−'), 0.0012);
    const i = (ctx.V(c, 'IP+') - ctx.V(c, 'IP−')) / 0.0012; c.st.i = i;
    if (vcc > 4) C.vs(N(ctx, c, 'OUT'), N(ctx, c, 'GND'), Math.max(0, Math.min(vcc, vcc / 2 + part.p.sens * vcc / 5 * i)), 100);
  },
  post(ctx, c) { const i = (ctx.V(c, 'IP+') - ctx.V(c, 'IP−')) / 0.0012; if (Math.abs(i - (c.st.i || 0)) > 1e-4 && ctx.iter < 40) return true; return false; },
  check(ctx, c, part, add) { needPins(ctx, c, part, add, ['VCC', 'GND', 'OUT']); if (Math.abs(c.st.i || 0) > part.p.amps) add('error', c, `${label(c, part)} sees ${(c.st.i).toFixed(1)}A, over its ${part.p.amps}A range`, ''); if (ctx.sim.gpioAt(c, 'OUT').length) add('warn', c, 'ACS712 OUT is analog around 2.5V', 'Use an ADC (ADS1115).'); },
};
MODELS.vdiv = {
  bridges: () => [['−', 'GND']],
  stamp(ctx, c, part) { ctx.C.r(N(ctx, c, '+'), N(ctx, c, 'S'), part.p.r1); ctx.C.r(N(ctx, c, 'S'), N(ctx, c, '−'), part.p.r2); },
};
MODELS.shifter = {
  bridges: (part) => (part.p.txs ? [] : [['GND', 'GND2']]),
  stamp(ctx, c, part) {
    const n = part.p.n, txs = part.p.txs, C = ctx.C;
    const LV = txs ? 'VA' : 'LV', HV = txs ? 'VB' : 'HV';
    c.st.vg = c.st.vg || {};
    if (txs && !(ctx.V(c, 'OE') - ctx.V(c, 'GND') > 1.0)) return;
    for (let i = 1; i <= n; i++) {
      const l = txs ? 'A' + i : 'LV' + i, h = txs ? 'B' + i : 'HV' + i;
      C.r(N(ctx, c, LV), N(ctx, c, l), txs ? 4000 : 1e4); C.r(N(ctx, c, HV), N(ctx, c, h), txs ? 4000 : 1e4);
      const vgs = c.st.vg[i] || 0; C.r(N(ctx, c, h), N(ctx, c, l), mosRds(vgs, { vth: 1.3, rds: 3, vspec: 3.3 }));
      diode(ctx, c, 'bd' + i, N(ctx, c, l), N(ctx, c, h), 0.6, 20);
    }
  },
  post(ctx, c, part) {
    let ch = diodePost(ctx, c); const txs = part.p.txs; const LV = txs ? 'VA' : 'LV';
    for (let i = 1; i <= part.p.n; i++) { const l = txs ? 'A' + i : 'LV' + i; const vgs = ctx.V(c, LV) - ctx.V(c, l); const o = c.st.vg[i] || 0; const P = { vth: 1.3, rds: 3, vspec: 3.3 };
      if (Math.abs(Math.log(mosRds(vgs, P) / mosRds(o, P))) > 0.002 && ctx.iter < 70) { c.st.vg[i] = o + (vgs - o) * (ctx.iter > 30 ? 0.5 : 1); ch = true; } }
    return ch;
  },
  check(ctx, c, part, add) { const txs = part.p.txs; needPins(ctx, c, part, add, txs ? ['VA', 'VB', 'GND', 'OE'] : ['LV', 'HV', 'GND']);
    const lv = ctx.V(c, txs ? 'VA' : 'LV') - ctx.V(c, 'GND'), hv = ctx.V(c, txs ? 'VB' : 'HV') - ctx.V(c, 'GND'); if (lv > hv + 0.3 && hv > 0.5) add('warn', c, `${label(c, part)}: low side (${V2(lv)}) is higher than high side (${V2(hv)})`, 'LV = 3.3V, HV = 5V.'); },
};
MODELS.sr595 = {
  init(c) { c.st.sr = 0; c.st.latch = 0; },
  stamp(ctx, c) {
    const C = ctx.C, vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); C.r(N(ctx, c, 'VCC'), N(ctx, c, 'GND'), 5 / 0.0001);
    const oe = ctx.sim.links(c, 'OE') <= 0 ? false : ctx.V(c, 'OE') - ctx.V(c, 'GND') > vcc * 0.5;
    const names = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'];
    if (vcc > 1.8 && !oe) names.forEach((n, i) => C.vs(N(ctx, c, n), N(ctx, c, 'GND'), (c.st.latch >> i) & 1 ? vcc : 0, 50));
    if (vcc > 1.8) C.vs(N(ctx, c, "QH'"), N(ctx, c, 'GND'), (c.st.sr >> 7) & 1 ? vcc : 0, 50);
  },
  logic(ctx, c) {
    if (ctx.whatIf) return false;
    const vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); if (vcc < 1.8) return false;
    const hi = (n) => ctx.V(c, n) - ctx.V(c, 'GND') > vcc * 0.5; const s = c.st;
    const clr = ctx.sim.links(c, 'SRCLR') > 0 && !hi('SRCLR');
    const sck = hi('SRCLK'), rck = hi('RCLK'); let ch = false;
    if (clr && s.sr) { s.sr = 0; ch = true; }
    if (sck && s.psck === false && !clr) { s.sr = ((s.sr << 1) | (hi('SER') ? 1 : 0)) & 0xFF; ch = true; }
    if (rck && s.prck === false) { if (s.latch !== s.sr) ch = true; s.latch = s.sr; }
    s.psck = sck; s.prck = rck; return ch;
  },
  check(ctx, c, part, add) {
    needPins(ctx, c, part, add, ['VCC', 'GND', 'SER', 'SRCLK', 'RCLK']); const sim = ctx.sim;
    if (sim.links(c, 'SRCLR') <= 0) add('warn', c, `${label(c, part)} SRCLR (pin 10) is floating`, 'Tie SRCLR to VCC.');
    if (sim.links(c, 'OE') <= 0) add('info', c, `${label(c, part)} OE (pin 13) unconnected`, 'Tie OE to GND so the outputs are enabled (floating OE is unreliable).');
    const vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); if (vcc > 4.2 && ['SER', 'SRCLK', 'RCLK'].some(n => sim.gpioAt(c, n).length)) add('info', c, `${label(c, part)} at 5V: 3.3V inputs are below the guaranteed VIH (3.15V)`, 'Usually works; power it from 3.3V or use a 74HCT595 for full margin.');
  },
};
MODELS.mcpadc = {
  stamp(ctx, c) { ctx.C.r(N(ctx, c, 'VDD'), N(ctx, c, 'DGND'), 5 / 0.0005); ctx.C.r(N(ctx, c, 'VREF'), N(ctx, c, 'AGND'), 5 / 0.0001); },
  bridges: (part) => [['AGND', 'DGND']],
  check(ctx, c, part, add) {
    needPins(ctx, c, part, add, ['VDD', 'VREF', 'AGND', 'CLK', 'DOUT', 'DIN', 'CS']); spiCheck(ctx, c, part, add, { CLK: 11, DOUT: 9, DIN: 10 }, 'CS');
    const v = ctx.V(c, 'VDD') - ctx.V(c, 'AGND'); if (v > 3.6 && ctx.sim.gpioAt(c, 'DOUT').length) add('warn', c, `${label(c, part)} VDD is ${V2(v)}: DOUT then drives 5V into MISO (GPIO9)`, 'Run the MCP3008 from 3.3V (VDD and VREF).');
  },
};
for (const k of ['gps', 'rdm6300']) MODELS[k] = {
  stamp(ctx, c, part) { const vn = vccOf(part), gn = gndOf(part); ctx.C.r(N(ctx, c, vn), N(ctx, c, gn), 5 / (k === 'gps' ? 0.045 : 0.05)); },
  controls: (part) => k === 'gps' ? [{ key: 'fix', type: 'toggle', label: 'Satellite fix', def: true }, { key: 'lat', type: 'range', label: 'Latitude', min: -90, max: 90, step: 0.0001, unit: '°', def: 12.9716 }, { key: 'lon', type: 'range', label: 'Longitude', min: -180, max: 180, step: 0.0001, unit: '°', def: 77.5946 }, { key: 'kmh', type: 'range', label: 'Speed', min: 0, max: 120, step: 0.5, unit: 'km/h', def: 0 }, { key: 'alt', type: 'range', label: 'Altitude', min: 0, max: 3000, step: 1, unit: 'm', def: 920 }]
    : [{ key: 'card', type: 'select', label: 'Card', options: [['0A00F1C2D3', 'Card 0A00F1C2D3'], ['1B00A5E733', 'Card 1B00A5E733'], ['2C0078B6E1', 'Key fob 2C0078B6E1']], def: '0A00F1C2D3' }, { key: 'tap', type: 'action', label: 'Tap card on reader' }],
  action(c, part, key, sim) { if (key === 'tap') sim.uartPush(c, 'rdm'); },
  check(ctx, c, part, add) {
    const vn = vccOf(part), sim = ctx.sim; needPins(ctx, c, part, add, [vn, gndOf(part), 'TX']);
    if (sim.links(c, 'TX') > 0 && !sim.gpioAt(c, 'TX').includes(15)) add('error', c, `${label(c, part)} TX must go to GPIO15 (RXD, pin 10)`, 'Module TX → Pi RX.');
    if (k === 'gps' && sim.gpioAt(c, 'TX').includes(14)) add('error', c, 'GPS TX is on the Pi TX pin — TX and RX are crossed the wrong way', 'GPS TX → GPIO15 (RXD), GPS RX → GPIO14 (TXD).');
    if (k === 'rdm6300' && sim.gpioAt(c, 'TX').length && ctx.V(c, vn) - ctx.V(c, gndOf(part)) > 4.5) add('warn', c, 'RDM6300 TX is 5V logic', 'Use a 1k/2k divider into GPIO15.');
  },
};
MODELS.rc522 = {
  stamp(ctx, c) { ctx.C.r(N(ctx, c, '3.3V'), N(ctx, c, 'GND'), 3.3 / 0.026); },
  controls: () => [{ key: 'card', type: 'select', label: 'Card / tag', options: [['card1', 'White card UID 0xB4C2A91E'], ['card2', 'Blue key fob UID 0x7A1F33C5'], ['card3', 'Card UID 0x0491E3D2']], def: 'card1' }, { key: 'tap', type: 'action', label: 'Tap card on reader' }, { key: 'hold', type: 'toggle', label: 'Keep card on reader', def: false }],
  action(c, part, key, sim) { if (key === 'tap') c.st.tapUntil = sim.now() + 2.5; },
  check(ctx, c, part, add) {
    needPins(ctx, c, part, add, ['SDA', 'SCK', 'MOSI', 'MISO', 'RST', 'GND', '3.3V']); spiCheck(ctx, c, part, add, { SCK: 11, MOSI: 10, MISO: 9 }, 'SDA');
    const v = ctx.V(c, '3.3V') - ctx.V(c, 'GND'); if (v > 3.7) add('error', c, `${label(c, part)} is a 3.3V board — ${V2(v)} damages it`, 'Use the 3.3V pin.');
    if (ctx.sim.links(c, 'RST') > 0 && !ctx.sim.gpioAt(c, 'RST').includes(25)) add('info', c, 'The mfrc522 library expects RST on GPIO25 (pin 22)', '');
  },
};
MODELS.breadboard = {};
