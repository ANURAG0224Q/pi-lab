// Data-driven component catalog. Every entry is a real part family/model with typical datasheet
// values. Each entry maps to a simulation model ("kind") implemented in devices.js.
const E24 = [1.0,1.1,1.2,1.3,1.5,1.6,1.8,2.0,2.2,2.4,2.7,3.0,3.3,3.6,3.9,4.3,4.7,5.1,5.6,6.2,6.8,7.5,8.2,9.1];
export function fmtOhm(r) {
  if (r >= 1e6) return +(r / 1e6).toPrecision(3) + 'MΩ';
  if (r >= 1e3) return +(r / 1e3).toPrecision(3) + 'kΩ';
  return +r.toPrecision(3) + 'Ω';
}
export function fmtF(f) {
  if (f >= 1e-6 * 0.999) return +(f * 1e6).toPrecision(3) + 'µF';
  if (f >= 1e-9 * 0.999) return +(f * 1e9).toPrecision(3) + 'nF';
  return +(f * 1e12).toPrecision(3) + 'pF';
}
const P = [];
function add(o) { P.push(o); }
const row = (names, y = 0, x0 = 0) => names.map((n, i) => ({ n, x: x0 + i * 10, y }));
// generic breakout module: header pins in one row along the bottom edge, PCB above them
function module(o) {
  const pins = row(o.pins);
  const span = o.pins.length * 10 + 10;
  const w = Math.max(span, o.w || 0);
  const h = o.h || 50;
  const x0 = -5 - Math.round((w - span) / 2 / 10) * 10;
  return { bb: true, ...o, pins, body: { x: x0, y: -h, w, h: h + 4, color: o.color || '#1b4f9c' } };
}

// ---------- Resistors (E24, 1Ω – 1MΩ) ----------
const RES_TYPES = [
  { key: 'cf14', label: 'carbon film 1/4W 5%', watts: 0.25, tol: 5, color: '#e3c58f' },
  { key: 'mf14', label: 'metal film 1/4W 1%', watts: 0.25, tol: 1, color: '#7fb3e0' },
  { key: 'mf12', label: 'metal film 1/2W 1%', watts: 0.5, tol: 1, color: '#6aa6d9' },
];
const resValues = [];
for (const dec of [1, 10, 100, 1e3, 1e4, 1e5]) for (const m of E24) resValues.push(+(m * dec).toPrecision(3));
resValues.push(1e6);
for (const t of RES_TYPES) for (const r of resValues) add({
  id: `res-${t.key}-${r}`, name: `${fmtOhm(r)} resistor`, sub: t.label, cat: 'Passives', fam: 'Resistors', kind: 'resistor',
  p: { ohms: r, watts: t.watts, tol: t.tol, body: t.color }, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 40, y: 0 }],
  specs: [`${fmtOhm(r)} ±${t.tol}%`, `${t.watts}W max`, 'E24 series'], tags: 'resistor ohm r ' + fmtOhm(r).toLowerCase(),
});

// ---------- Capacitors ----------
const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];
function ceramicCode(pf) { const s = String(Math.round(pf)); const z = s.length - 2; return s.slice(0, 2) + z; }
for (const dec of [10, 100, 1e3, 1e4, 1e5]) for (const m of E6) {
  const pf = Math.round(m * dec); const f = pf * 1e-12;
  add({ id: `cap-cer-${pf}`, name: `${fmtF(f)} ceramic capacitor (${ceramicCode(pf)})`, sub: 'MLCC 50V', cat: 'Passives', fam: 'Capacitors', kind: 'capacitor',
    p: { farads: f, volts: 50, polar: false }, bb: true, pins: row(['1', '2']), specs: [`${fmtF(f)}`, '50V', 'non-polarised'], tags: 'capacitor ceramic cap' });
}
add({ id: 'cap-cer-1000000', name: '1µF ceramic capacitor (105)', sub: 'MLCC 50V', cat: 'Passives', fam: 'Capacitors', kind: 'capacitor',
  p: { farads: 1e-6, volts: 50, polar: false }, bb: true, pins: row(['1', '2']), specs: ['1µF', '50V'], tags: 'capacitor ceramic cap' });
for (const uf of [1, 2.2, 3.3, 4.7, 10, 22, 33, 47, 100, 220, 330, 470, 1000, 2200, 3300, 4700])
  for (const v of [6.3, 10, 16, 25, 35, 50]) add({
    id: `cap-el-${uf}-${v}`, name: `${uf}µF ${v}V electrolytic capacitor`, sub: 'aluminium, polarised', cat: 'Passives', fam: 'Capacitors', kind: 'capacitor',
    p: { farads: uf * 1e-6, volts: v, polar: true }, bb: true, pins: row(['+', '−']), specs: [`${uf}µF`, `${v}V max`, 'polarised: long leg +'], tags: 'capacitor electrolytic cap',
  });

// ---------- Diodes ----------
const diode = (id, name, sub, p, specs) => add({ id, name, sub, cat: 'Passives', fam: 'Diodes', kind: 'diode', p, bb: true,
  pins: [{ n: 'A', x: 0, y: 0 }, { n: 'K', x: 40, y: 0 }], specs, tags: 'diode ' + name.toLowerCase() });
[[1, 50], [2, 100], [3, 200], [4, 400], [5, 600], [6, 800], [7, 1000]].forEach(([n, v]) =>
  diode(`d-1n400${n}`, `1N400${n} rectifier diode`, `${v}V 1A`, { vf: 0.7, ron: 0.15, imax: 1, vrrm: v }, [`${v}V reverse`, '1A forward', 'band = cathode']));
[[0, 50], [1, 100], [2, 200], [4, 400], [6, 600], [7, 800], [8, 1000]].forEach(([n, v]) =>
  diode(`d-1n540${n}`, `1N540${n} rectifier diode`, `${v}V 3A`, { vf: 0.7, ron: 0.05, imax: 3, vrrm: v }, [`${v}V reverse`, '3A forward']));
diode('d-1n4148', '1N4148 signal diode', '75V 300mA', { vf: 0.62, ron: 1.5, imax: 0.3, vrrm: 75 }, ['75V', '300mA', 'fast switching 4ns']);
[[7, 20], [8, 30], [9, 40]].forEach(([n, v]) =>
  diode(`d-1n581${n}`, `1N581${n} Schottky diode`, `${v}V 1A`, { vf: 0.32, ron: 0.12, imax: 1, vrrm: v }, [`${v}V`, '1A', 'low drop ≈ 0.45V']));
diode('d-1n5822', '1N5822 Schottky diode', '40V 3A', { vf: 0.3, ron: 0.05, imax: 3, vrrm: 40 }, ['40V', '3A']);
diode('d-bat85', 'BAT85 Schottky diode', '30V 200mA', { vf: 0.28, ron: 2, imax: 0.2, vrrm: 30 }, ['30V', '200mA']);
diode('d-uf4007', 'UF4007 ultra-fast diode', '1000V 1A', { vf: 0.8, ron: 0.2, imax: 1, vrrm: 1000 }, ['1000V', '1A', '75ns recovery']);
diode('d-fr107', 'FR107 fast recovery diode', '1000V 1A', { vf: 0.8, ron: 0.2, imax: 1, vrrm: 1000 }, ['1000V', '1A']);
const Z1W = [3.3,3.6,3.9,4.3,4.7,5.1,5.6,6.2,6.8,7.5,8.2,9.1,10,11,12,13,15,16,18,20,22,24,27,30,33,36,39,43,47,51,56,62,68,75,82,91,100];
Z1W.forEach((vz, i) => diode(`z-1n${4728 + i}a`, `1N${4728 + i}A Zener diode ${vz}V`, '1W Zener', { vf: 0.7, ron: 0.5, imax: 1 / vz, vz, rz: 5, vrrm: 1e9 }, [`Vz ${vz}V`, '1W', 'band = cathode']));
const Z05 = [2.4,2.5,2.7,2.8,3.0,3.3,3.6,3.9,4.3,4.7,5.1,5.6,6.0,6.2,6.8,7.5,8.2,8.7,9.1,10,11,12,13,14,15,16,17,18,19,20,22,24,25,27,28,30,33,36,39,43,47,51,56,60,62,68,75];
Z05.forEach((vz, i) => diode(`z-1n${5221 + i}b`, `1N${5221 + i}B Zener diode ${vz}V`, '0.5W Zener', { vf: 0.7, ron: 1, imax: 0.5 / vz, vz, rz: 10, vrrm: 1e9 }, [`Vz ${vz}V`, '0.5W']));

// ---------- LEDs ----------
export const LED_COLORS = {
  red: { label: 'red', vf: 2.0, nm: '625nm', hex: '#ff2b2b' }, orange: { label: 'orange', vf: 2.0, nm: '605nm', hex: '#ff8c1a' },
  yellow: { label: 'yellow', vf: 2.1, nm: '590nm', hex: '#ffd61f' }, green: { label: 'green', vf: 2.2, nm: '570nm', hex: '#7cff3b' },
  puregreen: { label: 'pure green', vf: 3.1, nm: '525nm', hex: '#1fff70' }, blue: { label: 'blue', vf: 3.1, nm: '470nm', hex: '#3a74ff' },
  white: { label: 'white', vf: 3.1, nm: '6500K', hex: '#ffffff' }, warmwhite: { label: 'warm white', vf: 3.1, nm: '3000K', hex: '#ffdca8' },
  pink: { label: 'pink', vf: 3.1, nm: 'phosphor', hex: '#ff6ec7' }, uv: { label: 'UV / purple', vf: 3.3, nm: '400nm', hex: '#9b5cff' },
};
const LEDPINS = [{ n: 'A', x: 0, y: 0 }, { n: 'K', x: 10, y: 0 }];
for (const size of [3, 5]) for (const lens of ['diffused', 'water-clear']) for (const [ck, c] of Object.entries(LED_COLORS)) add({
  id: `led-${size}-${ck}-${lens === 'diffused' ? 'd' : 'c'}`, name: `${size}mm ${c.label} LED`, sub: `${lens}, ${c.nm}`, cat: 'LEDs & Lighting', fam: 'LEDs', kind: 'led',
  p: { color: ck, hex: c.hex, vf: c.vf, imax: 0.02, iabs: 0.03, size, lens }, bb: true, pins: LEDPINS,
  specs: [`Vf ≈ ${c.vf}V`, '20mA nominal, 30mA abs max', 'long leg = anode (A, +)'], tags: `led ${c.label} light ${size}mm`,
});
for (const ck of ['red', 'green', 'blue', 'yellow', 'white', 'warmwhite']) { const c = LED_COLORS[ck]; add({
  id: `led-10-${ck}`, name: `10mm ${c.label} LED`, sub: 'diffused jumbo', cat: 'LEDs & Lighting', fam: 'LEDs', kind: 'led',
  p: { color: ck, hex: c.hex, vf: c.vf, imax: 0.02, iabs: 0.03, size: 10, lens: 'diffused' }, bb: true, pins: LEDPINS,
  specs: [`Vf ≈ ${c.vf}V`, '20mA nominal'], tags: `led ${c.label} 10mm` }); }
for (const ck of ['red', 'green', 'blue', 'yellow']) { const c = LED_COLORS[ck]; add({
  id: `led-flash-${ck}`, name: `5mm self-flashing ${c.label} LED`, sub: 'built-in blink IC ≈ 2Hz', cat: 'LEDs & Lighting', fam: 'LEDs', kind: 'led',
  p: { color: ck, hex: c.hex, vf: Math.max(c.vf, 2.6), imax: 0.02, iabs: 0.03, size: 5, lens: 'diffused', flash: 2 }, bb: true,
  pins: LEDPINS, specs: ['blinks by itself when powered', 'needs a series resistor'], tags: 'led flashing blink' }); }
add({ id: 'led-ir-940', name: '5mm IR LED 940nm', sub: 'infrared emitter', cat: 'LEDs & Lighting', fam: 'LEDs', kind: 'led',
  p: { color: 'ir', hex: '#b04ad0', vf: 1.2, imax: 0.05, iabs: 0.1, size: 5, lens: 'water-clear', ir: true }, bb: true,
  pins: LEDPINS, specs: ['Vf ≈ 1.2V', '50mA continuous', 'invisible to eyes (shown as a faint glow)'], tags: 'led infrared ir' });
add({ id: 'led-ir-850', name: '5mm IR LED 850nm', sub: 'infrared emitter', cat: 'LEDs & Lighting', fam: 'LEDs', kind: 'led',
  p: { color: 'ir', hex: '#b04ad0', vf: 1.5, imax: 0.05, iabs: 0.1, size: 5, lens: 'water-clear', ir: true }, bb: true,
  pins: LEDPINS, specs: ['Vf ≈ 1.5V', '50mA continuous'], tags: 'led infrared ir' });
for (const size of [5, 8]) for (const common of ['cathode', 'anode']) for (const lens of size === 5 ? ['diffused', 'water-clear'] : ['diffused']) add({
  id: `rgb-${size}-${common}-${lens[0]}`, name: `${size}mm RGB LED, common ${common}`, sub: `4-pin, ${lens}`, cat: 'LEDs & Lighting', fam: 'RGB LEDs', kind: 'rgbled',
  p: { common, vfr: 2.0, vfg: 3.1, vfb: 3.1, imax: 0.02 }, bb: true, pins: row(['R', common === 'cathode' ? 'K' : 'A', 'G', 'B']),
  specs: ['R Vf≈2.0V, G/B Vf≈3.1V', '20mA per colour — one resistor per colour', `longest leg = common ${common}`], tags: 'rgb led colour color',
});
add({ id: 'laser-ky008', name: 'KY-008 laser module 650nm', sub: '5mW red laser diode', cat: 'LEDs & Lighting', fam: 'Light modules', kind: 'led',
  p: { color: 'red', hex: '#ff1010', vf: 2.2, imax: 0.04, iabs: 0.06, size: 6, lens: 'laser', laser: true, rser: 40 }, bb: true,
  pins: [{ n: 'S', x: 0, y: 0 }, { n: '−', x: 10, y: 0 }], specs: ['S = laser +, − = ground', 'onboard current limiting; a GPIO can switch it (≈15mA)'], tags: 'laser module ky-008' });

