// Protocol-level access for the Python runtime: I2C, SPI, UART, 1-Wire, DHT, WS2812, ultrasonic echo, RFID.
import { Sim } from './sim.js';
import { partOf } from './geom.js';
import { MODELS, CHIPS, ctl, supply, vccOf, gndOf, pick } from './devices.js';
import { pcf8574Write } from './chips.js';
import { BCM_TO_PHYS } from './pi.js';
const P = Sim.prototype;
P.partOf = (c) => partOf(c);
P.connectedAny = function (c1, pin1, c2) { const r = this.root(c1, pin1); return partOf(c2).pins.some(p => this.root(c2, p.n) === r); };
P.onGpio = function (c, pin, bcm) { return this.gpioLogical(c, pin).includes(bcm); };
// GPIOs a signal reaches logically: directly, or through a powered bidirectional level shifter channel
P.gpioLogical = function (c, pin) {
  const start = this.root(c, pin); const seen = new Set([start]); const todo = [start];
  const pairs = [];
  for (const s of this.project.comps) { const part = partOf(s); if (!part || part.kind !== 'shifter') continue; const txs = part.p.txs;
    const lv = this.V(s, txs ? 'VA' : 'LV') - this.V(s, 'GND'), hv = this.V(s, txs ? 'VB' : 'HV') - this.V(s, 'GND'); if (lv < 1.0 || hv < 1.0) continue;
    if (txs && !(this.V(s, 'OE') - this.V(s, 'GND') > 1.0)) continue;
    for (let i = 1; i <= part.p.n; i++) pairs.push([this.root(s, txs ? 'A' + i : 'LV' + i), this.root(s, txs ? 'B' + i : 'HV' + i)]); }
  while (todo.length) { const r = todo.pop(); for (const [a, b2] of pairs) { const o = a === r ? b2 : b2 === r ? a : null; if (o && !seen.has(o)) { seen.add(o); todo.push(o); } } }
  const out = []; for (const r of seen) for (const g of this.gpioOfNet(r)) if (!out.includes(g)) out.push(g);
  return out;
};
P.vctx = function () { return this.ctx || { sim: this, V: (c, n) => this.V(c, n) }; };
P.absNow = () => performance.timeOrigin + performance.now();
P.powered = function (c, part, min) { return supply(this.vctx(), c, part) >= min; };
// ---------- I2C (bus 1 = GPIO2/GPIO3) ----------
P.i2cTargets = function (addr) {
  const out = [];
  for (const c of this.project.comps) {
    const part = partOf(c); if (!part || !part.p || part.p.addr !== addr || !part.pins.some(p => p.n === 'SDA')) continue;
    if (!this.onGpio(c, 'SDA', 2) || !this.onGpio(c, 'SCL', 3)) continue;
    const vmin = part.kind === 'i2c' ? part.p.vmin * 0.9 : 2.5;
    const v = supply(this.vctx(), c, part); if (v < vmin) continue;
    if (part.kind === 'i2c' && v > part.p.vmax + 0.5) continue; // destroyed by over-voltage
    out.push(c);
  }
  return out;
};
P.i2cXfer = function (addr, msgs) {
  const t = this.i2cTargets(addr);
  if (!t.length) return { err: 121 };
  const c = t[0], part = partOf(c); const res = [];
  for (const m of msgs) {
    if (m.w) {
      if (part.kind === 'lcd') { for (const b of m.w) pcf8574Write(c.st.lcd, c.st, b); }
      else if (part.kind === 'oled') c.st.oled.write(m.w);
      else { const chip = CHIPS[part.p.chip]; if (chip && chip.write) chip.write(c, part, m.w, this); }
      res.push(null);
    } else {
      let d;
      if (part.kind === 'lcd') d = new Array(m.r).fill(c.st.port || 0);
      else if (part.kind === 'oled') d = new Array(m.r).fill(c.st.oled.on ? 0x03 : 0x43);
      else { const chip = CHIPS[part.p.chip]; d = chip && chip.read ? chip.read(c, part, m.r, this) : new Array(m.r).fill(0xFF); }
      res.push(d);
    }
  }
  if (part.kind === 'i2c' && (part.p.chip === 'pca9685' || part.p.chip === 'pcf8591')) this.update('i2c'); else this.dirty = true;
  return { data: res };
};
P.i2cScan = function () { const found = new Set(); for (let a = 3; a < 0x78; a++) if (this.i2cTargets(a).length) found.add(a); return [...found]; };
// ---------- SPI0 (MOSI 10, MISO 9, SCLK 11, CE0 8, CE1 7) ----------
P.spiXfer = function (dev, bytes) {
  const csBcm = dev === 1 ? 7 : 8; const out = new Array(bytes.length).fill(0);
  for (const c of this.project.comps) {
    const part = partOf(c); if (!part) continue;
    if (part.kind === 'mcpadc') {
      if (!this.onGpio(c, 'CS', csBcm) || !this.onGpio(c, 'CLK', 11) || !this.onGpio(c, 'DIN', 10)) continue;
      if (supply2(this, c, 'VDD', 'DGND') < 2.5) continue;
      const miso = this.onGpio(c, 'DOUT', 9);
      const r = mcpBits(this, c, part, bytes); if (miso) for (let i = 0; i < out.length; i++) out[i] |= r[i];
    } else if (part.kind === 'max7219') {
      if (!this.onGpio(c, 'CS', csBcm) || !this.onGpio(c, 'CLK', 11) || !this.onGpio(c, 'DIN', 10)) continue;
      if (supply2(this, c, 'VCC', 'GND') < 3.0) continue;
      maxShift(c, bytes);
    }
  }
  this.update('spi');
  return out;
};
const supply2 = (sim, c, a, b) => sim.V(c, a) - sim.V(c, b);
function mcpBits(sim, c, part, bytes) {
  const nb = bytes.length * 8, out = new Uint8Array(bytes.length); const bitIn = (i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  let s = -1; for (let i = 0; i < nb; i++) if (bitIn(i)) { s = i; break; }
  if (s < 0 || s + 4 >= nb) return out;
  const sgl = bitIn(s + 1), ch = (bitIn(s + 2) << 2) | (bitIn(s + 3) << 1) | bitIn(s + 4);
  const chans = part.p.ch; const bits = part.p.bits;
  const vref = sim.V(c, 'VREF') - sim.V(c, 'AGND');
  const Vch = (k) => sim.V(c, 'CH' + k) - sim.V(c, 'AGND') + (sim.noiseAt ? sim.noiseAt(c, 'CH' + k) : 0);
  let vin; const chn = ch & (chans - 1);
  if (sgl) vin = Vch(chn); else { const a = chn & ~1, b = a + 1; vin = (chn & 1) ? Vch(b) - Vch(a) : Vch(a) - Vch(b); }
  let code = vref > 0.1 ? Math.round(vin / vref * (1 << bits)) : 0; code = Math.max(0, Math.min((1 << bits) - 1, code));
  for (let k = 0; k < bits; k++) { const pos = s + 7 + k; if (pos < nb && (code >> (bits - 1 - k)) & 1) out[pos >> 3] |= 1 << (7 - (pos & 7)); }
  return out;
}
function maxShift(c, bytes) {
  const mx = c.st.mx; const n = mx.regs.length; mx.sr = (mx.sr || []).concat(bytes).slice(-2 * n);
  while (mx.sr.length < 2 * n) mx.sr.unshift(0);
  for (let k = 0; k < n; k++) { // the first word shifted ends in the device furthest from DIN
    const a = mx.sr[2 * (n - 1 - k)], d = mx.sr[2 * (n - 1 - k) + 1]; const R = mx.regs[k]; const reg = a & 0x0F;
    if (reg >= 1 && reg <= 8) R.digits[reg - 1] = d; else if (reg === 9) R.decode = d; else if (reg === 10) R.intensity = d & 15; else if (reg === 11) R.scan = d & 7; else if (reg === 12) R.shut = d & 1; else if (reg === 15) R.test = d & 1;
  }
  mx.ver = (mx.ver || 0) + 1;
}
// ---------- single-wire / timing devices ----------
P.dhtRead = function (bcm) {
  for (const c of this.project.comps) { const part = partOf(c); if (!part || part.kind !== 'dht' || !this.onGpio(c, 'DATA', bcm)) continue;
    const v = this.V(c, 'VCC') - this.V(c, 'GND'); if (v < 3.0 || v > 5.8) return { err: 'not_powered' };
    if (part.p.bare && !hasPull(this, c, 'DATA', bcm)) return { err: 'no_pullup' };
    let T = ctl(c, 'temp', 24), H = ctl(c, 'hum', 55);
    if (part.p.t === 11) { T = Math.round(Math.max(0, Math.min(50, T))); H = Math.round(Math.max(20, Math.min(90, H))); } else { T = Math.round(T * 10) / 10; H = Math.round(H * 10) / 10; }
    return { t: T, h: H, type: part.p.t };
  }
  return { err: 'no_sensor' };
};
function hasPull(sim, c, pin, bcm) { const g = sim.gpio[bcm]; if (g.pull === 'up') return true; for (const d of sim.project.comps) { if (!d.part.startsWith('res-')) continue; const a = sim.root(d, '1'), b = sim.root(d, '2'), r = sim.root(c, pin); const hi = (x) => sim.C.V(sim.rootNode.get(x) || 0) > 2.5; if ((a === r && hi(b)) || (b === r && hi(a))) return true; } return false; }
P.w1List = function () {
  const out = [];
  for (const c of this.project.comps) { const part = partOf(c); if (!part || part.kind !== 'ds18b20' || !this.onGpio(c, 'DQ', 4)) continue;
    const v = this.V(c, 'VDD') - this.V(c, 'GND'); if (v < 2.9) continue; if (!part.p.mod && !hasPull(this, c, 'DQ', 4)) continue;
    const id = '28-' + (parseInt(hash(c.id), 16) & 0xFFFFFFFFFFFF).toString(16).padStart(12, '0').slice(-12);
    out.push({ id, t: Math.round(ctl(c, 'temp', 22.5) * 16) / 16 });
  }
  return out;
};
function hash(s) { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return (h.toString(16) + 'a1b2').padStart(12, '0'); }
P.wsShow = function (bcm, px) {
  let n = 0;
  for (const c of this.project.comps) { const part = partOf(c); if (!part || part.kind !== 'ws2812' || !this.onGpio(c, 'DIN', bcm)) continue;
    c.st.px = px.slice(0, part.p.count); while (c.st.px.length < part.p.count) c.st.px.push(0); c.st.pxVer = (c.st.pxVer || 0) + 1; n++; }
  this.update('ws');
  return n;
};
P.ultraMeasure = function (trig, echo) {
  for (const c of this.project.comps) { const part = partOf(c); if (!part || part.kind !== 'ultrasonic') continue;
    if (!this.onGpio(c, 'Trig', trig)) continue;
    const lv = this.echoLevels(c); if (!lv[echo] || lv[echo].hi === lv[echo].lo) continue;
    if (!c.st.pw) return { err: 'not_powered' };
    const d = ctl(c, 'dist', 50); if (d < part.p.minD || d > part.p.maxD) return { err: 'out_of_range' };
    c.st.ping = performance.now(); return { cm: d };
  }
  return { err: 'no_sensor' };
};
P.echoLevels = function (c) { // logic level each GPIO reads with Echo high vs low
  const ctx = this.ctx; const save = c.st.echo; const res = {};
  const read = () => { const pi = this.pi(); const o = {}; for (let b = 0; b < 28; b++) { const nd = this.node(pi, 'P' + BCM_TO_PHYS[b]); o[b] = nd >= 0 && this.C.V(nd) > 1.65 ? 1 : 0; } return o; };
  c.st.echo = 1; this.stampAll(ctx); const hi = read(); c.st.echo = 0; this.stampAll(ctx); const lo = read(); c.st.echo = save; this.stampAll(ctx);
  for (let b = 0; b < 28; b++) res[b] = { hi: hi[b], lo: lo[b] };
  return res;
};
P.fireEcho = function (c, part) {
  const d = ctl(c, 'dist', 50); const inRange = d >= part.p.minD && d <= part.p.maxD;
  const width = inRange ? 2 * (d / 100) / 343 : 0.038; const t1 = this.absNow() + 0.6, t2 = t1 + width * 1000;
  const lv = this.echoLevels(c); c.st.ping = performance.now();
  for (let b = 0; b < 28; b++) if (lv[b].hi !== lv[b].lo && this.gpio[b].mode === 'in') this.schedule(b, t1, t2, lv[b].hi, lv[b].lo);
};
P.schedule = function (bcm, t1, t2, l1, l2) { this.sched = this.sched || {}; this.sched[bcm] = { t1, t2, l1, l2 }; if (this.onSchedule) this.onSchedule(bcm, t1, t2, l1, l2);
  if (this.watch[bcm]) { const t = this.now(), d1 = (t1 - this.absNow()) / 1000, d2 = (t2 - this.absNow()) / 1000; const e = this.watch[bcm];
    if (e === 'both' || e === (l1 ? 'rising' : 'falling')) this.events.push({ bcm, level: l1, t: t + d1 }); if (e === 'both' || e === (l2 ? 'rising' : 'falling')) this.events.push({ bcm, level: l2, t: t + d2 }); this.events.sort((a, b) => a.t - b.t); if (this.onEvent) this.onEvent(); } };
P.pulseTrain = function (c, pin, n, dt, t) { // flow meters: n low pulses spread across the last dt seconds
  const gp = this.gpioAt(c, pin); for (const b of gp) { const e = this.watch[b]; if (!e) continue; for (let i = 0; i < n; i++) { const tt = t - dt + (i + 0.5) * dt / n; if (e === 'both' || e === 'falling') this.events.push({ bcm: b, level: 0, t: tt }); if (e === 'both' || e === 'rising') this.events.push({ bcm: b, level: 1, t: tt + dt / n / 2 }); } }
  c.st.pulses = (c.st.pulses || 0) + n; if (this.onEvent) this.onEvent();
};
P.noiseAt = function (c, pin) { const r = this.root(c, pin); for (const d of this.project.comps) { const part = partOf(d); if (part && part.kind === 'anamod' && part.p.ctl === 'sound' && this.root(d, pick(part, ['AO', 'OUT']) || 'AO') === r) { const v = supply(this.vctx(), d, part); const db = ctl(d, 'db', 40); return (Math.random() * 2 - 1) * v * 0.45 * Math.max(0, (db - 35) / 75); } } return 0; };
// ---------- UART (GPIO14 TXD / GPIO15 RXD) ----------
P.uartDevice = function () { for (const c of this.project.comps) { const part = partOf(c); if (part && (part.kind === 'gps' || part.kind === 'rdm6300') && this.onGpio(c, 'TX', 15)) { const v = supply(this.vctx(), c, part); if (v > 2.7) return c; } } return null; };
P.uartRead = function () {
  const c = this.uartDevice(); const pi = this.pi();
  this.uartBuf = this.uartBuf || '';
  if (pi && this.root(pi, 'P8') === this.root(pi, 'P10') && this.loopback) { this.uartBuf += this.loopback; this.loopback = ''; }
  if (c && partOf(c).kind === 'gps') { const now = Date.now(); if (!c.st.nextNmea || now >= c.st.nextNmea) { c.st.nextNmea = Math.floor(now / 1000) * 1000 + 1000; this.uartBuf += nmea(c); } }
  if (c && c.st.rx) { this.uartBuf += c.st.rx; c.st.rx = ''; }
  const out = this.uartBuf; this.uartBuf = ''; return out;
};
P.uartWrite = function (s) { const pi = this.pi(); if (pi && this.root(pi, 'P8') === this.root(pi, 'P10')) this.loopback = (this.loopback || '') + s; };
P.uartPush = function (c, kind) { if (kind === 'rdm') { const tag = ctl(c, 'card', '0A00F1C2D3'); let x = 0; for (let i = 0; i < 10; i += 2) x ^= parseInt(tag.slice(i, i + 2), 16); c.st.rx = (c.st.rx || '') + '\x02' + tag + x.toString(16).toUpperCase().padStart(2, '0') + '\x03'; } };
function nmea(c) {
  const d = new Date(); const fix = ctl(c, 'fix', true); const lat = ctl(c, 'lat', 12.9716), lon = ctl(c, 'lon', 77.5946), kmh = ctl(c, 'kmh', 0), alt = ctl(c, 'alt', 920);
  const p2 = (n) => String(n).padStart(2, '0'); const hms = p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + '.00'; const dmy = p2(d.getUTCDate()) + p2(d.getUTCMonth() + 1) + p2(d.getUTCFullYear() % 100);
  const dm = (v, w) => { const a = Math.abs(v), deg = Math.floor(a), min = (a - deg) * 60; return String(deg).padStart(w, '0') + min.toFixed(5).padStart(8, '0'); };
  const cs = (s) => { let x = 0; for (const ch of s) x ^= ch.charCodeAt(0); return '$' + s + '*' + x.toString(16).toUpperCase().padStart(2, '0') + '\r\n'; };
  const la = fix ? dm(lat, 2) : '', ns = fix ? (lat >= 0 ? 'N' : 'S') : '', lo = fix ? dm(lon, 3) : '', ew = fix ? (lon >= 0 ? 'E' : 'W') : '';
  return cs(`GPRMC,${hms},${fix ? 'A' : 'V'},${la},${ns},${lo},${ew},${fix ? (kmh / 1.852).toFixed(3) : ''},${fix ? '0.00' : ''},${dmy},,,${fix ? 'A' : 'N'}`)
    + cs(`GPGGA,${hms},${la},${ns},${lo},${ew},${fix ? 1 : 0},${fix ? '08' : '00'},${fix ? '0.92' : '99.99'},${fix ? alt.toFixed(1) : ''},${fix ? 'M' : ''},${fix ? '-86.4' : ''},${fix ? 'M' : ''},,`);
}
// ---------- RC522 (high-level, wiring checked) ----------
P.rfid = function () {
  for (const c of this.project.comps) { const part = partOf(c); if (!part || part.kind !== 'rc522') continue;
    if (!this.onGpio(c, 'SDA', 8) || !this.onGpio(c, 'SCK', 11) || !this.onGpio(c, 'MOSI', 10) || !this.onGpio(c, 'MISO', 9)) return { err: 'wiring' };
    const v = this.V(c, '3.3V') - this.V(c, 'GND'); if (v < 2.8 || v > 3.8) return { err: 'power' };
    const present = ctl(c, 'hold', false) || (c.st.tapUntil && this.now() < c.st.tapUntil);
    if (!present) return { card: null };
    const card = ctl(c, 'card', 'card1'); const uids = { card1: [0xB4, 0xC2, 0xA9, 0x1E], card2: [0x7A, 0x1F, 0x33, 0xC5], card3: [0x04, 0x91, 0xE3, 0xD2] };
    c.st.cards = c.st.cards || {}; return { card, uid: uids[card], text: c.st.cards[card] || '' };
  }
  return { err: 'no_reader' };
};
P.rfidWrite = function (card, text) { for (const c of this.project.comps) { const part = partOf(c); if (part && part.kind === 'rc522') { c.st.cards = c.st.cards || {}; c.st.cards[card] = text.slice(0, 48); } } };
