// Register-level emulation of I2C chips. Each chip gets bytes exactly as the Pi's I2C controller
// would put them on the bus (write = [register, data...], read = n bytes from the register pointer).
import { CHIPS, ctl } from './devices.js';
import { crc8 } from './chips.js';
const R = (c) => c.st.r || (c.st.r = new Uint8Array(256));
const s16 = (v) => { v = Math.round(v); v = Math.max(-32768, Math.min(32767, v)); return v & 0xFFFF; };
function regChip(o) { // generic register file with auto-increment pointer
  return {
    init(c, part) { const r = R(c); (o.defaults || []).forEach(([a, v]) => (r[a] = v)); c.st.ptr = 0; if (o.init) o.init(c, part); },
    controls: o.controls,
    stamp: o.stamp, pwmSources: o.pwmSources, check: o.check,
    write(c, part, b, sim) { if (!b.length) return; c.st.ptr = b[0]; for (let i = 1; i < b.length; i++) { const a = (c.st.ptr) & 0xFF; if (o.onWrite) o.onWrite(c, part, a, b[i], sim); else R(c)[a] = b[i]; c.st.ptr = (a + 1) & 0xFF; } if (o.afterWrite) o.afterWrite(c, part, b, sim); },
    read(c, part, n, sim) { if (o.refresh) o.refresh(c, part, sim); const out = []; for (let i = 0; i < n; i++) { const a = c.st.ptr & 0xFF; out.push(o.onRead ? o.onRead(c, part, a, sim) : R(c)[a]); c.st.ptr = (a + 1) & 0xFF; } return out; },
  };
}
const T_CTL = (def = 23.5) => ({ key: 'temp', type: 'range', label: 'Temperature', min: -40, max: 85, step: 0.1, unit: '°C', def });
const H_CTL = { key: 'hum', type: 'range', label: 'Humidity', min: 0, max: 100, step: 0.1, unit: '%RH', def: 50 };
const P_CTL = { key: 'press', type: 'range', label: 'Pressure', min: 300, max: 1100, step: 0.1, unit: 'hPa', def: 1013.25 };
function bsearch(f, target, lo, hi) { // f monotonic over integer range
  const inc = f(hi) > f(lo); for (let k = 0; k < 40 && hi - lo > 1; k++) { const mid = Math.floor((lo + hi) / 2); if ((f(mid) < target) === inc) lo = mid; else hi = mid; }
  return Math.abs(f(lo) - target) < Math.abs(f(hi) - target) ? lo : hi;
}
// ---------------- BME280 / BMP280 ----------------
export const BME = { T1: 27504, T2: 26435, T3: -1000, P1: 36477, P2: -10685, P3: 3024, P4: 2855, P5: 140, P6: -7, P7: 15500, P8: -14600, P9: 6000, H1: 75, H2: 370, H3: 0, H4: 313, H5: 50, H6: 30 };
const bmeT = (adc) => { const v1 = (adc / 16384 - BME.T1 / 1024) * BME.T2; const v2 = Math.pow(adc / 131072 - BME.T1 / 8192, 2) * BME.T3; return v1 + v2; };
function bmeP(adc, tf) { let v1 = tf / 2 - 64000; let v2 = v1 * v1 * BME.P6 / 32768; v2 = v2 + v1 * BME.P5 * 2; v2 = v2 / 4 + BME.P4 * 65536; v1 = (BME.P3 * v1 * v1 / 524288 + BME.P2 * v1) / 524288; v1 = (1 + v1 / 32768) * BME.P1; if (v1 === 0) return 0; let p = 1048576 - adc; p = (p - v2 / 4096) * 6250 / v1; v1 = BME.P9 * p * p / 2147483648; v2 = p * BME.P8 / 32768; return p + (v1 + v2 + BME.P7) / 16; }
function bmeH(adc, tf) { let h = tf - 76800; h = (adc - (BME.H4 * 64 + BME.H5 / 16384 * h)) * (BME.H2 / 65536 * (1 + BME.H6 / 67108864 * h * (1 + BME.H3 / 67108864 * h))); h = h * (1 - BME.H1 * h / 524288); return Math.max(0, Math.min(100, h)); }
function bmeInit(c, part, isBme) {
  const r = R(c); const put16 = (a, v) => { v &= 0xFFFF; r[a] = v & 255; r[a + 1] = v >> 8; };
  [BME.T1, BME.T2, BME.T3, BME.P1, BME.P2, BME.P3, BME.P4, BME.P5, BME.P6, BME.P7, BME.P8, BME.P9].forEach((v, i) => put16(0x88 + i * 2, v));
  r[0xD0] = isBme ? 0x60 : 0x58;
  if (isBme) { r[0xA1] = BME.H1; put16(0xE1, BME.H2); r[0xE3] = BME.H3; r[0xE4] = (BME.H4 >> 4) & 0xFF; r[0xE5] = ((BME.H5 & 0x0F) << 4) | (BME.H4 & 0x0F); r[0xE6] = (BME.H5 >> 4) & 0xFF; r[0xE7] = BME.H6 & 0xFF; }
  r[0xF7] = 0x80; r[0xFA] = 0x80; r[0xFD] = 0x80;
}
function bmeMeasure(c, part, isBme) {
  const r = R(c); const T = ctl(c, 'temp', 23.5), Pp = ctl(c, 'press', 1013.25) * 100, H = ctl(c, 'hum', 50);
  const adcT = bsearch(bmeT, T * 5120, 0, 1048575); const tf = bmeT(adcT);
  const adcP = bsearch((a) => bmeP(a, tf), Pp, 0, 1048575); const adcH = bsearch((a) => bmeH(a, tf), H, 0, 65535);
  const put20 = (a, v) => { r[a] = (v >> 12) & 255; r[a + 1] = (v >> 4) & 255; r[a + 2] = (v & 15) << 4; };
  put20(0xF7, adcP); put20(0xFA, adcT); if (isBme) { r[0xFD] = adcH >> 8; r[0xFE] = adcH & 255; }
}
for (const [name, isBme] of [['bme280', true], ['bmp280', false]]) CHIPS[name] = regChip({
  init: (c, part) => bmeInit(c, part, isBme), controls: () => (isBme ? [T_CTL(), H_CTL, P_CTL] : [T_CTL(), P_CTL]),
  onWrite(c, part, a, v) { const r = R(c); if (a === 0xE0 && v === 0xB6) { bmeInit(c, part, isBme); r[0xF4] = 0; return; } if (a >= 0xF2 && a <= 0xF5) r[a] = v; if (a === 0xF4 && (v & 3)) bmeMeasure(c, part, isBme); if (a === 0xF4 && (v & 3) === 1) r[0xF4] = v & 0xFC; },
  refresh(c, part) { if ((R(c)[0xF4] & 3) === 3) bmeMeasure(c, part, isBme); },
});
// ---------------- BMP180 ----------------
const B180 = { AC1: 408, AC2: -72, AC3: -14383, AC4: 32741, AC5: 32757, AC6: 23153, B1: 6190, B2: 4, MB: -32768, MC: -8711, MD: 2868 };
function b180T(UT) { const X1 = Math.floor((UT - B180.AC6) * B180.AC5 / 32768); const X2 = Math.floor(B180.MC * 2048 / (X1 + B180.MD)); const B5 = X1 + X2; return { T: Math.floor((B5 + 8) / 16) / 10, B5 }; }
function b180P(UP, B5, oss) {
  const B6 = B5 - 4000; let X1 = Math.floor(B180.B2 * Math.floor(B6 * B6 / 4096) / 2048); let X2 = Math.floor(B180.AC2 * B6 / 2048); let X3 = X1 + X2;
  const B3 = Math.floor(((B180.AC1 * 4 + X3) << oss) + 2) >> 2; X1 = Math.floor(B180.AC3 * B6 / 8192); X2 = Math.floor(B180.B1 * Math.floor(B6 * B6 / 4096) / 65536); X3 = Math.floor((X1 + X2 + 2) / 4);
  const B4 = Math.floor(B180.AC4 * (X3 + 32768) / 32768); const B7 = (UP - B3) * Math.floor(50000 / (1 << oss));
  let p = B7 < 0x80000000 ? Math.floor(B7 * 2 / B4) : Math.floor(B7 / B4) * 2; X1 = Math.floor(p / 256) * Math.floor(p / 256); X1 = Math.floor(X1 * 3038 / 65536); X2 = Math.floor(-7357 * p / 65536); return p + Math.floor((X1 + X2 + 3791) / 16);
}
CHIPS.bmp180 = regChip({
  init(c) { const r = R(c); const put = (a, v) => { v &= 0xFFFF; r[a] = v >> 8; r[a + 1] = v & 255; }; Object.values(B180).forEach((v, i) => put(0xAA + i * 2, v)); r[0xD0] = 0x55; },
  controls: () => [T_CTL(), P_CTL],
  onWrite(c, part, a, v) { const r = R(c); r[a] = v; if (a !== 0xF4) return; const T = ctl(c, 'temp', 23.5);
    const UT = bsearch((u) => b180T(u).T, T, 0, 65535);
    if (v === 0x2E) { r[0xF6] = UT >> 8; r[0xF7] = UT & 255; }
    else if ((v & 0x3F) === 0x34) { const oss = v >> 6; const B5 = b180T(UT).B5; const target = ctl(c, 'press', 1013.25) * 100; const UP = bsearch((u) => b180P(u, B5, oss), target, 0, (1 << (16 + oss)) - 1); const raw = UP << (8 - oss); r[0xF6] = (raw >> 16) & 255; r[0xF7] = (raw >> 8) & 255; r[0xF8] = raw & 255; } },
});
// ---------------- command-style humidity sensors ----------------
function cmdChip(o) { return { init: (c) => { c.st.out = []; }, controls: o.controls, write(c, part, b, sim) { o.cmd(c, part, b, sim); }, read(c, part, n) { const d = c.st.out || []; const out = []; for (let i = 0; i < n; i++) out.push(i < d.length ? d[i] : 0xFF); return out; } }; }
const w16crc = (v, poly = 0x31, init = 0xFF) => [v >> 8, v & 255, crc8([v >> 8, v & 255], poly, init)];
CHIPS.sht3x = cmdChip({ controls: () => [T_CTL(), H_CTL], cmd(c, part, b) { if (b.length < 2) return; const cmd = (b[0] << 8) | b[1];
  if ([0x2400, 0x240B, 0x2416, 0x2C06, 0x2C0D, 0x2C10, 0xE000].includes(cmd)) { const t = Math.round((ctl(c, 'temp', 23.5) + 45) / 175 * 65535), h = Math.round(ctl(c, 'hum', 50) / 100 * 65535); c.st.out = [...w16crc(Math.max(0, Math.min(65535, t))), ...w16crc(Math.max(0, Math.min(65535, h)))]; }
  else if (cmd === 0xF32D) c.st.out = w16crc(0x8010); } });