// ---------- WS2812 ----------
const strips = [
  ['ws-stick8', 'WS2812B stick, 8 LEDs (CJMCU-2812-8)', 8, 'line'], ['ws-ring8', 'WS2812B ring, 8 LEDs', 8, 'ring'],
  ['ws-ring12', 'WS2812B ring, 12 LEDs', 12, 'ring'], ['ws-ring16', 'WS2812B ring, 16 LEDs', 16, 'ring'], ['ws-ring24', 'WS2812B ring, 24 LEDs', 24, 'ring'],
  ['ws-strip30', 'WS2812B strip 1m, 30 LEDs/m', 30, 'line'], ['ws-strip60', 'WS2812B strip 1m, 60 LEDs/m', 60, 'line'],
  ['ws-strip72', 'WS2812B strip 0.5m, 144 LEDs/m (72)', 72, 'line'], ['ws-mat64', 'WS2812B 8×8 matrix (64)', 64, 'grid8'], ['ws-mat256', 'WS2812B 16×16 matrix (256)', 256, 'grid16'],
];
for (const [id, name, n, layout] of strips) add({ id, name, sub: 'addressable RGB, 5V', cat: 'LEDs & Lighting', fam: 'Addressable LEDs', kind: 'ws2812',
  p: { count: n, layout }, bb: false, pins: row(['5V', 'DIN', 'GND']), specs: [`${n} pixels`, '5V; up to 60mA per pixel at full white', 'library: neopixel or rpi_ws281x, DIN on GPIO18'], tags: 'neopixel ws2812 addressable strip ring rgb' });

// ---------- 7-segment / LED matrix ----------
const SEG1 = (common) => [...row(['g', 'f', 'COM', 'a', 'b'], 0), ...row(['e', 'd', 'COM2', 'c', 'DP'], 60)];
for (const [col, hex] of [['red', '#ff2b2b'], ['green', '#3bff4a'], ['blue', '#3a7bff'], ['yellow', '#ffd61f'], ['white', '#f4f4ff']]) for (const common of ['cathode', 'anode']) {
  const pn = col === 'red' ? (common === 'cathode' ? ' (5161AS)' : ' (5161BS)') : '';
  add({ id: `seg-056-${col}-${common[0]}`, name: `0.56" 7-segment, common ${common}, ${col}${pn}`, sub: '1 digit, 10 pins', cat: 'Displays', fam: '7-segment', kind: 'seg7',
    p: { common, hex, vf: col === 'red' || col === 'yellow' ? 2.0 : 3.0, digits: 1 }, bb: true, pins: SEG1(common),
    specs: ['8 LEDs (a–g + DP)', 'one resistor per segment', `common ${common}: COM pins to ${common === 'cathode' ? 'GND' : '3.3V'}`], tags: '7 segment seven digit display' });
}
for (const common of ['cathode', 'anode']) add({ id: `seg-036-red-${common[0]}`, name: `0.36" 7-segment, common ${common}, red (3161${common === 'cathode' ? 'AS' : 'BS'})`, sub: '1 digit, 10 pins', cat: 'Displays', fam: '7-segment', kind: 'seg7',
  p: { common, hex: '#ff2b2b', vf: 2.0, digits: 1 }, bb: true, pins: SEG1(common), specs: ['0.36" digit', 'one resistor per segment'], tags: '7 segment seven' });
for (const common of ['cathode', 'anode']) add({ id: `seg4-${common[0]}`, name: `4-digit 7-segment, common ${common} (5461${common === 'cathode' ? 'AS' : 'BS'})`, sub: '0.56", multiplexed, 12 pins', cat: 'Displays', fam: '7-segment', kind: 'seg7',
  p: { common, hex: '#ff2b2b', vf: 2.0, digits: 4 }, bb: true,
  pins: [...row(['e', 'd', 'DP', 'c', 'g', 'D4'], 60), ...row(['D1', 'a', 'f', 'D2', 'D3', 'b'], 0)],
  specs: ['multiplexed: D1–D4 are the digit commons', 'scan the digits quickly (persistence of vision)'], tags: '7 segment 4 digit multiplex' });
for (const [id, name, hex] of [['tm1637-036', 'TM1637 4-digit display module 0.36" red', '#ff2b2b'], ['tm1637-056', 'TM1637 4-digit display module 0.56" red, colon', '#ff2b2b'], ['tm1637-036b', 'TM1637 4-digit display module 0.36" blue', '#4a8dff']])
  add(module({ id, name, sub: '2-wire CLK/DIO', cat: 'Displays', fam: '7-segment', kind: 'tm1637', p: { hex },
    pins: ['CLK', 'DIO', 'VCC', 'GND'], w: 130, h: 60, color: '#1c4fa0', specs: ['3.3–5V', 'bit-banged 2-wire protocol', 'library: tm1637'], tags: '7 segment tm1637 clock display' }));
for (const [id, name, hex, chain] of [['max7219-8x8', 'MAX7219 8×8 LED matrix module, red', '#ff2b2b', 1], ['max7219-4in1', 'MAX7219 4-in-1 32×8 LED matrix, red', '#ff2b2b', 4], ['max7219-4in1-b', 'MAX7219 4-in-1 32×8 LED matrix, blue', '#4a8dff', 4]])
  add(module({ id, name, sub: 'SPI, daisy-chained', cat: 'Displays', fam: 'LED matrix', kind: 'max7219', p: { hex, chain },
    pins: ['VCC', 'GND', 'DIN', 'CS', 'CLK'], w: chain === 4 ? 330 : 90, h: 90, color: '#1d5c2e', specs: ['VCC 5V', 'DIN→MOSI (GPIO10), CLK→SCLK (GPIO11), CS→CE0 (GPIO8)', 'library: spidev (register writes)'], tags: 'matrix max7219 led dot display' }));

// ---------- Character LCD / OLED ----------
for (const [addr, chip] of [[0x27, 'PCF8574T'], [0x3f, 'PCF8574AT']]) for (const [col, bg, fg] of [['blue', '#2a55d8', '#e8f0ff'], ['yellow-green', '#9bc23a', '#152006']]) {
  const ah = '0x' + addr.toString(16).toUpperCase();
  add({ id: `lcd1602-i2c-${addr.toString(16)}-${col[0]}`, name: `LCD 16×2 (1602) I2C, ${col}`, sub: `${chip} backpack @ ${ah}`, cat: 'Displays', fam: 'Character LCD', kind: 'lcd',
    p: { cols: 16, rows: 2, addr, bg, fg, bus: 'i2c' }, bb: false, pins: row(['GND', 'VCC', 'SDA', 'SCL']),
    specs: ['HD44780 controller', `I2C address ${ah}`, 'VCC 5V for full contrast', 'library: RPLCD or smbus2'], tags: 'lcd 1602 16x2 i2c display character' });
  add({ id: `lcd2004-i2c-${addr.toString(16)}-${col[0]}`, name: `LCD 20×4 (2004) I2C, ${col}`, sub: `${chip} backpack @ ${ah}`, cat: 'Displays', fam: 'Character LCD', kind: 'lcd',
    p: { cols: 20, rows: 4, addr, bg, fg, bus: 'i2c' }, bb: false, pins: row(['GND', 'VCC', 'SDA', 'SCL']),
    specs: ['HD44780 controller', `I2C address ${ah}`, 'library: RPLCD or smbus2'], tags: 'lcd 2004 20x4 i2c display character' });
}
for (const [col, bg, fg] of [['blue', '#2a55d8', '#e8f0ff'], ['yellow-green', '#9bc23a', '#152006']]) add({ id: `lcd1602-par-${col[0]}`, name: `LCD 16×2 (1602) parallel, ${col}`, sub: 'HD44780, 4-bit mode', cat: 'Displays', fam: 'Character LCD', kind: 'lcd',
  p: { cols: 16, rows: 2, bg, fg, bus: 'parallel' }, bb: false, pins: row(['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K']),
  specs: ['RS, E, D4–D7 to GPIOs; RW to GND', 'library: RPLCD.gpio', 'A/K = backlight'], tags: 'lcd 1602 parallel hd44780 character' });
for (const [id, name, w, h, addr, ctrl, scheme] of [
  ['oled-096-w', '0.96" OLED 128×64 SSD1306 I2C, white', 128, 64, 0x3c, 'ssd1306', 'white'],
  ['oled-096-b', '0.96" OLED 128×64 SSD1306 I2C, blue', 128, 64, 0x3c, 'ssd1306', 'blue'],
  ['oled-096-yb', '0.96" OLED 128×64 SSD1306 I2C, yellow/blue', 128, 64, 0x3c, 'ssd1306', 'yb'],
  ['oled-096-w-3d', '0.96" OLED 128×64 SSD1306 I2C, white (0x3D)', 128, 64, 0x3d, 'ssd1306', 'white'],
  ['oled-091-w', '0.91" OLED 128×32 SSD1306 I2C, white', 128, 32, 0x3c, 'ssd1306', 'white'],
  ['oled-091-b', '0.91" OLED 128×32 SSD1306 I2C, blue', 128, 32, 0x3c, 'ssd1306', 'blue'],
  ['oled-13-w', '1.3" OLED 128×64 SH1106 I2C, white', 128, 64, 0x3c, 'sh1106', 'white'],
  ['oled-13-b', '1.3" OLED 128×64 SH1106 I2C, blue', 128, 64, 0x3c, 'sh1106', 'blue'],
]) add(module({ id, name, sub: `${ctrl.toUpperCase()} @ 0x${addr.toString(16).toUpperCase()}`, cat: 'Displays', fam: 'OLED', kind: 'oled',
  p: { w, h, addr, ctrl, scheme }, pins: ['GND', 'VCC', 'SCL', 'SDA'], w: 140, h: h === 64 ? 120 : 70, color: '#16243a',
  specs: ['3.3–5V (onboard regulator)', `I2C address 0x${addr.toString(16).toUpperCase()}`, ctrl === 'sh1106' ? 'SH1106: page addressing, 132-column RAM (2-column offset)' : 'library: adafruit_ssd1306 or smbus2'], tags: 'oled display ssd1306 sh1106 i2c screen' }));

// ---------- Buzzers ----------
for (const [id, name, active, v, i, sub] of [
  ['buz-a5', 'Active buzzer 5V (TMB12A05)', true, 5, 0.03, '12mm, built-in oscillator ≈2.3kHz'],
  ['buz-a3', 'Active buzzer 3V (TMB12A03)', true, 3, 0.025, '12mm, ≈2.3kHz'],
  ['buz-a12', 'Active buzzer 12V (TMB12A12)', true, 12, 0.02, '12mm, ≈2.3kHz'],
  ['buz-p12', 'Passive buzzer 12mm', false, 5, 0.03, 'needs a PWM tone'],
  ['buz-p9', 'Passive buzzer 9mm', false, 3, 0.02, 'needs a PWM tone'],
  ['buz-disc27', 'Piezo disc 27mm', false, 5, 0.005, 'passive piezo element'],
  ['buz-disc35', 'Piezo disc 35mm', false, 5, 0.005, 'passive piezo element'],
]) add({ id, name, sub, cat: 'Actuators', fam: 'Buzzers', kind: 'buzzer', p: { active, v, i }, bb: true, pins: [{ n: '+', x: 0, y: 0 }, { n: '−', x: 30, y: 0 }],
  specs: [active ? 'DC on = beep' : 'pitch = PWM frequency', `${v}V rated, ≈${Math.round(i * 1000)}mA`, 'GPIO max 16mA — use a transistor for loud buzzers'], tags: `buzzer ${active ? 'active' : 'passive'} sound piezo beep` });
add(module({ id: 'buz-ky012', name: 'KY-012 active buzzer module', sub: 'S high = beep', cat: 'Actuators', fam: 'Buzzers', kind: 'buzzer', p: { active: true, v: 5, i: 0.03, module: 'high' },
  pins: ['S', 'VCC', 'GND'], color: '#222', specs: ['S HIGH = beep', '3.3–5V'], tags: 'buzzer active module ky-012 beep' }));
add(module({ id: 'buz-ky006', name: 'KY-006 passive buzzer module', sub: 'PWM tone on S', cat: 'Actuators', fam: 'Buzzers', kind: 'buzzer', p: { active: false, v: 5, i: 0.02, module: 'high' },
  pins: ['S', 'VCC', 'GND'], color: '#222', specs: ['tone = PWM frequency on S'], tags: 'buzzer passive module ky-006 tone' }));
add(module({ id: 'buz-lowtrig', name: 'Active buzzer module (low-level trigger)', sub: 'I/O LOW = beep, S8550 PNP', cat: 'Actuators', fam: 'Buzzers', kind: 'buzzer', p: { active: true, v: 5, i: 0.03, module: 'low' },
  pins: ['VCC', 'I/O', 'GND'], color: '#1b4f9c', specs: ['I/O LOW = beep', '3.3–5V'], tags: 'buzzer active module low trigger beep' }));

