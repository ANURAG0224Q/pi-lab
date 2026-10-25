// Simulation engine: netlist from wires/breadboard, DC operating point, PWM-aware averaging,
// device logic, electrical checks and GPIO state shared with the Python runtime.
import { Circuit } from './solver.js';
import { partOf, computeInsertions, bbLayout } from './geom.js';
import { HEADER, BOARDS, bootPull, PHYS_TO_BCM, BCM_TO_PHYS } from './pi.js';
import { MODELS } from './devices.js';

class UF {
  constructor() { this.p = new Map(); }
  find(a) { let p = this.p.get(a); if (p === undefined) { this.p.set(a, a); return a; } if (p === a) return a; const r = this.find(p); this.p.set(a, r); return r; }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}
const PI_GND = HEADER.filter(h => h[3] === 'gnd').map(h => 'P' + h[0]);
const PI_3V3 = HEADER.filter(h => h[3] === '3v3').map(h => 'P' + h[0]);
const PI_5V = HEADER.filter(h => h[3] === '5v').map(h => 'P' + h[0]);
export const VIL = 0.8, VIH = 2.0;

export class Sim {
  constructor() {
    this.project = null; this.topoDirty = true; this.t0 = performance.now();
    this.issues = []; this.listeners = []; this.events = []; this.watch = {}; this.prevLvl = {};
    this.anims = {}; this.levels = new Array(28).fill(0);
    this.resetGpio();
  }
  now() { return (performance.now() - this.t0) / 1000; }
  resetGpio() {
    this.gpio = [];
    for (let b = 0; b < 28; b++) this.gpio.push({ mode: 'in', pull: bootPull(b), level: 0, pwm: null, phase: 1, user: false });
    this.anims = {}; this.watch = {}; this.events = [];
  }
  setProject(p) { this.project = p; this.topoDirty = true; }
  pi() { return this.project.comps.find(c => partOf(c) && partOf(c).kind === 'pi'); }
  topo() {
    const p = this.project, uf = new UF();
    for (const w of p.wires) uf.union(w.a, w.b);
    for (const c of p.comps) {
      const part = partOf(c); if (!part) continue;
      if (part.kind === 'breadboard') { for (const s of bbLayout(part).strips) for (let i = 1; i < s.length; i++) uf.union(c.id + '.' + s[0], c.id + '.' + s[i]); continue; }
      const m = MODELS[part.kind];
      const br = part.kind === 'pi' ? [PI_GND, PI_3V3, PI_5V] : (m && m.bridges ? m.bridges(part) : []);
      for (const g of br) for (let i = 1; i < g.length; i++) uf.union(c.id + '.' + g[0], c.id + '.' + g[i]);
    }
    this.ins = computeInsertions(p);
    for (const [k, h] of Object.entries(this.ins)) uf.union(k, h);
    this.uf = uf;
    const pi = this.pi();
    this.gndRoot = pi ? uf.find(pi.id + '.P6') : '__none__';
    const C = new Circuit();
    this.pinNode = new Map(); this.rootNode = new Map();
    for (const c of p.comps) {
      const part = partOf(c); if (!part || part.kind === 'breadboard') continue;
      for (const pin of part.pins) {
        const key = c.id + '.' + pin.n, root = uf.find(key);
        const node = root === this.gndRoot ? 0 : C.node(root);
        this.pinNode.set(key, node); this.rootNode.set(root, node);
      }
    }
    // how many component pins / wires touch each net (for "unconnected pin" checks)
    this.netUse = new Map();
    for (const c of p.comps) { const part = partOf(c); if (!part || part.kind === 'breadboard') continue;
      for (const pin of part.pins) { const r = uf.find(c.id + '.' + pin.n); this.netUse.set(r, (this.netUse.get(r) || 0) + 1); } }
    this.C = C; this.topoDirty = false;
    for (const c of p.comps) { const part = partOf(c); if (!part) continue; const m = MODELS[part.kind]; if (!c.st) c.st = {}; if (m && m.init && !c.st._init) { m.init(c, part, this); c.st._init = true; } }
  }
  key(c, n) { return c.id + '.' + n; }
  root(c, n) { return this.uf.find(c.id + '.' + n); }
  node(c, n) { const v = this.pinNode.get(c.id + '.' + n); return v === undefined ? -1 : v; }
  // number of other things a pin is connected to (0 = nothing at all)
  links(c, n) { const r = this.root(c, n); return (this.netUse.get(r) || 0) - 1; }
  connected(c1, n1, c2, n2) { return this.root(c1, n1) === this.root(c2, n2); }
  V(c, n) { const nd = this.node(c, n); return nd < 0 ? 0 : this.C.V(nd); }
  Vd(c, a, b) { return this.V(c, a) - this.V(c, b); }
  gpioOfNet(root) { // BCM pins on the same net
    const pi = this.pi(); if (!pi) return [];
    const out = [];
    for (const [phys, , bcm] of HEADER) if (bcm !== null && this.uf.find(pi.id + '.P' + phys) === root) out.push(bcm);
    return out;
  }
  gpioAt(c, n) { return this.gpioOfNet(this.root(c, n)); }
  pinRole(c, n) { // which Pi rail/pin a component pin is tied to
    const pi = this.pi(); if (!pi) return null; const r = this.root(c, n);
    if (r === this.gndRoot) return 'GND';
    if (r === this.uf.find(pi.id + '.P1')) return '3V3';
    if (r === this.uf.find(pi.id + '.P2')) return '5V';
    const g = this.gpioOfNet(r); return g.length ? 'GPIO' + g[0] : null;
  }
  stampAll(ctx) {
    const C = this.C;
    for (let it = 0; it < 80; it++) {
      C.begin(); ctx.iter = it;
      for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.stamp) m.stamp(ctx, c, part); }
      C.solve();
      let changed = false;
      for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.post && m.post(ctx, c, part)) changed = true; }
      if (!changed) return it;
    }
    return 80;
  }
  pwmSources() {
    const out = [];
    this.gpio.forEach((g, b) => { if (g.mode === 'out' && g.pwm && g.pwm.duty > 0 && g.pwm.duty < 1) out.push({ id: 'gpio' + b, freq: g.pwm.freq, duty: g.pwm.duty, set: (on) => { g.phase = on ? 1 : 0; } }); });
    for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.pwmSources) out.push(...m.pwmSources(c, part, this)); }
    return out.slice(0, 10);
  }
  measureAll(ctx) {
    const res = {};
    for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.measure) res[c.id] = m.measure(ctx, c, part); }
    return res;
  }
  update(reason) {
    if (!this.project) return;
    if (this.topoDirty) this.topo();
    const ctx = this.ctx = { sim: this, C: this.C, whatIf: false, t: this.now(), V: (c, n) => this.V(c, n), node: (c, n) => this.node(c, n) };
    const srcs = this.pwmSources();
    for (const s of srcs) s.set(true);
    // 1) settle logic (shift registers, drivers, relays) on the base operating point
    for (let k = 0; k < 8; k++) {
      this.stampAll(ctx);
      let changed = false;
      for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.logic && m.logic(ctx, c, part)) changed = true; }
      if (!changed) break;
    }
    const base = this.measureAll(ctx);
    // 2) PWM: find which measurements depend on which PWM source, then scale by duty
    const deps = {};
    if (srcs.length) {
      ctx.whatIf = true;
      for (const s of srcs) {
        s.set(false); this.stampAll(ctx); const m = this.measureAll(ctx); s.set(true);
        for (const id in base) for (const k in base[id]) {
          const a = base[id][k], b = m[id] ? m[id][k] : a;
          if (typeof a === 'number' && Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) ((deps[id] = deps[id] || {})[k] = deps[id][k] || []).push(s);
        }
      }
      ctx.whatIf = false;
      this.stampAll(ctx);
    }
    for (const c of this.project.comps) {
      const b = base[c.id]; if (!b) { c.m = null; continue; }
      const eff = {}, src = {};
      for (const k in b) { let v = b[k]; const d = deps[c.id] && deps[c.id][k]; if (d && typeof v === 'number') { for (const s of d) v *= s.duty; src[k] = d; } eff[k] = v; }
      c.m = eff; c.mdep = src; c.mbase = b;
    }
    for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.after) m.after(ctx, c, part); }
    this.computeLevels();
    this.check();
    for (const f of this.listeners) f(reason);
  }
  computeLevels() {
    const pi = this.pi(); if (!pi) return;
    const lv = [];
    for (let b = 0; b < 28; b++) {
      const phys = BCM_TO_PHYS[b]; const nd = this.node(pi, 'P' + phys); const v = nd < 0 ? 0 : this.C.V(nd);
      const g = this.gpio[b];
      let l;
      if (g.mode === 'out') l = v > 1.65 ? 1 : 0;
      else if (this.floating(pi, 'P' + phys)) l = 2;
      else l = v > 1.65 ? 1 : 0;
      lv.push(l); g.v = v;
    }
    const oldLv = this.levels || [];
    this.levels = lv;
    for (const b in this.sched || {}) if (this.sched[b].t2 < performance.timeOrigin + performance.now()) delete this.sched[b];
    // edge events for watched pins
    const t = this.now();
    for (const b in this.watch) {
      const l = lv[b] === 2 ? 0 : lv[b]; const pl = this.prevLvl[b] !== undefined ? this.prevLvl[b] : (oldLv[b] === undefined ? undefined : oldLv[b] === 2 ? 0 : oldLv[b]);
      if (pl !== undefined && pl !== l) { const e = this.watch[b]; if (e === 'both' || (e === 'rising' && l === 1) || (e === 'falling' && l === 0)) this.events.push({ bcm: +b, level: l, t }); }
      this.prevLvl[b] = l;
    }
    if (this.onLevels) this.onLevels(lv, this.sched || {});
    if (this.events.length && this.onEvent) this.onEvent();
  }
  // floating = the net has no DC path (through resistors, switches, pulls, sources) to a supply or ground
  floating(c, n) {
    const root = this.root(c, n);
    const pi = this.pi(); const phys = n.startsWith('P') ? +n.slice(1) : null; const bcm = phys ? PHYS_TO_BCM[phys] : null;
    if (bcm !== undefined && bcm !== null) { const g = this.gpio[bcm]; if (g.mode === 'out' || g.pull !== 'off' || bcm === 2 || bcm === 3) return false; }
    return !this.drivenRoots || !this.drivenRoots.has(root);
  }
  check() {
    const issues = [];
    const ctx = this.ctx;
    const add = (sev, comp, msg, fix, also) => issues.push({ sev, comp, msg, fix, also: also && also.length ? also : undefined });
    this.drivenRoots = this.computeDriven();
    for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.check) m.check(ctx, c, part, add); }
    const order = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.sev] - order[b.sev]);
    this.issues = issues;
  }
  // DC connectivity to a "driven" node: re-stamp once with edge tracking (conductances > 1e-8 S)
  computeDriven() {
    const C = this.C; C.track = []; C.begin(); const ctx = this.ctx; ctx.iter = 99;
    for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.stamp) m.stamp(ctx, c, part); }
    const tr = C.track; C.track = null;
    const par = new Int32Array(C.n + 1); for (let i = 0; i <= C.n; i++) par[i] = i;
    const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < tr.length; i += 2) { const a = f(tr[i]), b = f(tr[i + 1]); if (a !== b) par[a] = b; }
    const g0 = f(0); const out = new Set([this.gndRoot]);
    for (const [root, node] of this.rootNode) if (f(node) === g0) out.add(root);
    return out;
  }
  tick(dt) {
    if (!this.project) return;
    if (this.topoDirty) this.topo();
    const t = this.now(); let need = false;
    for (const c of this.project.comps) { const part = partOf(c); const m = part && MODELS[part.kind]; if (m && m.tick && m.tick(c, part, t, dt, this)) need = true; }
    for (const b in this.sched || {}) if (this.sched[b].t2 < this.absNow()) delete this.sched[b];
    if (need) this.update('tick');
  }
  takeEvents() { const now = this.now(); const ready = this.events.filter(e => e.t <= now); this.events = this.events.filter(e => e.t > now); return ready; }
  // ---- GPIO interface used by the Python runtime ----
  setup(bcm, mode, pull) { const g = this.gpio[bcm]; g.mode = mode; g.user = true; if (pull !== undefined) g.pull = pull; if (mode === 'in') { g.pwm = null; } this.stopAnim(bcm); }
  write(bcm, v) { const g = this.gpio[bcm]; g.level = v ? 1 : 0; if (g.pwm) g.pwm = null; }
  pwm(bcm, freq, duty) { const g = this.gpio[bcm]; if (freq === null) { g.pwm = null; return; } g.pwm = { freq, duty: Math.max(0, Math.min(1, duty)) }; g.level = g.pwm.duty >= 1 ? 1 : g.pwm.duty <= 0 ? 0 : 1; }
  stopAnim(bcm) { const a = this.anims[bcm]; if (a) { a.stop = true; delete this.anims[bcm]; } }
}