CHIPS.sht4x = cmdChip({ controls: () => [T_CTL(), H_CTL], cmd(c, part, b) { const k = b[0];
  if ([0xFD, 0xF6, 0xE0, 0x39, 0x32, 0x2F, 0x24, 0x1E, 0x15].includes(k)) { const t = Math.round((ctl(c, 'temp', 23.5) + 45) / 175 * 65535), h = Math.round((ctl(c, 'hum', 50) + 6) / 125 * 65535); c.st.out = [...w16crc(Math.max(0, Math.min(65535, t))), ...w16crc(Math.max(0, Math.min(65535, h)))]; }
  else if (k === 0x89) c.st.out = [...w16crc(0x1234), ...w16crc(0x5678)]; } });
CHIPS.aht = cmdChip({ controls: () => [T_CTL(), H_CTL], cmd(c, part, b) { if (b[0] === 0xAC) { const h = Math.round(ctl(c, 'hum', 50) / 100 * 1048576) & 0xFFFFF, t = Math.round((ctl(c, 'temp', 23.5) + 50) / 200 * 1048576) & 0xFFFFF;
  const d = [0x1C, h >> 12, (h >> 4) & 255, ((h & 15) << 4) | (t >> 16), (t >> 8) & 255, t & 255]; c.st.out = [...d, crc8(d, 0x31, 0xFF)]; } else if (b[0] === 0x71 || b.length === 0) c.st.out = [0x1C]; else if (b[0] === 0xBE || b[0] === 0xE1 || b[0] === 0xBA) c.st.out = [0x1C]; } });