// ---------- Servos ----------
for (const [id, name, o] of [
  ['srv-sg90', 'SG90 micro servo 9g', { vmin: 4.8, vmax: 6, pmin: 500, pmax: 2400, range: 180, speed: 0.1, torque: '1.8kg·cm', stall: 0.65 }],
  ['srv-sg92r', 'SG92R micro servo', { vmin: 4.8, vmax: 6, pmin: 500, pmax: 2400, range: 180, speed: 0.1, torque: '2.5kg·cm', stall: 0.7 }],
  ['srv-mg90s', 'MG90S metal-gear micro servo', { vmin: 4.8, vmax: 6, pmin: 500, pmax: 2400, range: 180, speed: 0.1, torque: '2.2kg·cm', stall: 0.7 }],
  ['srv-mg92b', 'MG92B metal-gear micro servo', { vmin: 4.8, vmax: 6, pmin: 500, pmax: 2400, range: 180, speed: 0.13, torque: '3.5kg·cm', stall: 0.8 }],
  ['srv-mg996r', 'MG996R high-torque servo', { vmin: 4.8, vmax: 7.2, pmin: 500, pmax: 2500, range: 180, speed: 0.17, torque: '9.4–11kg·cm', stall: 2.5, big: true }],
  ['srv-mg995', 'MG995 servo', { vmin: 4.8, vmax: 7.2, pmin: 500, pmax: 2500, range: 180, speed: 0.2, torque: '8.5kg·cm', stall: 1.2, big: true }],
  ['srv-ds3218', 'DS3218 20kg digital servo', { vmin: 4.8, vmax: 6.8, pmin: 500, pmax: 2500, range: 180, speed: 0.16, torque: '20kg·cm', stall: 2.2, big: true }],
  ['srv-s3003', 'Futaba S3003 standard servo', { vmin: 4.8, vmax: 6, pmin: 600, pmax: 2400, range: 180, speed: 0.23, torque: '3.2kg·cm', stall: 0.8, big: true }],
  ['srv-hs311', 'Hitec HS-311 standard servo', { vmin: 4.8, vmax: 6, pmin: 575, pmax: 2460, range: 180, speed: 0.19, torque: '3.0kg·cm', stall: 0.8, big: true }],
  ['srv-fs90r', 'FS90R continuous-rotation micro servo', { vmin: 4.8, vmax: 6, pmin: 700, pmax: 2300, range: 0, continuous: true, rpm: 130, torque: '1.5kg·cm', stall: 0.65 }],
  ['srv-fs5103r', 'FS5103R continuous-rotation servo', { vmin: 4.8, vmax: 6, pmin: 1000, pmax: 2000, range: 0, continuous: true, rpm: 70, torque: '3kg·cm', stall: 1.0, big: true }],
  ['srv-mg996r-360', 'MG996R 360° continuous-rotation servo', { vmin: 4.8, vmax: 7.2, pmin: 1000, pmax: 2000, range: 0, continuous: true, rpm: 60, torque: '9.4kg·cm', stall: 2.5, big: true }],
]) add({ id, name, sub: o.continuous ? 'speed & direction by pulse width' : `${o.range}° · ${o.torque}`, cat: 'Actuators', fam: 'Servos', kind: 'servo', p: o, bb: false,
  pins: row(['GND', 'V+', 'SIG']), specs: [`${o.vmin}–${o.vmax}V`, o.continuous ? '1.5ms pulse = stop, shorter/longer = spin' : `pulse ${o.pmin}–${o.pmax}µs at 50Hz`, `stall ≈ ${o.stall}A — power from 5V, never 3.3V`, `torque ${o.torque}`], tags: 'servo motor pwm' });

// ---------- DC motors / fans / pumps ----------
const motors = [
  ['mot-130', '130 DC motor (3–6V)', 6, 0.25, 9000], ['mot-tt48', 'TT gear motor 1:48 (yellow)', 6, 0.16, 200], ['mot-tt120', 'TT gear motor 1:120', 6, 0.16, 100],
  ['mot-r385', 'R385 DC motor 12V', 12, 0.4, 6000], ['mot-rs775', 'RS-775 DC motor 12V', 12, 1.5, 12000], ['mot-jga25', 'JGA25-370 gear motor 12V 100rpm', 12, 0.3, 100],
  ...[30, 50, 100, 200, 300, 500, 1000].map(r => [`mot-n20-${r}`, `N20 micro gear motor 6V ${r}rpm`, 6, 0.06, r]),
  ['mot-vib', 'Coin vibration motor 3V (1027)', 3, 0.08, 12000],
  ['fan-3007', '5V brushless fan 30mm (3007)', 5, 0.1, 10000, 'fan'], ['fan-4010', '5V brushless fan 40mm (4010)', 5, 0.15, 6000, 'fan'], ['fan-8025', '12V fan 80mm (8025)', 12, 0.15, 2500, 'fan'],
  ['pump-jt', 'Mini submersible pump 3–6V (JT-DC3W)', 6, 0.18, 0, 'pump'],
];
for (const [id, name, v, i, rpm, style] of motors) add({ id, name, sub: `${v}V, ≈${Math.round(i * 1000)}mA`, cat: 'Actuators', fam: style ? 'Fans & pumps' : 'DC motors', kind: 'motor',
  p: { v, i, rpm, style: style || 'motor' }, bb: false, pins: row(['+', '−']), specs: [`${v}V rated`, `≈${Math.round(i * 1000)}mA running`, 'never drive from a GPIO pin directly — use a driver or MOSFET'], tags: 'motor dc ' + (style || 'gear') });

// ---------- Steppers ----------
for (const [id, name, o] of [
  ['stp-28byj5', '28BYJ-48 stepper motor 5V', { uni: true, v: 5, steps: 4096, coilR: 50, i: 0.24 }],
  ['stp-28byj12', '28BYJ-48 stepper motor 12V', { uni: true, v: 12, steps: 4096, coilR: 130, i: 0.1 }],
  ['stp-17hs4401', 'NEMA17 stepper 17HS4401 (1.7A)', { uni: false, v: 12, steps: 200, coilR: 1.5, i: 1.7 }],
  ['stp-17hs4023', 'NEMA17 stepper 17HS4023 (0.7A)', { uni: false, v: 12, steps: 200, coilR: 4, i: 0.7 }],
  ['stp-17hs08', 'NEMA17 stepper 17HS08-1004S (1A)', { uni: false, v: 12, steps: 200, coilR: 3.5, i: 1 }],
  ['stp-23hs22', 'NEMA23 stepper 23HS22-2804S (2.8A)', { uni: false, v: 24, steps: 200, coilR: 0.9, i: 2.8 }],
]) add({ id, name, sub: o.uni ? 'unipolar, 64:1 gearbox' : 'bipolar, 1.8°/step', cat: 'Actuators', fam: 'Stepper motors', kind: 'stepper', p: o, bb: false,
  pins: o.uni ? row(['IN1', 'IN2', 'IN3', 'IN4', 'V+']) : row(['1A', '1B', '2A', '2B']),
  specs: o.uni ? ['plug into a ULN2003 board (IN1–IN4 to M1–M4, V+ to MV+)', '4096 half-steps per output turn'] : ['coils to an A4988 / DRV8825 / TMC2208 (1A,1B,2A,2B)', '200 full steps per turn'], tags: 'stepper motor nema 28byj' });

// ---------- Motor drivers ----------
add(module({ id: 'drv-l298n', name: 'L298N dual H-bridge module', sub: '2A per channel, 5–35V', cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'hbridge', p: { chip: 'L298N', drop: 2.0, imax: 2, ch: [['ENA', 'IN1', 'IN2', 'OUT1', 'OUT2'], ['ENB', 'IN3', 'IN4', 'OUT3', 'OUT4']], vs: 'VS', gnd: 'GND', logic: '5V' },
  pins: ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB', 'OUT1', 'OUT2', 'OUT3', 'OUT4', 'VS', 'GND', '5V'], w: 160, h: 100, color: '#b5202e', specs: ['≈2V drop across the bridge', 'ENA/ENB: PWM = speed (remove the jumpers)', 'tie module GND to Pi GND', '5V pin = onboard regulator output when VS ≤ 12V'], tags: 'l298n motor driver h-bridge' }));
add({ id: 'drv-l293d', name: 'L293D quad half-H driver IC', sub: 'DIP-16, 600mA/ch', cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'hbridge', bb: true,
  p: { chip: 'L293D', drop: 1.4, imax: 0.6, ch: [['EN1,2', '1A', '2A', '1Y', '2Y'], ['EN3,4', '3A', '4A', '3Y', '4Y']], vs: 'VS', gnd: 'GND', logic: 'VCC1' },
  pins: [...row(['EN1,2', '1A', '1Y', 'GND', 'GND2', '2Y', '2A', 'VS'], 30), ...['VCC1', '4A', '4Y', 'GND3', 'GND4', '3Y', '3A', 'EN3,4'].map((n, i) => ({ n, x: 70 - i * 10, y: 0 }))],
  specs: ['pin 16 VCC1 = 5V logic, pin 8 VS = motor supply', 'built-in clamp diodes', 'straddle the breadboard gap'], tags: 'l293d motor driver ic h-bridge' });
add(module({ id: 'drv-tb6612', name: 'TB6612FNG dual motor driver', sub: '1.2A/ch, MOSFET bridge', cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'hbridge',
  p: { chip: 'TB6612', drop: 0.3, imax: 1.2, ch: [['PWMA', 'AIN1', 'AIN2', 'AO1', 'AO2'], ['PWMB', 'BIN1', 'BIN2', 'BO1', 'BO2']], vs: 'VM', gnd: 'GND', logic: 'VCC', stby: 'STBY' },
  pins: ['PWMA', 'AIN2', 'AIN1', 'STBY', 'BIN1', 'BIN2', 'PWMB', 'GND', 'VM', 'VCC', 'AO1', 'AO2', 'BO2', 'BO1'], w: 150, h: 60, color: '#b5202e', specs: ['VCC 2.7–5.5V logic, VM ≤ 13.5V', 'STBY must be HIGH'], tags: 'tb6612 tb6612fng motor driver' }));
for (const [id, name, chip, sub, pins, ch, vs, gnd, drop, imax, color] of [
  ['drv-drv8833', 'DRV8833 dual motor driver', 'DRV8833', '1.5A/ch, 2.7–10.8V', ['AIN1', 'AIN2', 'BIN1', 'BIN2', 'VM', 'GND', 'AO1', 'AO2', 'BO1', 'BO2'], [[null, 'AIN1', 'AIN2', 'AO1', 'AO2'], [null, 'BIN1', 'BIN2', 'BO1', 'BO2']], 'VM', 'GND', 0.4, 1.5, '#7b2c8f'],
  ['drv-l9110s', 'L9110S dual motor driver', 'L9110S', '800mA/ch, 2.5–12V', ['B-IA', 'B-IB', 'GND', 'VCC', 'A-IA', 'A-IB', 'MA1', 'MA2', 'MB1', 'MB2'], [[null, 'A-IA', 'A-IB', 'MA1', 'MA2'], [null, 'B-IA', 'B-IB', 'MB1', 'MB2']], 'VCC', 'GND', 0.6, 0.8, '#1d6b33'],
  ['drv-mx1508', 'MX1508 dual motor driver', 'MX1508', '1.5A/ch, 2–10V', ['IN1', 'IN2', 'IN3', 'IN4', '+', '−', 'MA1', 'MA2', 'MB1', 'MB2'], [[null, 'IN1', 'IN2', 'MA1', 'MA2'], [null, 'IN3', 'IN4', 'MB1', 'MB2']], '+', '−', 0.4, 1.5, '#b5202e'],
]) add(module({ id, name, sub, cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'hbridge', p: { chip, drop, imax, ch, vs, gnd }, pins, w: 120, h: 50, color,
  specs: ['no enable pins: PWM one input for speed', `≈${drop}V drop`], tags: chip.toLowerCase() + ' motor driver' }));
add(module({ id: 'drv-bts7960', name: 'BTS7960 43A H-bridge (IBT-2)', sub: '6–27V, high current', cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'hbridge',
  p: { chip: 'BTS7960', drop: 0.2, imax: 43, bts: true, vs: 'B+', gnd: 'B−', logic: 'VCC' },
  pins: ['RPWM', 'LPWM', 'R_EN', 'L_EN', 'R_IS', 'L_IS', 'VCC', 'GND', 'M+', 'M−', 'B+', 'B−'], w: 140, h: 90, color: '#222', specs: ['R_EN and L_EN HIGH to enable', 'PWM on RPWM (forward) or LPWM (reverse)', 'GND and B− must both reach Pi GND'], tags: 'bts7960 ibt-2 motor driver' }));
add(module({ id: 'drv-uln2003', name: 'ULN2003 stepper driver board', sub: 'for 28BYJ-48, 500mA/ch', cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'uln2003', p: {},
  pins: ['IN1', 'IN2', 'IN3', 'IN4', 'V+', 'GND', 'M1', 'M2', 'M3', 'M4', 'MV+'], w: 120, h: 70, color: '#1d6b33', specs: ['5–12V motor supply on V+', 'LEDs A–D show active phases', 'M1–M4 + MV+ = the stepper plug'], tags: 'uln2003 stepper driver darlington 28byj' }));
for (const [id, name, ms, imax, color] of [['drv-a4988', 'A4988 stepper driver (StepStick)', 16, 2, '#1d6b33'], ['drv-drv8825', 'DRV8825 stepper driver', 32, 2.2, '#6b2c8f'], ['drv-tmc2208', 'TMC2208 silent stepper driver', 16, 1.4, '#1d4f9c']])
  add(module({ id, name, sub: `STEP/DIR, up to 1/${ms} microstep`, cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'stepdir', p: { ms, imax },
    pins: ['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND2'], w: 170, h: 60, color,
    specs: ['EN LOW = enabled; tie RST to SLP (HIGH)', 'one STEP rising edge = one (micro)step', 'VMOT 8–35V, VDD 3–5.5V'], tags: 'stepper driver a4988 drv8825 tmc2208 step dir' }));
add(module({ id: 'drv-irf520', name: 'IRF520 MOSFET driver module', sub: '24V low-side switch', cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'mosmodule', p: { vth: 3.0, rds: 0.27, vfull: 10 },
  pins: ['SIG', 'VCC', 'GND', 'V+', 'V−', 'VIN', 'GND2'], w: 100, h: 60, color: '#b5202e', specs: ['IRF520 is NOT logic-level: a 3.3V gate barely turns it on', 'load between V+ and V−; supply on VIN/GND2'], tags: 'mosfet module irf520' }));

// ---------- Relays ----------
for (const [id, name, ch, trig, coilV] of [
  ['rly-1ch', '1-channel 5V relay module (low trigger)', 1, 'low', 5], ['rly-2ch', '2-channel 5V relay module (low trigger)', 2, 'low', 5],
  ['rly-4ch', '4-channel 5V relay module (low trigger)', 4, 'low', 5], ['rly-8ch', '8-channel 5V relay module (low trigger)', 8, 'low', 5],
  ['rly-1ch-hl', '1-channel 5V relay module, high trigger', 1, 'high', 5], ['rly-1ch-3v', '1-channel 3.3V relay module (high trigger)', 1, 'high', 3.3],
]) { const ins = Array.from({ length: ch }, (_, i) => `IN${i + 1}`); const contacts = [];
  for (let i = 1; i <= ch; i++) contacts.push(`NO${i}`, `COM${i}`, `NC${i}`);
  add(module({ id, name, sub: `SRD-${coilV === 5 ? '05' : '03'}VDC-SL-C relays, 10A 250VAC`, cat: 'Actuators', fam: 'Relays', kind: 'relaymod', p: { ch, trig, coilV, coilI: 0.072 },
    pins: ['GND', ...ins, 'VCC', ...contacts], w: Math.max(80, ch * 60), h: 90, color: '#1b4f9c',
    specs: [trig === 'low' ? 'IN LOW = relay ON' : 'IN HIGH = relay ON', `≈${72}mA per energised coil from VCC`, 'COM–NO closes when ON, COM–NC opens'], tags: 'relay module switch' })); }
add(module({ id: 'rly-ssr', name: 'Omron G3MB-202P solid-state relay module', sub: '2A, AC loads only', cat: 'Actuators', fam: 'Relays', kind: 'relaymod', p: { ch: 1, trig: 'high', coilV: 5, coilI: 0.012, ssr: true },
  pins: ['GND', 'IN1', 'VCC', 'NO1', 'COM1', 'NC1'], w: 80, h: 70, color: '#1b4f9c', specs: ['IN HIGH = ON', 'zero-cross triac: will not switch a DC load off'], tags: 'ssr solid state relay' }));
for (const [id, name, v, r] of [['rly-srd05', 'SRD-05VDC-SL-C bare relay', 5, 70], ['rly-srd12', 'SRD-12VDC-SL-C bare relay', 12, 400], ['rly-srd03', 'SRD-03VDC-SL-C bare relay', 3, 25]])
  add({ id, name, sub: `${v}V coil, ${r}Ω`, cat: 'Actuators', fam: 'Relays', kind: 'relay', p: { v, r }, bb: true,
    pins: [{ n: 'C1', x: 0, y: 0 }, { n: 'COM', x: 20, y: 0 }, { n: 'C2', x: 40, y: 0 }, { n: 'NC', x: 0, y: 40 }, { n: 'NO', x: 40, y: 40 }],
    specs: [`coil ${v}V / ${Math.round(v / r * 1000)}mA — drive through a transistor`, 'add a flyback diode across the coil', 'contacts 10A'], tags: 'relay bare coil' });

// ---------- Loads ----------
for (const [id, name, v, i, style] of [['lamp-6v', 'Miniature bulb 6V 0.3A', 6, 0.3, 'bulb'], ['lamp-12v', 'Miniature bulb 12V 0.1A', 12, 0.1, 'bulb'],
  ['sol-lock12', 'Solenoid door lock 12V', 12, 0.8, 'solenoid'], ['sol-jf0530', 'Push-pull solenoid 5V (JF-0530B)', 5, 1.0, 'solenoid'], ['emag-5v', 'Electromagnet 5V (P20/15)', 5, 0.3, 'solenoid']])
  add({ id, name, sub: `${v}V ${i}A`, cat: 'Actuators', fam: style === 'bulb' ? 'Lamps' : 'Solenoids', kind: 'load', p: { v, i, style }, bb: false, pins: row(['+', '−']),
    specs: [`${v}V, ${i}A`, style === 'solenoid' ? 'inductive: add a flyback diode across it' : 'resistive load'], tags: style + ' load lamp bulb lock' });

// ---------- Buttons, switches, keypads ----------
const BTN4 = [{ n: '1', x: 0, y: 0 }, { n: '2', x: 20, y: 0 }, { n: '3', x: 0, y: 30 }, { n: '4', x: 20, y: 30 }];
add({ id: 'btn-6x6', name: 'Tactile push button 6×6mm', sub: '4-pin, momentary', cat: 'Input', fam: 'Buttons', kind: 'button', p: { cap: '#333', size: 6 }, bb: true,
  pins: BTN4, specs: ['pins 1–2 and 3–4 always connected', 'pressing joins the two pairs', 'straddle the breadboard gap'], tags: 'button push tactile switch' });
add({ id: 'btn-6x6-2p', name: 'Tactile push button 6×6mm, 2-pin', sub: 'momentary', cat: 'Input', fam: 'Buttons', kind: 'button', p: { cap: '#333', size: 6, two: true }, bb: true,
  pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 20, y: 0 }], specs: ['pressing joins 1–2'], tags: 'button push tactile switch' });
const CAPS = [['red', '#d23'], ['yellow', '#ec3'], ['blue', '#36c'], ['green', '#3a4'], ['white', '#eee'], ['black', '#222'], ['grey', '#888']];
for (const [c, hex] of CAPS) add({ id: `btn-12x12-${c}`, name: `Tactile button 12×12mm, ${c} cap`, sub: '4-pin, momentary', cat: 'Input', fam: 'Buttons', kind: 'button', p: { cap: hex, size: 12 }, bb: true,
  pins: BTN4, specs: ['pins 1–2 and 3–4 internally connected'], tags: 'button push tactile ' + c });
for (const [c, hex] of CAPS.slice(0, 6)) add({ id: `btn-arcade-${c}`, name: `Arcade button 30mm, ${c}`, sub: 'microswitch, momentary', cat: 'Input', fam: 'Buttons', kind: 'button', p: { cap: hex, size: 30, two: true }, bb: false,
  pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 20, y: 0 }], specs: ['wire COM and NO tabs'], tags: 'arcade button ' + c });