CHIPS.htu21 = cmdChip({ controls: () => [T_CTL(), H_CTL], cmd(c, part, b) { const k = b[0];
  if (k === 0xE3 || k === 0xF3) { const t = Math.round((ctl(c, 'temp', 23.5) + 46.85) / 175.72 * 65536) & 0xFFFC; c.st.out = [t >> 8, t & 255, crc8([t >> 8, t & 255], 0x31, 0x00)]; }
  else if (k === 0xE5 || k === 0xF5) { const h = (Math.round((ctl(c, 'hum', 50) + 6) / 125 * 65536) & 0xFFFC) | 0x02; c.st.out = [h >> 8, h & 255, crc8([h >> 8, h & 255], 0x31, 0x00)]; }
  else if (k === 0xE7) c.st.out = [0x02]; } });
CHIPS.mcp9808 = regChip({ controls: () => [T_CTL()], init(c) { }, onWrite(c, part, a, v) { R(c)[a] = v; },
  read(c, part, n) { const p = c.st.ptr & 0x0F; let w = 0; const T = ctl(c, 'temp', 23.5);
    if (p === 5) { const raw = Math.round(T * 16) & 0x1FFF; w = raw; } else if (p === 6) w = 0x0054; else if (p === 7) w = 0x0400; else if (p === 1) w = 0; else if (p === 8) w = 0x03;
    return [w >> 8, w & 255].slice(0, n).concat(new Array(Math.max(0, n - 2)).fill(0)); } });
CHIPS.mcp9808.write = (c, part, b) => { if (b.length) c.st.ptr = b[0]; };
CHIPS.tmp102 = { controls: () => [T_CTL()], init(c) { c.st.ptr = 0; }, write(c, part, b) { if (b.length) c.st.ptr = b[0] & 3; },
  read(c, part, n) { let w = 0; if (c.st.ptr === 0) w = (Math.round(ctl(c, 'temp', 23.5) / 0.0625) << 4) & 0xFFFF; else if (c.st.ptr === 1) w = 0x60A0; else if (c.st.ptr === 2) w = 0x4B00; else w = 0x5000; return [w >> 8, w & 255].slice(0, n); } };
CHIPS.mlx90614 = { controls: () => [{ key: 'obj', type: 'range', label: 'Object temperature', min: -70, max: 380, step: 0.1, unit: '°C', def: 36.6 }, { ...T_CTL(25), label: 'Ambient temperature' }], init(c) { c.st.ptr = 0x07; },
  write(c, part, b) { if (b.length) c.st.ptr = b[0]; },
  read(c, part, n) { const reg = c.st.ptr & 0x3F; let T = null; if (c.st.ptr === 0x06) T = ctl(c, 'temp', 25); else if (c.st.ptr === 0x07 || c.st.ptr === 0x08) T = ctl(c, 'obj', 36.6);
    const raw = T === null ? 0 : Math.round((T + 273.15) / 0.02) & 0x7FFF; const addr = part.p.addr; const pec = crc8([addr << 1, c.st.ptr, (addr << 1) | 1, raw & 255, raw >> 8], 0x07, 0x00); return [raw & 255, raw >> 8, pec].slice(0, n); } };
CHIPS.bh1750 = { controls: () => [{ key: 'lux', type: 'range', label: 'Light', min: 0, max: 65535, step: 1, unit: 'lux', def: 320 }], init(c) { c.st.mode = 0x10; c.st.on = false; },
  write(c, part, b) { for (const k of b) { if (k === 0x01) c.st.on = true; else if (k === 0x00) c.st.on = false; else if ([0x10, 0x11, 0x13, 0x20, 0x21, 0x23].includes(k)) { c.st.mode = k; c.st.on = true; c.st.done = true; } } },
  read(c, part, n) { if (!c.st.done) return [0, 0].slice(0, n); let v = ctl(c, 'lux', 320) * 1.2; if (c.st.mode === 0x11 || c.st.mode === 0x21) v *= 2; v = Math.min(65535, Math.round(v)); if (c.st.mode >= 0x20) c.st.on = false; return [v >> 8, v & 255].slice(0, n); } };