add(module({ id: 'btn-ky004', name: 'KY-004 push button module', sub: '10kΩ pull-up on board', cat: 'Input', fam: 'Buttons', kind: 'button', p: { cap: '#333', size: 6, module: 'pullup' },
  pins: ['S', '+', '−'], color: '#222', specs: ['S reads HIGH, pressed = LOW (10k pull-up to +)'], tags: 'button module ky-004' }));
add(module({ id: 'touch-ttp223', name: 'TTP223 capacitive touch module', sub: 'momentary, active HIGH', cat: 'Input', fam: 'Touch', kind: 'digimod', p: { vmin: 2.0, vmax: 5.5, iq: 0.002, out: 'vcc', act: 'high', ctl: 'touch' },
  pins: ['GND', 'I/O', 'VCC'], color: '#b5202e', specs: ['2–5.5V', 'I/O HIGH while touched'], tags: 'touch capacitive ttp223 sensor' }));
add(module({ id: 'touch-ttp223-t', name: 'TTP223 touch module (toggle mode jumper)', sub: 'each touch toggles output', cat: 'Input', fam: 'Touch', kind: 'digimod', p: { vmin: 2.0, vmax: 5.5, iq: 0.002, out: 'vcc', act: 'high', ctl: 'touch', toggle: true },
  pins: ['GND', 'I/O', 'VCC'], color: '#b5202e', specs: ['2–5.5V', 'touch toggles I/O'], tags: 'touch capacitive ttp223 toggle' }));
add(module({ id: 'touch-ky036', name: 'KY-036 metal touch sensor module', sub: 'DO + AO', cat: 'Input', fam: 'Touch', kind: 'digimod', p: { vmin: 3.3, vmax: 5.5, iq: 0.005, out: 'vcc', act: 'high', ctl: 'touch', ao: true },
  pins: ['AO', 'GND', '+', 'DO'], color: '#222', specs: ['DO HIGH when touched'], tags: 'touch metal ky-036' }));
add({ id: 'sw-slide', name: 'Slide switch SS12D00 (SPDT)', sub: '3-pin, on-on', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spdt' }, bb: true, pins: row(['1', 'COM', '2']), specs: ['COM connects to 1 or 2'], tags: 'switch slide spdt' });
add({ id: 'sw-mts101', name: 'Toggle switch MTS-101 (SPST)', sub: '2-pin, on-off', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spst' }, bb: true, pins: row(['1', '2']), specs: ['ON joins 1–2'], tags: 'switch toggle spst' });
add({ id: 'sw-mts102', name: 'Toggle switch MTS-102 (SPDT)', sub: '3-pin, on-on', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spdt' }, bb: true, pins: row(['1', 'COM', '2']), specs: ['COM to 1 or 2'], tags: 'switch toggle spdt' });
add({ id: 'sw-kcd1', name: 'Rocker switch KCD1 (SPST)', sub: '2-pin, 6A', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spst' }, bb: false, pins: row(['1', '2']), specs: ['ON joins 1–2'], tags: 'switch rocker power' });
add({ id: 'sw-reed', name: 'Reed switch (glass, normally open)', sub: 'closes near a magnet', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spst', magnet: true }, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 40, y: 0 }], specs: ['magnet nearby = closed'], tags: 'reed switch magnet door' });
add({ id: 'sw-kw11', name: 'Limit microswitch KW11-3Z', sub: 'COM / NO / NC, lever', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spdt', momentary: true }, bb: false, pins: row(['NC', 'COM', 'NO']), specs: ['pressed: COM–NO, released: COM–NC'], tags: 'limit switch micro endstop' });
add({ id: 'sw-sw520d', name: 'Tilt switch SW-520D', sub: 'ball tilt, 2-pin', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spst', tilt: true }, bb: true, pins: row(['1', '2']), specs: ['upright = closed, tilted = open'], tags: 'tilt switch ball' });
add({ id: 'sw-18010p', name: 'Vibration switch SW-18010P', sub: 'spring, 2-pin', cat: 'Input', fam: 'Switches', kind: 'switch', p: { type: 'spst', momentary: true }, bb: true, pins: row(['1', '2']), specs: ['closes briefly on vibration'], tags: 'vibration switch spring' });
for (const n of [2, 3, 4, 5, 6, 8]) add({ id: `sw-dip${n}`, name: `DIP switch, ${n} positions`, sub: '2.54mm, through-hole', cat: 'Input', fam: 'Switches', kind: 'dip', p: { n }, bb: true,
  pins: [...Array.from({ length: n }, (_, i) => ({ n: `${i + 1}`, x: i * 10, y: 30 })), ...Array.from({ length: n }, (_, i) => ({ n: `${2 * n - i}`, x: i * 10, y: 0 }))],
  specs: [`${n} independent switches`, 'straddle the breadboard gap'], tags: 'dip switch' });
for (const [id, name, r, c, keys] of [['kp-4x4', '4×4 membrane keypad', 4, 4, '123A456B789C*0#D'], ['kp-4x3', '4×3 membrane keypad', 4, 3, '123456789*0#'], ['kp-1x4', '1×4 membrane keypad', 1, 4, '1234']])
  add({ id, name, sub: `${r * c} keys, matrix`, cat: 'Input', fam: 'Keypads', kind: 'keypad', p: { r, c, keys }, bb: false,
    pins: row([...Array.from({ length: r }, (_, i) => `R${i + 1}`), ...Array.from({ length: c }, (_, i) => `C${i + 1}`)]),
    specs: ['scan: drive rows, read columns with pull-ups', `${r} rows × ${c} columns`], tags: 'keypad matrix membrane keys' });

// ---------- Potentiometers / encoders / joysticks ----------
const POT_W = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2.5e5, 5e5, 1e6];
for (const r of POT_W) add({ id: `pot-wh148-b${r}`, name: `${fmtOhm(r)} rotary potentiometer (WH148 B${fmtOhm(r).replace('Ω', '').toUpperCase()})`, sub: 'linear taper, 3 pins', cat: 'Input', fam: 'Potentiometers', kind: 'pot',
  p: { ohms: r, taper: 'lin' }, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: 'W', x: 20, y: 0 }, { n: '3', x: 40, y: 0 }], specs: [`${fmtOhm(r)} end-to-end`, 'middle pin = wiper'], tags: 'potentiometer pot knob variable resistor' });
for (const r of [1e4, 5e4, 1e5]) add({ id: `pot-wh148-a${r}`, name: `${fmtOhm(r)} audio-taper potentiometer (WH148 A${fmtOhm(r).replace('Ω', '').toUpperCase()})`, sub: 'logarithmic taper', cat: 'Input', fam: 'Potentiometers', kind: 'pot',
  p: { ohms: r, taper: 'log' }, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: 'W', x: 20, y: 0 }, { n: '3', x: 40, y: 0 }], specs: [`${fmtOhm(r)}`, 'log taper (volume knob)'], tags: 'potentiometer pot audio log' });
for (const [code, r] of [['101', 100], ['201', 200], ['501', 500], ['102', 1e3], ['202', 2e3], ['502', 5e3], ['103', 1e4], ['203', 2e4], ['503', 5e4], ['104', 1e5], ['204', 2e5], ['504', 5e5], ['105', 1e6]])
  add({ id: `pot-3296-${code}`, name: `${fmtOhm(r)} trimmer potentiometer (3296W-1-${code})`, sub: '25-turn multiturn trimmer', cat: 'Input', fam: 'Potentiometers', kind: 'pot',
    p: { ohms: r, taper: 'lin', trim: true }, bb: true, pins: row(['1', 'W', '3']), specs: [`${fmtOhm(r)}`, '25 turns'], tags: 'trimmer potentiometer pot 3296' });
for (const r of [1e4, 5e4, 1e5]) add({ id: `pot-slide-${r}`, name: `${fmtOhm(r)} slide potentiometer (60mm)`, sub: 'linear fader', cat: 'Input', fam: 'Potentiometers', kind: 'pot',
  p: { ohms: r, taper: 'lin', slide: true }, bb: false, pins: row(['1', 'W', '3']), specs: [`${fmtOhm(r)}`, '60mm travel'], tags: 'slide potentiometer fader' });
for (const r of [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5]) add({ id: `pot-3590s-${r}`, name: `${fmtOhm(r)} 10-turn precision pot (3590S)`, sub: 'wirewound, 10 turns', cat: 'Input', fam: 'Potentiometers', kind: 'pot',
  p: { ohms: r, taper: 'lin', turns: 10 }, bb: false, pins: row(['1', 'W', '3']), specs: [`${fmtOhm(r)}`, '10 turns'], tags: 'precision potentiometer 10 turn' });
add(module({ id: 'enc-ky040', name: 'KY-040 rotary encoder module', sub: 'quadrature + push switch', cat: 'Input', fam: 'Encoders & joysticks', kind: 'encoder', p: { ppr: 20, pullups: true },
  pins: ['CLK', 'DT', 'SW', '+', 'GND'], color: '#1b4f9c', specs: ['20 detents per turn', '10k pull-ups on CLK/DT (+ must be 3.3V)', 'SW to GND when pressed (no pull-up)'], tags: 'rotary encoder ky-040 knob' }));
add({ id: 'enc-ec11', name: 'EC11 rotary encoder with switch', sub: 'bare, 5 pins', cat: 'Input', fam: 'Encoders & joysticks', kind: 'encoder', p: { ppr: 20, pullups: false }, bb: true,
  pins: [{ n: 'A', x: 0, y: 30 }, { n: 'C', x: 10, y: 30 }, { n: 'B', x: 20, y: 30 }, { n: 'SW1', x: 0, y: 0 }, { n: 'SW2', x: 20, y: 0 }], specs: ['C = common (to GND)', 'needs pull-ups on A/B'], tags: 'rotary encoder ec11' });
add(module({ id: 'joy-ky023', name: 'KY-023 dual-axis joystick module', sub: '2× 10k pots + button', cat: 'Input', fam: 'Encoders & joysticks', kind: 'joystick', p: { ohms: 1e4 },
  pins: ['GND', '+5V', 'VRx', 'VRy', 'SW'], w: 90, h: 90, color: '#222', specs: ['VRx/VRy analog: needs an ADC (MCP3008 / ADS1115)', 'SW to GND when pressed'], tags: 'joystick ky-023 analog thumbstick' }));

// ---------- Transistors ----------
const TO92 = (o) => ({ ...o, bb: true, pins: row(o.order.split('')), cat: 'Semiconductors', kind: o.mos ? 'mosfet' : 'bjt' });
const TO220 = (o) => ({ ...o, bb: true, pins: row(o.order.split('')), cat: 'Semiconductors', kind: o.mos ? 'mosfet' : 'bjt', big: true });
for (const [pn, pol, order, hfe, ic, pkg, extra] of [
  ['2N2222A', 'npn', 'EBC', 150, 0.8, 92], ['PN2222A', 'npn', 'EBC', 150, 1.0, 92], ['2N3904', 'npn', 'EBC', 150, 0.2, 92], ['2N4401', 'npn', 'EBC', 120, 0.6, 92],
  ['BC547B', 'npn', 'CBE', 290, 0.1, 92], ['BC548B', 'npn', 'CBE', 290, 0.1, 92], ['BC549C', 'npn', 'CBE', 500, 0.1, 92], ['BC337-40', 'npn', 'CBE', 400, 0.8, 92],
  ['S8050', 'npn', 'EBC', 200, 0.5, 92], ['S9013', 'npn', 'EBC', 150, 0.5, 92],
  ['TIP120', 'npn', 'BCE', 1000, 5, 220, { darl: true }], ['TIP122', 'npn', 'BCE', 1000, 5, 220, { darl: true }], ['TIP31C', 'npn', 'BCE', 50, 3, 220], ['TIP41C', 'npn', 'BCE', 50, 6, 220],
  ['BD139', 'npn', 'ECB', 100, 1.5, 220],
  ['2N2907A', 'pnp', 'EBC', 150, 0.6, 92], ['2N3906', 'pnp', 'EBC', 150, 0.2, 92], ['2N4403', 'pnp', 'EBC', 120, 0.6, 92], ['BC557B', 'pnp', 'CBE', 290, 0.1, 92],
  ['BC558B', 'pnp', 'CBE', 290, 0.1, 92], ['BC327-40', 'pnp', 'CBE', 400, 0.8, 92], ['S8550', 'pnp', 'EBC', 200, 0.5, 92], ['S9012', 'pnp', 'EBC', 150, 0.5, 92],
  ['TIP125', 'pnp', 'BCE', 1000, 5, 220, { darl: true }], ['TIP127', 'pnp', 'BCE', 1000, 5, 220, { darl: true }], ['TIP32C', 'pnp', 'BCE', 50, 3, 220], ['TIP42C', 'pnp', 'BCE', 50, 6, 220],
  ['BD140', 'pnp', 'ECB', 100, 1.5, 220],
]) { const mk = pkg === 92 ? TO92 : TO220; add(mk({ id: 'q-' + pn.toLowerCase(), name: `${pn} ${pol.toUpperCase()} transistor`, sub: `${pkg === 92 ? 'TO-92' : pn.startsWith('BD') ? 'TO-126' : 'TO-220'}, ${ic}A${extra && extra.darl ? ', Darlington' : ''}`, fam: 'Transistors (BJT)',
  order, p: { pol, hfe, ic, darl: !!(extra && extra.darl), order }, specs: [`hFE ≈ ${hfe}`, `Ic max ${ic}A`, `pins (flat/front facing you): ${order.split('').join('-')}`, pol === 'npn' ? 'low-side switch: emitter to GND, base via 1k from GPIO' : 'high-side switch'], tags: `transistor bjt ${pol} ${pn.toLowerCase()}` })); }
for (const [pn, pol, order, vth, rds, vspec, id, pkg, logic] of [
  ['2N7000', 'n', 'SGD', 2.1, 5.3, 4.5, 0.2, 92, true], ['BS170', 'n', 'DGS', 2.1, 5, 4.5, 0.5, 92, true],
  ['IRLZ44N', 'n', 'GDS', 1.5, 0.025, 5, 47, 220, true], ['IRLZ34N', 'n', 'GDS', 1.5, 0.046, 5, 30, 220, true], ['IRL540N', 'n', 'GDS', 1.5, 0.053, 5, 36, 220, true],
  ['IRLB8721', 'n', 'GDS', 1.8, 0.012, 4.5, 62, 220, true], ['FQP30N06L', 'n', 'GDS', 1.8, 0.045, 5, 32, 220, true],
  ['IRF520', 'n', 'GDS', 3.0, 0.27, 10, 9.2, 220, false], ['IRF540N', 'n', 'GDS', 3.0, 0.044, 10, 33, 220, false], ['IRFZ44N', 'n', 'GDS', 3.0, 0.0175, 10, 49, 220, false],
  ['IRF3205', 'n', 'GDS', 3.0, 0.008, 10, 110, 220, false],
  ['IRF9540N', 'p', 'GDS', 3.0, 0.117, 10, 23, 220, false], ['IRF4905', 'p', 'GDS', 3.0, 0.02, 10, 74, 220, false], ['NDP6020P', 'p', 'GDS', 1.0, 0.075, 4.5, 24, 220, true],
]) { const mk = pkg === 92 ? TO92 : TO220; add(mk({ id: 'm-' + pn.toLowerCase(), name: `${pn} ${pol.toUpperCase()}-channel MOSFET`, sub: `${pkg === 92 ? 'TO-92' : 'TO-220'}, ${id}A${logic ? ', logic-level' : ''}`, fam: 'MOSFETs', mos: true,
  order, p: { pol, vth, rds, vspec, id, logic, order }, specs: [`Vgs(th) ≈ ${vth}V`, `Rds(on) ${rds}Ω @ Vgs ${vspec}V`, `Id max ${id}A`, logic ? 'logic-level gate' : 'needs ≈10V gate drive — not fully on from 3.3V', `pins: ${order.split('').join('-')}`], tags: `mosfet fet ${pol}-channel ${pn.toLowerCase()}` })); }

// ---------- Sensors ----------
const S = (o) => add(module({ cat: 'Sensors', ...o }));
const I2C4 = ['VCC', 'GND', 'SCL', 'SDA'];
const hx = (a) => '0x' + a.toString(16).toUpperCase().padStart(2, '0');
// PIR / motion
for (const [id, name, vmin, vmax, outV, hold, sub] of [
  ['pir-hcsr501', 'HC-SR501 PIR motion sensor', 4.5, 20, 3.3, 3, 'adjustable delay & sensitivity'], ['pir-hcsr505', 'HC-SR505 mini PIR sensor', 4.5, 20, 3.3, 8, 'fixed ≈8s hold'],
  ['pir-am312', 'AM312 mini PIR sensor', 2.7, 12, 3.3, 2, '3.3V friendly'], ['pir-hcsr602', 'HC-SR602 micro PIR sensor', 3.3, 15, 3.3, 2, 'tiny lens'],
  ['radar-rcwl0516', 'RCWL-0516 microwave radar motion sensor', 4, 28, 3.3, 2, 'Doppler radar, sees through plastic'],
]) S({ id, name, sub, fam: 'Motion', kind: 'pir', p: { vmin, vmax, outV, hold, iq: 0.00005 }, pins: id.startsWith('radar') ? ['3V3', 'GND', 'OUT', 'VIN', 'CDS'] : ['VCC', 'OUT', 'GND'],
  w: 70, h: 70, color: id.startsWith('radar') ? '#1d4f9c' : '#1d6b33', specs: [`${vmin}–${vmax}V supply`, `OUT HIGH = ${outV}V while motion (hold ≈${hold}s)`, 'safe for GPIO directly'], tags: 'pir motion sensor presence infrared radar' });
// Ultrasonic
for (const [id, name, vmin, vmax, minD, maxD, sub] of [
  ['us-hcsr04', 'HC-SR04 ultrasonic distance sensor', 4.5, 5.5, 2, 400, '5V: ECHO is 5V'], ['us-hcsr04p', 'HC-SR04P ultrasonic sensor (3–5.5V)', 3.0, 5.5, 2, 400, 'ECHO = supply voltage'],
  ['us-rcwl1601', 'RCWL-1601 ultrasonic sensor (3.3V)', 3.0, 5.5, 2, 450, 'pin-compatible with HC-SR04'], ['us-jsnsr04t', 'JSN-SR04T waterproof ultrasonic sensor', 4.5, 5.5, 25, 450, 'min range 25cm'],
  ['us-us100', 'US-100 ultrasonic sensor (trigger mode)', 2.4, 5.5, 2, 450, 'temperature compensated'],
]) S({ id, name, sub, fam: 'Distance', kind: 'ultrasonic', p: { vmin, vmax, minD, maxD, iq: 0.015 }, pins: ['VCC', 'Trig', 'Echo', 'GND'], w: 120, h: 60, color: '#1b4f9c',
  specs: [`${vmin}–${vmax}V`, `range ${minD}–${maxD}cm`, 'Trig: 10µs pulse; Echo pulse width = distance', 'Echo high = VCC: at 5V use a 1k/2k divider into the GPIO'], tags: 'ultrasonic distance sonar hc-sr04 range' });
// IR / optical digital modules
for (const [id, name, act, out, sub, ctl] of [
  ['ir-fc51', 'FC-51 IR obstacle avoidance sensor', 'low', 'vcc', 'LM393, 2–30cm', 'detect'], ['ir-ky032', 'KY-032 obstacle avoidance sensor', 'low', 'vcc', 'with EN pin', 'detect'],
  ['ir-tcrt5000', 'TCRT5000 line tracking module', 'high', 'vcc', 'DO HIGH over black line', 'black'], ['ir-ky033', 'KY-033 line tracking module', 'high', 'vcc', 'DO HIGH over black', 'black'],
  ['ir-e18d80nk', 'E18-D80NK adjustable IR proximity switch', 'low', 'oc', 'NPN open collector, 3–80cm', 'detect'], ['ir-ky010', 'KY-010 photo-interrupter (slot) module', 'high', 'vcc', 'U-slot optical switch', 'block'],
  ['ir-beam3', 'IR break-beam sensor 3mm (receiver)', 'low', 'oc', 'open collector, needs pull-up', 'block'], ['ir-beam5', 'IR break-beam sensor 5mm (receiver)', 'low', 'oc', 'open collector, needs pull-up', 'block'],
]) S({ id, name, sub, fam: 'Proximity & IR', kind: 'digimod', p: { vmin: id === 'ir-e18d80nk' ? 4.5 : 3.3, vmax: id === 'ir-e18d80nk' ? 5.5 : 5.5, iq: id === 'ir-e18d80nk' ? 0.025 : 0.015, out, act, ctl },
  pins: id === 'ir-ky032' ? ['GND', '+', 'OUT', 'EN'] : out === 'oc' ? ['VCC', 'OUT', 'GND'] : ['VCC', 'GND', 'OUT'], color: '#1b4f9c',
  specs: [act === 'low' ? 'output LOW when triggered' : 'output HIGH when triggered', out === 'oc' ? 'open collector: needs a pull-up resistor to 3.3V' : 'output swings to VCC: power from 3.3V for GPIO use'], tags: 'ir infrared obstacle line proximity sensor beam' });
// Light
for (const [id, name, r10, dark, g] of [['ldr-gl5516', 'Photoresistor LDR GL5516', 7.5e3, 0.5e6, 0.5], ['ldr-gl5528', 'Photoresistor LDR GL5528', 15e3, 1e6, 0.6], ['ldr-gl5537', 'Photoresistor LDR GL5537-1', 25e3, 2e6, 0.6], ['ldr-gl5539', 'Photoresistor LDR GL5539', 40e3, 5e6, 0.6], ['ldr-gl5549', 'Photoresistor LDR GL5549', 90e3, 10e6, 0.7]])
  add({ id, name, sub: `${fmtOhm(r10)} @10 lux, dark ${fmtOhm(dark)}`, cat: 'Sensors', fam: 'Light', kind: 'ldr', p: { r10, dark, g }, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 20, y: 0 }],
    specs: [`${fmtOhm(r10)} at 10 lux`, `dark: ${fmtOhm(dark)}`, `γ ≈ ${g}`, 'use in a divider + ADC (MCP3008/ADS1115)'], tags: 'ldr photoresistor light sensor cds' });
S({ id: 'ldr-ky018', name: 'KY-018 photoresistor module', sub: 'LDR + 10k divider', fam: 'Light', kind: 'ldrmod', p: { r10: 15e3, dark: 1e6, g: 0.6 }, pins: ['S', '+', '−'], color: '#222', specs: ['analog: needs an ADC', 'S voltage falls as light rises'], tags: 'ldr photoresistor module ky-018 light' });
S({ id: 'ldr-lm393', name: 'LDR light sensor module (LM393, 4-pin)', sub: 'AO + DO with threshold pot', fam: 'Light', kind: 'anamod', p: { vmin: 3.3, vmax: 5, iq: 0.004, ctl: 'light', inv: true, dark: 'high' }, pins: ['VCC', 'GND', 'DO', 'AO'], color: '#1b4f9c',
  specs: ['DO HIGH when dark (below threshold)', 'AO analog (needs ADC)'], tags: 'ldr light sensor module lm393 photoresistor' });
S({ id: 'light-temt6000', name: 'TEMT6000 ambient light sensor', sub: 'analog phototransistor', fam: 'Light', kind: 'anamod', p: { vmin: 3.3, vmax: 5, iq: 0.0001, ctl: 'lux', temt: true }, pins: ['VCC', 'GND', 'SIG'], color: '#1b4f9c', specs: ['SIG ≈ 5mV per lux (10k load)', 'needs an ADC'], tags: 'light ambient sensor temt6000 lux' });
for (const a of [0x23, 0x5c]) S({ id: `light-bh1750-${a.toString(16)}`, name: `BH1750 light sensor (GY-302)${a === 0x5c ? ', ADDR high' : ''}`, sub: `I2C ${hx(a)}, 1–65535 lux`, fam: 'Light', kind: 'i2c', p: { chip: 'bh1750', addr: a, vmin: 3.0, vmax: 5.5, iq: 0.0002 },
  pins: ['VCC', 'GND', 'SCL', 'SDA', 'ADDR'], color: '#1b4f9c', specs: [`I2C ${hx(a)}`, 'lux reading over I2C'], tags: 'bh1750 light lux sensor i2c gy-302' });
// Temperature & humidity
for (const [id, name, t, bare] of [['dht11-mod', 'DHT11 temperature & humidity module', 11, false], ['dht11', 'DHT11 sensor (bare, 4-pin)', 11, true], ['dht22-mod', 'DHT22 temperature & humidity module', 22, false], ['dht22', 'DHT22 / AM2302 sensor (bare, 4-pin)', 22, true], ['am2302', 'AM2302 wired DHT22', 22, false]])
  add({ id, name, sub: t === 11 ? '0–50°C ±2°C, 20–90% RH' : '−40–80°C ±0.5°C, 0–100% RH', cat: 'Sensors', fam: 'Temperature & humidity', kind: 'dht', p: { t, bare },
    bb: true, pins: bare ? row(['VCC', 'DATA', 'NC', 'GND']) : row(['VCC', 'DATA', 'GND']), body: { x: -10, y: bare ? -80 : -60, w: bare ? 50 : 40, h: bare ? 84 : 64, color: bare ? (t === 11 ? '#3a8ad8' : '#f0f0f0') : '#1b4f9c' },
    specs: ['3.3–5V', bare ? 'needs a 4.7k–10k pull-up on DATA' : 'pull-up resistor on the module', `one reading every ${t === 11 ? 1 : 2}s max`, 'library: adafruit_dht or Adafruit_DHT'], tags: 'dht11 dht22 am2302 temperature humidity sensor' });
for (const [id, name, sub, mod] of [['ds18b20', 'DS18B20 digital temperature sensor (TO-92)', '1-Wire, −55–125°C', false], ['ds18b20-1m', 'DS18B20 waterproof probe, 1m', 'stainless probe', false],
  ['ds18b20-2m', 'DS18B20 waterproof probe, 2m', 'stainless probe', false], ['ds18b20-3m', 'DS18B20 waterproof probe, 3m', 'stainless probe', false], ['ds18b20-ky001', 'KY-001 DS18B20 module', 'with 4.7k pull-up', true]])
  add({ id, name, sub, cat: 'Sensors', fam: 'Temperature & humidity', kind: 'ds18b20', p: { mod, probe: id.includes('m') && !mod }, bb: true,
    pins: mod ? row(['DQ', 'VDD', 'GND']) : row(['GND', 'DQ', 'VDD']), body: mod ? { x: -5, y: -50, w: 40, h: 54, color: '#222' } : undefined,
    specs: ['1-Wire on GPIO4 (enable dtoverlay=w1-gpio)', mod ? 'pull-up on board' : '4.7kΩ pull-up from DQ to 3.3V required', '±0.5°C, 9–12 bit'], tags: 'ds18b20 temperature 1-wire onewire probe waterproof' });
for (const [id, name, sub, model, pins] of [['lm35', 'LM35DZ analog temperature sensor', '10mV/°C, 4–30V', 'lm35', ['+Vs', 'Vout', 'GND']], ['tmp36', 'TMP36 analog temperature sensor', '750mV @25°C, 10mV/°C', 'tmp36', ['+Vs', 'Vout', 'GND']]])
  add({ id, name, sub, cat: 'Sensors', fam: 'Temperature & humidity', kind: 'antemp', p: { model }, bb: true, pins: row(pins), specs: [sub, 'needs an ADC (MCP3008 / ADS1115)'], tags: 'temperature analog lm35 tmp36 sensor' });
for (const [id, name, r25, beta] of [['ntc-10k-3950', 'NTC thermistor 10k (B3950)', 1e4, 3950], ['ntc-100k-3950', 'NTC thermistor 100k (B3950)', 1e5, 3950], ['ntc-10k-3435', 'NTC thermistor 10k MF52 (B3435)', 1e4, 3435]])
  add({ id, name, sub: `${fmtOhm(r25)} @25°C, β=${beta}`, cat: 'Sensors', fam: 'Temperature & humidity', kind: 'ntc', p: { r25, beta }, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 20, y: 0 }],
    specs: [`R25 = ${fmtOhm(r25)}`, `β = ${beta}K`, 'use in a divider + ADC'], tags: 'ntc thermistor temperature' });
S({ id: 'ntc-ky013', name: 'KY-013 analog temperature module', sub: 'NTC 10k + 10k divider', fam: 'Temperature & humidity', kind: 'ntcmod', p: { r25: 1e4, beta: 3950 }, pins: ['S', '+', '−'], color: '#222', specs: ['analog: needs an ADC'], tags: 'temperature ntc module ky-013' });
const I2CTH = [
  ['bme280', 'BME280 temp/humidity/pressure (3.3V GY-BME280)', [0x76, 0x77], 1.7, 3.6, 'Environment'], ['bme280-5v', 'BME280 module with regulator (3.3–5V)', [0x76, 0x77], 3.3, 5.5, 'Environment'],
  ['bmp280', 'BMP280 temperature & pressure sensor', [0x76, 0x77], 1.7, 3.6, 'Environment'], ['bmp180', 'BMP180 pressure sensor (GY-68)', [0x77], 1.8, 3.6, 'Environment'],
  ['sht30', 'SHT30 temperature & humidity sensor', [0x44], 2.4, 5.5, 'Temperature & humidity'], ['sht31', 'SHT31 temperature & humidity sensor', [0x44, 0x45], 2.4, 5.5, 'Temperature & humidity'],
  ['sht35', 'SHT35 temperature & humidity sensor', [0x44], 2.4, 5.5, 'Temperature & humidity'], ['sht40', 'SHT40 temperature & humidity sensor', [0x44], 1.08, 3.6, 'Temperature & humidity'],
  ['sht41', 'SHT41 temperature & humidity sensor', [0x44], 1.08, 3.6, 'Temperature & humidity'], ['sht45', 'SHT45 temperature & humidity sensor', [0x44], 1.08, 3.6, 'Temperature & humidity'],
  ['aht10', 'AHT10 temperature & humidity sensor', [0x38], 1.8, 3.6, 'Temperature & humidity'], ['aht20', 'AHT20 temperature & humidity sensor', [0x38], 2.0, 5.5, 'Temperature & humidity'],
  ['htu21d', 'HTU21D temperature & humidity sensor', [0x40], 1.5, 3.6, 'Temperature & humidity'], ['si7021', 'Si7021 temperature & humidity sensor', [0x40], 1.9, 3.6, 'Temperature & humidity'],
  ['mcp9808', 'MCP9808 precision temperature sensor', [0x18], 2.7, 5.5, 'Temperature & humidity'], ['tmp102', 'TMP102 temperature sensor', [0x48], 1.4, 3.6, 'Temperature & humidity'],
  ['lm75a', 'LM75A temperature sensor', [0x48], 2.8, 5.5, 'Temperature & humidity'], ['mlx90614', 'MLX90614 IR contactless thermometer (GY-906)', [0x5a], 3.0, 5.5, 'Temperature & humidity'],
];
const CHIPOF = { 'bme280-5v': 'bme280', sht30: 'sht3x', sht31: 'sht3x', sht35: 'sht3x', sht40: 'sht4x', sht41: 'sht4x', sht45: 'sht4x', aht10: 'aht', aht20: 'aht', htu21d: 'htu21', si7021: 'htu21', tmp102: 'tmp102', lm75a: 'tmp102' };
for (const [key, name, addrs, vmin, vmax, fam] of I2CTH) for (const a of addrs) S({ id: `${key}-${a.toString(16)}`, name: addrs.length > 1 ? `${name} @ ${hx(a)}` : name, sub: `I2C ${hx(a)}, ${vmin}–${vmax}V`, fam, kind: 'i2c',
  p: { chip: CHIPOF[key] || key, addr: a, vmin, vmax, iq: 0.001 }, pins: I2C4, color: key.startsWith('sht4') || key.startsWith('aht') ? '#222' : '#5b2c8f',
  specs: [`I2C address ${hx(a)}`, `${vmin}–${vmax}V supply${vmax < 4 ? ' (5V will damage it)' : ''}`, 'SDA→GPIO2, SCL→GPIO3'], tags: `${key} i2c temperature humidity pressure sensor` });

// Motion / orientation
for (const [id, name, chip, a, sub] of [['mpu6050-68', 'MPU6050 accelerometer + gyro (GY-521)', 'mpu6050', 0x68, '6-axis IMU'], ['mpu6050-69', 'MPU6050 (GY-521) with AD0 high', 'mpu6050', 0x69, '6-axis IMU'],
  ['mpu6500', 'MPU6500 accelerometer + gyro', 'mpu6500', 0x68, '6-axis IMU'], ['mpu9250', 'MPU9250 9-axis IMU (accel/gyro part)', 'mpu9250', 0x68, 'accel + gyro registers'],
  ['adxl345-53', 'ADXL345 accelerometer (GY-291)', 'adxl345', 0x53, '3-axis ±16g'], ['adxl345-1d', 'ADXL345 accelerometer, SDO high', 'adxl345', 0x1d, '3-axis ±16g'],
  ['hmc5883l', 'HMC5883L magnetometer (GY-271)', 'hmc5883', 0x1e, '3-axis compass'], ['qmc5883l', 'QMC5883L magnetometer (GY-271 clone)', 'qmc5883', 0x0d, '3-axis compass']])
  S({ id, name, sub: `${sub}, I2C ${hx(a)}`, fam: chip.includes('5883') ? 'Magnetometer' : 'Accelerometer & gyro', kind: 'i2c', p: { chip, addr: a, vmin: 3.0, vmax: 5.5, iq: 0.004 },
    pins: chip.startsWith('mpu') ? ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'] : chip === 'adxl345' ? ['GND', 'VCC', 'CS', 'INT1', 'INT2', 'SDO', 'SDA', 'SCL'] : ['VCC', 'GND', 'SCL', 'SDA', 'DRDY'],
    color: '#1b4f9c', specs: [`I2C ${hx(a)}`, '3.3–5V module (onboard regulator)', chip.startsWith('mpu') ? 'library: mpu6050-raspberrypi or smbus2' : 'smbus2 register reads'], tags: `${chip} accelerometer gyro imu tilt compass magnetometer i2c` });
for (const [id, name, sub, ctl, act, out, kind] of [
  ['tilt-ky020', 'KY-020 tilt switch module', 'ball switch + 10k', 'tilt', 'high', 'vcc', 'digimod'], ['tilt-ky017', 'KY-017 mercury tilt module', 'with LED', 'tilt', 'high', 'vcc', 'digimod'],
  ['vib-sw420', 'SW-420 vibration sensor module', 'LM393, adjustable', 'vibrate', 'high', 'vcc', 'digimod'], ['vib-ky002', 'KY-002 vibration / shock module', 'spring switch', 'vibrate', 'low', 'vcc', 'digimod'],
  ['knock-ky031', 'KY-031 knock sensor module', 'spring switch', 'vibrate', 'low', 'vcc', 'digimod'],
  ['hall-ky003', 'KY-003 Hall magnetic sensor module (A3144)', 'digital, LOW near magnet', 'magnet', 'low', 'vcc', 'digimod'],
  ['hall-a3144', 'A3144 Hall effect switch (bare)', 'open collector, needs pull-up', 'magnet', 'low', 'oc', 'digimod'],
  ['hall-us1881', 'US1881 latching Hall sensor (bare)', 'latches on S/N pole', 'magnet', 'low', 'oc', 'digimod'],
  ['reed-ky025', 'KY-025 reed switch module', 'LM393 comparator', 'magnet', 'high', 'vcc', 'digimod'], ['reed-ky021', 'KY-021 mini reed module', '10k pull-up', 'magnet', 'low', 'vcc', 'digimod'],
]) { const bare = out === 'oc' && id.startsWith('hall-');
  if (bare) add({ id, name, sub, cat: 'Sensors', fam: 'Magnetic & tilt', kind, p: { vmin: 3.0, vmax: 24, iq: 0.004, out, act, ctl, latch: id.includes('1881') }, bb: true, pins: row(['VCC', 'GND', 'OUT']),
    specs: ['open collector: add a 10k pull-up to 3.3V', 'OUT LOW near a magnet'], tags: 'hall magnet sensor a3144 us1881' });
  else S({ id, name, sub, fam: 'Magnetic & tilt', kind, p: { vmin: 3.3, vmax: 5.5, iq: 0.004, out, act, ctl }, pins: ['S', '+', '−'], color: '#222',
    specs: [act === 'low' ? 'S LOW when triggered' : 'S HIGH when triggered', 'output swings to + (use 3.3V for GPIO)'], tags: `${ctl} sensor module tilt vibration hall reed magnet knock` }); }
for (const [id, name, sub, bare] of [['hall-ky035', 'KY-035 analog Hall sensor (49E)', 'linear, Vcc/2 at 0 gauss', false], ['hall-ss49e', 'SS49E linear Hall sensor (bare)', '1.4mV/G around Vcc/2', true]])
  add(bare ? { id, name, sub, cat: 'Sensors', fam: 'Magnetic & tilt', kind: 'anamod', p: { vmin: 3.0, vmax: 6.5, iq: 0.006, ctl: 'field', hall: true }, bb: true, pins: row(['VCC', 'GND', 'OUT']), specs: ['analog: needs an ADC'], tags: 'hall linear analog magnet ss49e' }
    : module({ id, name, sub, cat: 'Sensors', fam: 'Magnetic & tilt', kind: 'anamod', p: { vmin: 3.0, vmax: 5.5, iq: 0.006, ctl: 'field', hall: true }, pins: ['S', '+', '−'], color: '#222', specs: ['analog: needs an ADC'], tags: 'hall analog ky-035 magnet' }));
// Gas (MQ series): heater 5V ≈150mA
for (const [n, gas, lo, hi] of [[2, 'LPG / smoke / propane', 300, 10000], [3, 'alcohol (ethanol)', 25, 500], [4, 'methane / CNG', 200, 10000], [5, 'LPG / natural gas', 200, 10000],
  [6, 'LPG / butane', 200, 10000], [7, 'carbon monoxide', 20, 2000], [8, 'hydrogen', 100, 10000], [9, 'CO + flammable gas', 10, 1000], [131, 'ozone (ppb)', 10, 1000],
  [135, 'air quality: NH3, NOx, benzene, CO₂', 10, 1000], [136, 'hydrogen sulfide', 1, 200], [137, 'ammonia', 5, 500], [138, 'VOC: toluene, acetone, alcohol', 5, 500]])
  S({ id: `gas-mq${n}`, name: `MQ-${n} gas sensor module`, sub: gas, fam: 'Gas & air', kind: 'anamod', p: { vmin: 4.5, vmax: 5.5, iq: 0.15, ctl: 'ppm', lo, hi, dout: true },
    pins: ['VCC', 'GND', 'DO', 'AO'], w: 70, h: 70, color: '#1b4f9c', specs: [`${gas}: ${lo}–${hi}${n === 131 ? 'ppb' : 'ppm'}`, '5V heater ≈150mA', 'AO rises with concentration (needs ADC); DO LOW above threshold', 'AO/DO swing to 5V — use a divider'], tags: `mq-${n} mq${n} gas sensor smoke air quality` });
// Liquid / soil / weather
for (const [id, name, sub, ctl, dout, pins] of [
  ['soil-yl69', 'YL-69 soil moisture sensor + LM393 board', 'resistive probe', 'moisture', true, ['VCC', 'GND', 'DO', 'AO']], ['soil-fc28', 'FC-28 soil moisture sensor', 'resistive probe', 'moisture', true, ['VCC', 'GND', 'DO', 'AO']],
  ['soil-cap12', 'Capacitive soil moisture sensor v1.2', 'corrosion resistant, analog', 'moisture', false, ['GND', 'VCC', 'AOUT']], ['soil-cap20', 'Capacitive soil moisture sensor v2.0', 'analog', 'moisture', false, ['GND', 'VCC', 'AOUT']],
  ['rain-fc37', 'FC-37 rain sensor module', 'rain plate + LM393', 'wet', true, ['VCC', 'GND', 'DO', 'AO']], ['rain-yl83', 'YL-83 raindrop sensor module', 'rain plate + LM393', 'wet', true, ['VCC', 'GND', 'DO', 'AO']],
  ['water-level', 'Water level sensor (analog strip)', '0–40mm immersion', 'level', false, ['S', '+', '−']],
  ['flame-ky026', 'KY-026 flame sensor module', 'IR 760–1100nm', 'flame', true, ['AO', 'GND', '+', 'DO']], ['flame-3pin', 'Flame sensor module (3-pin, DO)', 'IR phototransistor', 'flame', true, ['VCC', 'GND', 'DO']],
  ['flame-4pin', 'Flame sensor module (4-pin, AO+DO)', 'IR phototransistor', 'flame', true, ['VCC', 'GND', 'DO', 'AO']],
  ['snd-ky037', 'KY-037 sound sensor (big mic)', 'AO + DO', 'sound', true, ['AO', 'GND', '+', 'DO']], ['snd-ky038', 'KY-038 sound sensor (small mic)', 'AO + DO', 'sound', true, ['AO', 'GND', '+', 'DO']],
  ['snd-lm393', 'LM393 sound detection module (3-pin)', 'DO only', 'sound', true, ['VCC', 'GND', 'OUT']], ['snd-max4466', 'MAX4466 electret microphone amplifier', 'analog, Vcc/2 bias', 'sound', false, ['OUT', 'GND', 'VCC']],
  ['snd-max9814', 'MAX9814 microphone amplifier with AGC', 'analog, AGC', 'sound', false, ['GND', 'VDD', 'GAIN', 'OUT', 'AR']],
]) S({ id, name, sub, fam: ctl === 'sound' ? 'Sound' : ctl === 'flame' ? 'Flame & fire' : 'Liquid & soil', kind: 'anamod',
  p: { vmin: 3.3, vmax: 5.5, iq: 0.005, ctl, dout, onlyDo: pins.length === 3 && pins.includes('DO') || id === 'snd-lm393' },
  pins, color: id.startsWith('soil-cap') ? '#222' : '#1b4f9c', w: id === 'water-level' ? 60 : 0, h: id === 'water-level' ? 110 : 50,
  specs: [dout ? 'DO: LOW when triggered (threshold pot)' : 'analog output only', 'AO needs an ADC (MCP3008 / ADS1115)'], tags: `${ctl} sensor module ${id}` });
for (const [id, name, ppl] of [['flow-yfs201', 'YF-S201 water flow sensor', 7.5], ['flow-yfs401', 'YF-S401 water flow sensor', 98]])
  add({ id, name, sub: `Hall pulse output, F = ${ppl}×Q (L/min)`, cat: 'Sensors', fam: 'Liquid & soil', kind: 'flow', p: { ppl }, bb: false, pins: row(['VCC', 'GND', 'OUT']),
    specs: ['5–18V supply', `pulse frequency = ${ppl} × flow (L/min)`, 'open-collector style output: use a pull-up to 3.3V'], tags: 'water flow sensor hall pulse yf-s201' });
// Force / weight
add(module({ id: 'hx711', name: 'HX711 24-bit load cell amplifier', sub: 'bit-banged DOUT / PD_SCK', cat: 'Sensors', fam: 'Force & weight', kind: 'hx711', p: {},
  pins: ['GND', 'DT', 'SCK', 'VCC', 'E+', 'E−', 'A−', 'A+', 'B−', 'B+'], w: 110, h: 60, color: '#1d6b33', specs: ['2.6–5.5V', 'channel A gain 128', 'library: hx711 (Python)'], tags: 'hx711 load cell scale weight amplifier' }));
for (const kg of [1, 5, 10, 20]) add({ id: `loadcell-${kg}kg`, name: `Load cell ${kg}kg (bar, full bridge)`, sub: '1.0 mV/V', cat: 'Sensors', fam: 'Force & weight', kind: 'loadcell', p: { kg }, bb: false,
  pins: row(['E+', 'E−', 'A−', 'A+']), specs: [`${kg}kg capacity`, 'red E+, black E−, white A−, green A+'], tags: 'load cell weight scale strain gauge' });
for (const [id, name, sub] of [['fsr402', 'FSR402 force sensing resistor', '0.5" round'], ['fsr406', 'FSR406 force sensing resistor', '1.5" square']])
  add({ id, name, sub, cat: 'Sensors', fam: 'Force & weight', kind: 'fsr', p: {}, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 10, y: 0 }], specs: ['>10MΩ untouched, ≈250Ω at 10kg', 'use with a 10k pull-down + ADC'], tags: 'fsr force pressure sensor' });
add({ id: 'flex-22', name: 'Flex sensor 2.2"', sub: '25k flat → 100k bent', cat: 'Sensors', fam: 'Force & weight', kind: 'flex', p: {}, bb: true, pins: [{ n: '1', x: 0, y: 0 }, { n: '2', x: 10, y: 0 }], specs: ['≈25kΩ flat', '≈100kΩ at 180°'], tags: 'flex bend sensor' });
// Electrical measurement
for (const a of [0x40, 0x41]) S({ id: `ina219-${a.toString(16)}`, name: `INA219 current/voltage sensor${a === 0x41 ? ' (A0 bridged)' : ''}`, sub: `I2C ${hx(a)}, 0.1Ω shunt, ±3.2A`, fam: 'Electrical', kind: 'i2c',
  p: { chip: 'ina219', addr: a, vmin: 3.0, vmax: 5.5, iq: 0.001, shunt: 0.1 }, pins: ['VCC', 'GND', 'SCL', 'SDA', 'VIN+', 'VIN−'], color: '#5b2c8f',
  specs: [`I2C ${hx(a)}`, 'put it in series with the load: supply → VIN+ → VIN− → load', 'bus voltage up to 26V'], tags: 'ina219 current voltage power sensor i2c' });
for (const [a, sens] of [[5, 0.185], [20, 0.1], [30, 0.066]]) S({ id: `acs712-${a}a`, name: `ACS712 ${a}A current sensor module`, sub: `${sens * 1000}mV/A, Vcc/2 at 0A`, fam: 'Electrical', kind: 'acs712', p: { amps: a, sens },
  pins: ['VCC', 'OUT', 'GND', 'IP+', 'IP−'], color: '#b5202e', specs: ['5V supply', `${sens * 1000}mV per amp around 2.5V`, 'OUT is analog (needs ADC)'], tags: 'acs712 current sensor hall' });
S({ id: 'vsense-25', name: 'Voltage sensor module 0–25V', sub: '30k / 7.5k divider (÷5)', fam: 'Electrical', kind: 'vdiv', p: { r1: 30000, r2: 7500 }, pins: ['S', '+', '−', 'VCC', 'GND'], color: '#b5202e', specs: ['S = VCC/5 (needs ADC)', 'max 25V input'], tags: 'voltage sensor divider' });
// ADCs
add({ id: 'adc-mcp3008', name: 'MCP3008 8-channel 10-bit ADC', sub: 'SPI, DIP-16', cat: 'Drivers & ICs', fam: 'ADC & I/O', kind: 'mcpadc', p: { ch: 8, bits: 10 }, bb: true,
  pins: [...row(['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7'], 30), ...['VDD', 'VREF', 'AGND', 'CLK', 'DOUT', 'DIN', 'CS', 'DGND'].map((n, i) => ({ n, x: 70 - i * 10, y: 0 }))],
  specs: ['VDD & VREF to 3.3V', 'CLK→GPIO11, DOUT→GPIO9 (MISO), DIN→GPIO10 (MOSI), CS→GPIO8', 'library: gpiozero MCP3008 or spidev'], tags: 'mcp3008 adc analog spi converter' });
add({ id: 'adc-mcp3004', name: 'MCP3004 4-channel 10-bit ADC', sub: 'SPI, DIP-14', cat: 'Drivers & ICs', fam: 'ADC & I/O', kind: 'mcpadc', p: { ch: 4, bits: 10 }, bb: true,
  pins: [...row(['CH0', 'CH1', 'CH2', 'CH3', 'NC', 'NC2', 'DGND'], 30), ...['VDD', 'VREF', 'AGND', 'CLK', 'DOUT', 'DIN', 'CS'].map((n, i) => ({ n, x: 60 - i * 10, y: 0 }))],
  specs: ['SPI like MCP3008'], tags: 'mcp3004 adc analog spi' });
add({ id: 'adc-mcp3208', name: 'MCP3208 8-channel 12-bit ADC', sub: 'SPI, DIP-16', cat: 'Drivers & ICs', fam: 'ADC & I/O', kind: 'mcpadc', p: { ch: 8, bits: 12 }, bb: true,
  pins: [...row(['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7'], 30), ...['VDD', 'VREF', 'AGND', 'CLK', 'DOUT', 'DIN', 'CS', 'DGND'].map((n, i) => ({ n, x: 70 - i * 10, y: 0 }))],
  specs: ['12-bit, gpiozero MCP3208'], tags: 'mcp3208 adc analog spi 12-bit' });
for (const [chip, a, name] of [['ads1115', 0x48, 'ADS1115 16-bit ADC module'], ['ads1115', 0x49, 'ADS1115 16-bit ADC (ADDR→VDD)'], ['ads1015', 0x48, 'ADS1015 12-bit ADC module']])
  S({ id: `adc-${chip}-${a.toString(16)}`, name, sub: `4 channels, I2C ${hx(a)}`, cat: 'Drivers & ICs', fam: 'ADC & I/O', kind: 'i2c', p: { chip, addr: a, vmin: 2.0, vmax: 5.5, iq: 0.0002 },
    pins: ['VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'ALRT', 'A0', 'A1', 'A2', 'A3'], color: '#5b2c8f', specs: [`I2C ${hx(a)}`, 'programmable gain ±6.144V…±0.256V', 'inputs must stay within GND–VDD'], tags: `${chip} adc analog i2c` });
S({ id: 'adc-pcf8591', name: 'PCF8591 8-bit ADC/DAC (YL-40 style)', sub: '4 in / 1 out, I2C 0x48', cat: 'Drivers & ICs', fam: 'ADC & I/O', kind: 'i2c', p: { chip: 'pcf8591', addr: 0x48, vmin: 2.5, vmax: 6, iq: 0.001 },
  pins: ['VCC', 'GND', 'SCL', 'SDA', 'AIN0', 'AIN1', 'AIN2', 'AIN3', 'AOUT'], color: '#1b4f9c', specs: ['I2C 0x48', '8-bit, Vref = VCC'], tags: 'pcf8591 adc dac i2c' });
add(module({ id: 'ls-bss138', name: 'Logic level shifter 4-ch (BSS138)', sub: 'bidirectional 3.3V ↔ 5V', cat: 'Drivers & ICs', fam: 'Level shifters', kind: 'shifter', p: { n: 4 },
  pins: ['LV1', 'LV2', 'LV', 'GND', 'LV3', 'LV4', 'HV1', 'HV2', 'HV', 'GND2', 'HV3', 'HV4'], w: 130, h: 50, color: '#b5202e', specs: ['LV = 3.3V, HV = 5V, common GND', '10k pull-ups both sides'], tags: 'level shifter converter bss138 5v 3.3v' }));
add(module({ id: 'ls-txs0108e', name: 'Logic level shifter 8-ch (TXS0108E)', sub: 'bidirectional, auto-direction', cat: 'Drivers & ICs', fam: 'Level shifters', kind: 'shifter', p: { n: 8, txs: true },
  pins: ['VA', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'OE', 'GND', 'VB', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], w: 210, h: 50, color: '#1b4f9c', specs: ['VA 1.2–3.6V, VB 1.65–5.5V', 'OE HIGH to enable'], tags: 'level shifter txs0108e' }));
add({ id: 'ic-74hc595', name: '74HC595 8-bit shift register', sub: 'serial in, parallel out, DIP-16', cat: 'Drivers & ICs', fam: 'Logic ICs', kind: 'sr595', p: {}, bb: true,
  pins: [...row(['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND'], 30), ...['VCC', 'QA', 'SER', 'OE', 'RCLK', 'SRCLK', 'SRCLR', 'QH\''].map((n, i) => ({ n, x: 70 - i * 10, y: 0 }))],
  specs: ['SER = data, SRCLK = shift clock, RCLK = latch', 'OE LOW and SRCLR HIGH to run', '2–6V, ±6mA/output at 5V'], tags: '74hc595 shift register ic' });
for (const [chip, name] of [['ds3231', 'DS3231 precision RTC module (ZS-042)'], ['ds1307', 'DS1307 RTC module (Tiny RTC)']]) S({ id: `rtc-${chip}`, name, sub: 'I2C 0x68, battery backed', cat: 'Drivers & ICs', fam: 'Real-time clocks', kind: 'i2c', p: { chip, addr: 0x68, vmin: chip === 'ds1307' ? 4.5 : 2.3, vmax: 5.5, iq: 0.0002 },
  pins: ['GND', 'VCC', 'SDA', 'SCL'], color: '#1b4f9c', specs: ['I2C 0x68 (clashes with MPU6050!)', chip === 'ds1307' ? '5V part' : '±2ppm TCXO'], tags: `${chip} rtc clock time i2c` });
S({ id: 'pca9685', name: 'PCA9685 16-channel PWM / servo driver', sub: 'I2C 0x40, 12-bit', cat: 'Drivers & ICs', fam: 'Motor drivers', kind: 'i2c', p: { chip: 'pca9685', addr: 0x40, vmin: 2.3, vmax: 5.5, iq: 0.01 },
  pins: ['GND', 'OE', 'SCL', 'SDA', 'VCC', 'V+', ...Array.from({ length: 16 }, (_, i) => `PWM${i}`)], w: 230, h: 80, color: '#1b4f9c', specs: ['I2C 0x40', 'V+ = servo power (5–6V)', 'library: adafruit_servokit'], tags: 'pca9685 servo driver pwm i2c' });
S({ id: 'mpr121', name: 'MPR121 12-key capacitive touch controller', sub: 'I2C 0x5A', cat: 'Sensors', fam: 'Touch', kind: 'i2c', p: { chip: 'mpr121', addr: 0x5a, vmin: 1.7, vmax: 3.6, iq: 0.0003 },
  pins: ['3V3', 'IRQ', 'SCL', 'SDA', 'ADDR', 'GND'], color: '#1b4f9c', specs: ['I2C 0x5A', '3.3V only', 'register 0x00–0x01 = touch bits'], tags: 'mpr121 touch capacitive keypad i2c' });
// GPS / RFID
for (const [id, name] of [['gps-neo6m', 'u-blox NEO-6M GPS module (GY-NEO6MV2)'], ['gps-neo7m', 'u-blox NEO-7M GPS module'], ['gps-neom8n', 'u-blox NEO-M8N GPS module'], ['gps-atgm336h', 'ATGM336H GPS/BeiDou module']])
  S({ id, name, sub: 'UART 9600 baud, NMEA', fam: 'GPS & RFID', kind: 'gps', p: {}, pins: ['VCC', 'RX', 'TX', 'GND'], w: 90, h: 90, color: '#1b4f9c',
    specs: ['3.3–5V', 'TX → GPIO15 (RXD), RX → GPIO14 (TXD)', 'enable the serial port, read /dev/serial0 with pyserial'], tags: 'gps neo-6m location gnss uart nmea' });
S({ id: 'rfid-rc522', name: 'RC522 RFID reader 13.56MHz (MFRC522)', sub: 'SPI, MIFARE cards & tags', fam: 'GPS & RFID', kind: 'rc522', p: {},
  pins: ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3.3V'], w: 120, h: 120, color: '#1b4f9c', specs: ['3.3V only', 'SDA→GPIO8 (CE0), SCK→11, MOSI→10, MISO→9, RST→25', 'library: mfrc522 (SimpleMFRC522)'], tags: 'rfid rc522 mfrc522 nfc card reader' });
S({ id: 'rfid-rdm6300', name: 'RDM6300 125kHz RFID reader', sub: 'UART 9600, EM4100 cards', fam: 'GPS & RFID', kind: 'rdm6300', p: {}, pins: ['TX', 'RX', 'NC', 'GND', '+5V'], w: 110, h: 60, color: '#1b4f9c',
  specs: ['5V supply; TX is 5V logic — divide it down before GPIO15', 'outputs 14-byte ASCII frames at 9600 baud'], tags: 'rfid rdm6300 125khz uart' });

// ---------- Power ----------
for (const [id, name, v, rint, imax, sub] of [
  ['pwr-9v', '9V battery (PP3) with clip', 9, 1.7, 0.5, 'alkaline ≈ 500mAh'], ['pwr-4aa', '4× AA battery holder (6V)', 6, 0.6, 2, 'alkaline'], ['pwr-2aa', '2× AA battery holder (3V)', 3, 0.3, 2, 'alkaline'],
  ['pwr-18650', '18650 Li-ion cell 3.7V', 3.7, 0.06, 5, 'with holder'], ['pwr-2x18650', '2× 18650 pack 7.4V', 7.4, 0.12, 5, 'series holder'],
  ['pwr-12v2a', '12V 2A DC adapter', 12, 0.1, 2, 'barrel jack'], ['pwr-5v2a', '5V 2A DC adapter', 5, 0.05, 2, 'barrel jack'], ['pwr-24v', '24V 3A power supply', 24, 0.05, 3, 'bench / LED PSU'],
]) add({ id, name, sub, cat: 'Power', fam: 'Batteries & supplies', kind: 'battery', p: { v, rint, imax }, bb: false, pins: row(['+', '−']),
  specs: [`${v}V`, `max ≈${imax}A`, 'join its − to Pi GND when signals are shared'], tags: 'battery power supply adapter ' + v + 'v' });
add(module({ id: 'pwr-mb102', name: 'MB102 breadboard power supply', sub: '5V / 3.3V rails, AMS1117', cat: 'Power', fam: 'Regulators', kind: 'mb102', p: { imax: 0.7 },
  pins: ['5V', '3V3', 'GND', 'VIN', 'GNDIN'], w: 90, h: 60, color: '#b5202e', specs: ['6.5–12V in on VIN', '5V and 3.3V outputs, ≈700mA'], tags: 'mb102 breadboard power supply regulator' }));
for (const [id, name, vout, drop, imax, pins] of [['reg-ams1117', 'AMS1117-3.3 regulator module', 3.3, 1.1, 0.8, ['VIN', 'GND', 'VOUT']], ['reg-7805', 'LM7805 5V linear regulator', 5, 2.0, 1.5, ['IN', 'GND', 'OUT']],
  ['reg-lm2596', 'LM2596 buck converter module (set 5V)', 5, 1.5, 3, ['IN+', 'IN−', 'OUT+', 'OUT−']], ['reg-mt3608', 'MT3608 boost converter (set 9V)', 9, -99, 1, ['VIN+', 'VIN−', 'VOUT+', 'VOUT−']]])
  add(module({ id, name, sub: `${vout}V out, ${imax}A`, cat: 'Power', fam: 'Regulators', kind: 'regulator', p: { vout, drop, imax, boost: drop < 0 },
    pins, w: id === 'reg-7805' ? 40 : 70, h: 50, color: id === 'reg-7805' ? '#333' : '#1b4f9c', specs: [drop > 0 ? `needs ≥ ${+(vout + drop).toFixed(1)}V in` : 'steps up from 2–24V', `${imax}A max`], tags: 'regulator power buck boost converter' }));

// ---------- Breadboards ----------
add({ id: 'bb-full', name: 'Breadboard, full size (830 points)', sub: '63 columns + 4 rails', cat: 'Breadboards', fam: 'Breadboards', kind: 'breadboard', p: { cols: 63, rails: true }, pins: [], specs: ['rows a–e and f–j joined per column', 'rails run the full length'], tags: 'breadboard protoboard 830' });
add({ id: 'bb-half', name: 'Breadboard, half size (400 points)', sub: '30 columns + 4 rails', cat: 'Breadboards', fam: 'Breadboards', kind: 'breadboard', p: { cols: 30, rails: true }, pins: [], specs: ['rows a–e and f–j joined per column'], tags: 'breadboard half 400' });
add({ id: 'bb-mini', name: 'Breadboard, mini (170 points)', sub: '17 columns, no rails', cat: 'Breadboards', fam: 'Breadboards', kind: 'breadboard', p: { cols: 17, rails: false }, pins: [], specs: ['rows a–e and f–j joined per column'], tags: 'breadboard mini 170' });

export const PARTS = P;
export const PART_BY_ID = Object.fromEntries(P.map(p => [p.id, p]));
export const CATEGORIES = [...new Set(P.map(p => p.cat))];
export const EMULATION = {
  resistor: 'Electrical: current, voltage drop & power rating checks', capacitor: 'Electrical: open at DC; polarity & voltage-rating checks', diode: 'Electrical: forward drop, Zener breakdown, current limit',
  led: 'Electrical: brightness from real current (PWM aware), over-current check', rgbled: 'Electrical: three LEDs, PWM colour mixing', seg7: 'Electrical: each segment is an LED (multiplexing works)',
  tm1637: 'Python: tm1637 library + raw bit-banged protocol', max7219: 'Python: spidev register writes (decode, intensity, scan-limit, shutdown)',
  lcd: 'Python: RPLCD / smbus2 — real HD44780 4-bit protocol', oled: 'Python: adafruit_ssd1306 / smbus2 — real SSD1306/SH1106 command set', ws2812: 'Python: neopixel / rpi_ws281x',
  buzzer: 'Sound via your speaker: active = DC, passive = PWM frequency', servo: 'Pulse width from PWM (RPi.GPIO, gpiozero, PCA9685) → angle', motor: 'Speed & direction from average voltage',
  stepper: 'Steps from coil sequence / STEP pulses', hbridge: 'Logic → outputs, PWM speed, voltage drop', uln2003: 'Darlington sinks + phase LEDs', stepdir: 'STEP/DIR/EN, microstepping',
  mosmodule: 'Gate threshold model', relaymod: 'Opto + coil current, contact switching, click sound', relay: 'Coil pull-in voltage, contacts', load: 'Resistive / inductive load',
  button: 'Press with mouse or finger', switch: 'Click to toggle', dip: 'Click a switch to toggle', keypad: 'Matrix of switches — real row/column scanning', pot: 'Turn the knob: real resistance divider',
  encoder: 'Quadrature A/B edges + push switch', joystick: 'Two potentiometers + switch', digimod: 'Digital output with module logic level', anamod: 'Analog output (+ comparator DO)',
  pir: 'Motion → OUT with hold time', ultrasonic: 'Real Trig/Echo timing (RPi.GPIO timing code works) + gpiozero DistanceSensor', dht: 'Python: adafruit_dht / Adafruit_DHT', ds18b20: 'Python: /sys/bus/w1 files + w1thermsensor',
  antemp: 'Analog voltage from temperature', ntc: 'Resistance from temperature (β model)', ntcmod: 'Divider output from temperature', ldr: 'Resistance from light level', ldrmod: 'Divider output from light',
  i2c: 'Python: smbus2 register-level emulation', mcpadc: 'Python: spidev + gpiozero MCP3xxx, reads real node voltages', hx711: 'Bit-banged DOUT/PD_SCK protocol + hx711 library', loadcell: 'Bridge output from weight',
  fsr: 'Resistance from force', flex: 'Resistance from bend', flow: 'Pulse train at the real K-factor', acs712: 'Analog output from measured current', vdiv: 'Resistor divider',
  shifter: 'Logic translation between rails', sr595: 'Shift + latch logic, outputs drive real loads', gps: 'Python: pyserial NMEA sentences', rc522: 'Python: mfrc522 SimpleMFRC522', rdm6300: 'Python: pyserial frames',
  battery: 'Voltage source with internal resistance', regulator: 'Regulated output with dropout', mb102: 'Two regulated rails', breadboard: 'Connected strips & rails', pi: 'Raspberry Pi header',
  bjt: 'Electrical: β-limited collector current, saturation', mosfet: 'Electrical: Vgs threshold → Rds(on)',
};