// ---------------- IMUs ----------------
const TILT = [{ key: 'pitch', type: 'range', label: 'Pitch (tilt forward/back)', min: -90, max: 90, step: 0.5, unit: '°', def: 0 }, { key: 'roll', type: 'range', label: 'Roll (tilt left/right)', min: -180, max: 180, step: 0.5, unit: '°', def: 0 }];
export function accelG(c) { const p = ctl(c, 'pitch', 0) * Math.PI / 180, r = ctl(c, 'roll', 0) * Math.PI / 180; return [-Math.sin(p), Math.sin(r) * Math.cos(p), Math.cos(r) * Math.cos(p)]; }
for (const [name, who] of [['mpu6050', 0x68], ['mpu6500', 0x70], ['mpu9250', 0x71]]) CHIPS[name] = regChip({
  defaults: [[0x6B, 0x40], [0x75, who]],
  controls: () => [...TILT, { key: 'gx', type: 'range', label: 'Rotation X', min: -250, max: 250, step: 1, unit: '°/s', def: 0 }, { key: 'gy', type: 'range', label: 'Rotation Y', min: -250, max: 250, step: 1, unit: '°/s', def: 0 }, { key: 'gz', type: 'range', label: 'Rotation Z', min: -250, max: 250, step: 1, unit: '°/s', def: 0 }, T_CTL(26)],
  onWrite(c, part, a, v) { const r = R(c); if (a === 0x6B && (v & 0x80)) { r.fill(0); r[0x6B] = 0x40; r[0x75] = who; return; } if (a !== 0x75 && (a < 0x3B || a > 0x48)) r[a] = v; },
  refresh(c) { const r = R(c); if (r[0x6B] & 0x40) { for (let a = 0x3B; a <= 0x48; a++) r[a] = 0; return; }
    const afs = (r[0x1C] >> 3) & 3, fs = (r[0x1B] >> 3) & 3; const asc = 16384 / (1 << afs), gsc = [131, 65.5, 32.8, 16.4][fs];
    const [ax, ay, az] = accelG(c); const temp = name === 'mpu6050' ? (ctl(c, 'temp', 26) - 36.53) * 340 : (ctl(c, 'temp', 26) - 21) * 333.87;
    const vals = [ax * asc, ay * asc, az * asc, temp, ctl(c, 'gx', 0) * gsc, ctl(c, 'gy', 0) * gsc, ctl(c, 'gz', 0) * gsc];
    vals.forEach((v, i) => { const w = s16(v); r[0x3B + i * 2] = w >> 8; r[0x3C + i * 2] = w & 255; }); },
});
CHIPS.adxl345 = regChip({ defaults: [[0x00, 0xE5]], controls: () => TILT,
  onWrite(c, part, a, v) { if (a !== 0) R(c)[a] = v; },
  refresh(c) { const r = R(c); if (!(r[0x2D] & 0x08)) { for (let a = 0x32; a <= 0x37; a++) r[a] = 0; return; } const fmt = r[0x31]; const full = fmt & 0x08, rng = fmt & 3; const sc = full ? 256 : 256 / (1 << rng);
    const lim = full ? 512 * (1 << rng) - 1 : 511; accelG(c).forEach((g, i) => { const w = s16(Math.max(-lim - 1, Math.min(lim, g * sc))); r[0x32 + i * 2] = w & 255; r[0x33 + i * 2] = w >> 8; }); },
});
const HEAD = [{ key: 'heading', type: 'range', label: 'Heading (0° = North)', min: 0, max: 359, step: 1, unit: '°', def: 0 }];
function field(c) { const h = ctl(c, 'heading', 0) * Math.PI / 180; const H = 0.32; return [H * Math.cos(h), -H * Math.sin(h), -0.25]; } // gauss, so atan2(y, x) gives -heading... corrected below
CHIPS.hmc5883 = regChip({ defaults: [[0x00, 0x10], [0x01, 0x20], [0x02, 0x01], [0x0A, 0x48], [0x0B, 0x34], [0x0C, 0x33]], controls: () => HEAD,
  onWrite(c, part, a, v) { if (a <= 2) R(c)[a] = v; },
  refresh(c) { const r = R(c); const gain = [1370, 1090, 820, 660, 440, 390, 330, 230][r[0x01] >> 5]; const h = ctl(c, 'heading', 0) * Math.PI / 180; const H = 0.32;
    const x = H * Math.cos(h), y = H * Math.sin(h), z = -0.25; const put = (a, v) => { const w = s16(v * gain); r[a] = w >> 8; r[a + 1] = w & 255; };
    put(0x03, x); put(0x05, z); put(0x07, y); r[0x09] = 0x01; if ((r[0x02] & 3) === 1) r[0x02] = 0x03; },
});
CHIPS.qmc5883 = regChip({ defaults: [[0x0D, 0xFF]], controls: () => HEAD,
  onWrite(c, part, a, v) { if (a === 0x0A && (v & 0x80)) { R(c).fill(0); R(c)[0x0D] = 0xFF; return; } if (a >= 0x09 && a <= 0x0B) R(c)[a] = v; },
  refresh(c) { const r = R(c); if ((r[0x09] & 3) !== 1) { r[0x06] = 0; return; } const sc = (r[0x09] & 0x10) ? 3000 : 12000; const h = ctl(c, 'heading', 0) * Math.PI / 180, H = 0.32;
    [H * Math.cos(h), H * Math.sin(h), -0.25].forEach((v, i) => { const w = s16(v * sc); r[i * 2] = w & 255; r[i * 2 + 1] = w >> 8; }); r[0x06] = 0x01; },
});
// ---------------- INA219 ----------------
CHIPS.ina219 = {
  init(c) { c.st.reg = [0x399F, 0, 0, 0, 0, 0]; c.st.ptr = 0; },
  stamp(ctx, c) { ctx.C.r(ctx.node(c, 'VIN+'), ctx.node(c, 'VIN−'), 0.1); },
  write(c, part, b) { if (!b.length) return; c.st.ptr = b[0] & 7; if (b.length >= 3) { const v = (b[1] << 8) | b[2]; if (c.st.ptr === 0) { if (v & 0x8000) this.init(c); else c.st.reg[0] = v; } else if (c.st.ptr === 5) c.st.reg[5] = v & 0xFFFE; } },
  read(c, part, n, sim) {
    const vsh = sim.V(c, 'VIN+') - sim.V(c, 'VIN−'), vbus = sim.V(c, 'VIN−') - sim.V(c, 'GND'); const reg = c.st.reg;
    const pga = (reg[0] >> 11) & 3; const lim = [0.04, 0.08, 0.16, 0.32][pga];
    const shReg = s16(Math.max(-lim, Math.min(lim, vsh)) / 1e-5); const shSigned = shReg & 0x8000 ? shReg - 65536 : shReg;
    const bus = Math.max(0, Math.min(8191, Math.round(vbus / 0.004)));
    const cur = s16(shSigned * reg[5] / 4096); const curS = cur & 0x8000 ? cur - 65536 : cur;
    const pw = Math.max(0, Math.min(65535, Math.round(Math.abs(curS) * bus / 5000)));
    const vals = [reg[0], shReg, (bus << 3) | 0x02 | (Math.abs(vsh) > lim ? 1 : 0), reg[5] ? pw : 0, reg[5] ? cur : 0, reg[5]];
    const w = vals[c.st.ptr] & 0xFFFF; return [w >> 8, w & 255].slice(0, n);
  },
  check(ctx, c, part, add) { if (ctx.sim.links(c, 'VIN+') <= 0 || ctx.sim.links(c, 'VIN−') <= 0) add('info', c, 'INA219: wire VIN+ and VIN− in series with the load to measure its current', ''); },
};
// ---------------- ADS1115 / ADS1015 ----------------
const FSR = [6.144, 4.096, 2.048, 1.024, 0.512, 0.256, 0.256, 0.256];
for (const [name, bits] of [['ads1115', 16], ['ads1015', 12]]) CHIPS[name] = {
  init(c) { c.st.reg = [0, 0x8583, 0x8000, 0x7FFF]; c.st.ptr = 0; },
  write(c, part, b, sim) { if (!b.length) return; c.st.ptr = b[0] & 3; if (b.length >= 3) { const v = (b[1] << 8) | b[2]; c.st.reg[c.st.ptr] = v; if (c.st.ptr === 1) { c.st.reg[1] = v & 0x7FFF; this.convert(c, part, sim); c.st.reg[1] |= 0x8000; } } },
  convert(c, part, sim) { const cfg = c.st.reg[1]; const mux = (cfg >> 12) & 7, pga = (cfg >> 9) & 7; const V = (n) => sim.V(c, n) - sim.V(c, 'GND');
    const pairs = [['A0', 'A1'], ['A0', 'A3'], ['A1', 'A3'], ['A2', 'A3'], ['A0', null], ['A1', null], ['A2', null], ['A3', null]]; const [a, bb] = pairs[mux];
    const v = V(a) - (bb ? V(bb) : 0) + (sim.noiseAt ? sim.noiseAt(c, a) : 0); const fs = FSR[pga]; let code = Math.round(v / fs * 32768); code = Math.max(-32768, Math.min(32767, code));
    if (bits === 12) code = (code >> 4) << 4; c.st.reg[0] = code & 0xFFFF; },
  read(c, part, n, sim) { if (c.st.ptr === 0 && !((c.st.reg[1] >> 8) & 1)) this.convert(c, part, sim); const w = c.st.reg[c.st.ptr]; return [w >> 8, w & 255].slice(0, n); },
  check(ctx, c, part, add) { const vdd = ctx.V(c, 'VDD') - ctx.V(c, 'GND'); for (const a of ['A0', 'A1', 'A2', 'A3']) { const v = ctx.V(c, a) - ctx.V(c, 'GND'); if (v > vdd + 0.3 && ctx.sim.links(c, a) > 0) add('error', c, `${part.name} ${a} at ${v.toFixed(2)}V is above VDD (${vdd.toFixed(2)}V)`, 'Inputs must stay between GND and VDD.'); } },
};
CHIPS.pcf8591 = {
  init(c) { c.st.ctl = 0; c.st.dac = 0; c.st.last = 0x80; },
  stamp(ctx, c) { if (c.st.ctl & 0x40) { const vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); ctx.C.vs(ctx.node(c, 'AOUT'), ctx.node(c, 'GND'), vcc * c.st.dac / 256, 100); } },
  write(c, part, b) { if (!b.length) return; c.st.ctl = b[0]; if (b.length > 1) c.st.dac = b[b.length - 1]; c.st.ch = b[0] & 3; },
  read(c, part, n, sim) { const vcc = sim.V(c, 'VCC') - sim.V(c, 'GND'); const out = []; let ch = c.st.ch || 0;
    for (let i = 0; i < n; i++) { out.push(c.st.last); const v = sim.V(c, 'AIN' + ch) - sim.V(c, 'GND'); c.st.last = Math.max(0, Math.min(255, Math.round(v / Math.max(vcc, 0.1) * 256))); if (c.st.ctl & 0x04) ch = (ch + 1) & 3; }
    c.st.ch = ch; return out; },
};
// ---------------- RTCs ----------------
const bcd = (v) => ((Math.floor(v / 10) << 4) | (v % 10)) & 0xFF, unbcd = (b) => (b >> 4) * 10 + (b & 15);
for (const name of ['ds3231', 'ds1307']) CHIPS[name] = {
  init(c) { c.st.off = 0; c.st.ptr = 0; c.st.ram = new Uint8Array(64); c.st.halt = name === 'ds1307' ? false : false; },
  now(c) { return new Date(Date.now() + (c.st.off || 0)); },
  regs(c) { const d = this.now(c); const r = c.st.ram; r[0] = bcd(d.getUTCSeconds()) | (c.st.halt ? 0x80 : 0); r[1] = bcd(d.getUTCMinutes()); r[2] = bcd(d.getUTCHours()); r[3] = d.getUTCDay() + 1; r[4] = bcd(d.getUTCDate()); r[5] = bcd(d.getUTCMonth() + 1); r[6] = bcd(d.getUTCFullYear() % 100);
    if (name === 'ds3231') { const T = ctl(c, 'temp', 24.25); r[0x11] = Math.floor(T) & 0xFF; r[0x12] = Math.round((T - Math.floor(T)) * 4) << 6; } return r; },
  controls: () => (name === 'ds3231' ? [{ ...T_CTL(24.25), label: 'Board temperature' }] : []),
  write(c, part, b) { if (!b.length) return; c.st.ptr = b[0]; const r = this.regs(c); const nr = Uint8Array.from(r); let p = b[0];
    for (let i = 1; i < b.length; i++) { nr[p & 63] = b[i]; p++; }
    if (b.length > 1 && b[0] <= 6) { const s = unbcd(nr[0] & 0x7F), mi = unbcd(nr[1]), h = nr[2] & 0x40 ? (unbcd(nr[2] & 0x1F) % 12) + (nr[2] & 0x20 ? 12 : 0) : unbcd(nr[2] & 0x3F); const dt = Date.UTC(2000 + unbcd(nr[6]), unbcd(nr[5] & 0x1F) - 1, unbcd(nr[4]), h, mi, s); c.st.off = dt - Date.now(); if (name === 'ds1307') c.st.halt = !!(nr[0] & 0x80); }
    for (let i = 7; i < 64; i++) c.st.ram[i] = nr[i]; c.st.ptr = p & 63; },
  read(c, part, n) { const r = this.regs(c); const out = []; for (let i = 0; i < n; i++) { out.push(r[c.st.ptr & 63]); c.st.ptr = (c.st.ptr + 1) & 63; } return out; },
};
// ---------------- PCA9685 ----------------
CHIPS.pca9685 = regChip({
  defaults: [[0x00, 0x11], [0x01, 0x04], [0xFE, 0x1E]],
  onWrite(c, part, a, v) { const r = R(c); if (a === 0xFE && !(r[0] & 0x10)) return; r[a] = v; c.st.ver = (c.st.ver || 0) + 1; },
  stamp(ctx, c) { const ch = chans(c); const vcc = ctx.V(c, 'VCC') - ctx.V(c, 'GND'); ch.forEach((d, i) => { const on = d.duty >= 1 ? 1 : d.duty <= 0 ? 0 : (c.st.phase && c.st.phase[i] !== undefined ? c.st.phase[i] : 1); ctx.C.vs(ctx.node(c, 'PWM' + i), ctx.node(c, 'GND'), on ? Math.max(0, vcc) : 0, 220); }); },
  pwmSources(c, part, sim) { const out = []; c.st.phase = c.st.phase || []; chans(c).forEach((d, i) => { if (d.duty > 0 && d.duty < 1 && sim.links(c, 'PWM' + i) > 0) out.push({ id: c.id + 'ch' + i, freq: d.freq, duty: d.duty, set: (on) => { c.st.phase[i] = on ? 1 : 0; } }); }); return out; },
  check(ctx, c, part, add) { if (ctx.sim.links(c, 'V+') <= 0 && ctx.sim.project.comps.some(s => s.part.startsWith('srv-') && ctx.sim.connectedAny(s, 'SIG', c))) add('warn', c, 'PCA9685 V+ (servo power) is not connected', 'Feed V+ with 5–6V for the servos.'); },
});
function chans(c) { const r = R(c); const sleep = r[0] & 0x10; const freq = 25e6 / (4096 * (r[0xFE] + 1)); const out = [];
  for (let i = 0; i < 16; i++) { const b = 0x06 + 4 * i; const on = r[b] | ((r[b + 1] & 0x0F) << 8), off = r[b + 2] | ((r[b + 3] & 0x0F) << 8); let duty;
    if (sleep) duty = 0; else if (r[b + 3] & 0x10) duty = 0; else if (r[b + 1] & 0x10) duty = 1; else duty = (((off - on) % 4096) + 4096) % 4096 / 4096; out.push({ freq, duty }); }
  return out; }
// ---------------- MPR121 ----------------
CHIPS.mpr121 = regChip({ defaults: [[0x5D, 0x24]],
  controls: () => Array.from({ length: 12 }, (_, i) => ({ key: 'e' + i, type: 'toggle', label: 'Electrode ' + i + ' touched', def: false })),
  onWrite(c, part, a, v) { if (a === 0x80 && v === 0x63) { R(c).fill(0); R(c)[0x5D] = 0x24; return; } R(c)[a] = v; },
  refresh(c) { const r = R(c); const run = r[0x5E] & 0x0F; let bits = 0; if (run) for (let i = 0; i < Math.min(12, run); i++) if (ctl(c, 'e' + i, false)) bits |= 1 << i; r[0] = bits & 255; r[1] = bits >> 8;
    for (let i = 0; i < 12; i++) { const fd = run ? (ctl(c, 'e' + i, false) ? 520 : 680) : 0; r[0x04 + i * 2] = fd & 255; r[0x05 + i * 2] = fd >> 8; r[0x1E + i] = run ? 680 >> 2 : 0; } },
});
