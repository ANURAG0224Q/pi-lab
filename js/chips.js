// HD44780 character LCD controller and SSD1306/SH1106 OLED controller emulation.
const FONT_B64 = 'AAAAAAA+W09bPj5rT2s+HD58PhwYPH48GBxXfVccHF5/XhwAGDwYAP/nw+f/ABgkGAD/59vn/zBIOgYOJil5KSZAfwUFB0B/BSU/WjznPFp/PhwcCAgcHD5/FCJ/IhRfXwBfXwYJfwF/AGaJlWpgYGBgYJSi/6KUCAR+BAgQIH4gEAgIKhwICBwqCAgeEBAQEAweDB4MMDg+ODAGDj4OBgAAAAAAAABfAAAABwAHABR/FH8UJCp/KhIjEwhkYjZJViBQAAgHAwAAHCJBAABBIhwAKhx/HCoICD4ICACAcDAACAgICAgAAGBgACAQCAQCPlFJRT4AQn9AAHJJSUlGIUFJTTMYFBJ/ECdFRUU5PEpJSTFBIREJBzZJSUk2RklJKR4AABQAAABANAAAAAgUIkEUFBQUFABBIhQIAgFZCQY+QV1ZTnwSERJ8f0lJSTY+QUFBIn9BQUE+f0lJSUF/CQkJAT5BQVFzfwgICH8AQX9BACBAQT8BfwgUIkF/QEBAQH8CHAJ/fwQIEH8+QUFBPn8JCQkGPkFRIV5/CRkpRiZJSUkyAwF/AQM/QEBAPx8gQCAfP0A4QD9jFAgUYwMEeAQDYVlJTUMAf0FBQQIECBAgAEFBQX8EAgECBEBAQEBAAAMHCAAgVFR4QH8oREQ4OERERCg4REQofzhUVFQYAAh+CQIYpKSceH8IBAR4AER9QAAgQEA9AH8QKEQAAEF/QAB8BHgEeHwIBAR4OERERDj8GCQkGBgkJBj8fAgEBAhIVFRUJAQEP0QkPEBAIHwcIEAgHDxAMEA8RCgQKERMkJCQfERkVExEAAg2QQAAAHcAAABBNggAAgECBAI8JiMmPB6hoWESOkBAIHo4VFRVWSFVVXlBIlRUeEIhVVR4QCBUVXlADB5SchI5VVVVWTlUVFRZOVVUVFgAAEV8QQACRX1CAAFFfEB9EhESffAoJSjwfFRVRQAgVFR8VHwKCX9JMklJSTI6REREOjJKSEgwOkFBIXo6QkAgeACdoKB9PUJCQj09QEBAPTwk/yQkSH5JQ2YrL/wvK/8JKfYgwIh+CQMgVFR5QQAARH1BMEhISjI4QEAiegB6CgpyfQ0ZMX0mKSkvKCYpKSkmMEhNQCA4CAgICAgICAg4LxDIrLovECg0+gAAewAACBQqFCIiFCoUCFUAVQBVqlWqVar/Vf9V/wAAAP8AEBAQ/wAUFBT/ABAQ/wD/EBDwEPAUFBT8ABQU9wD/AAD/AP8UFPQE/BQUFxAfEBAfEB8UFBQfABAQEPAAAAAAHxAQEBAfEBAQEPAQAAAA/xAQEBAQEBAQEP8QAAAA/xQAAP8A/wAAHxAXAAD8BPQUFBcQFxQU9AT0AAD/APcUFBQUFBQU9wD3FBQUFxQQEB8QHxQUFPQUEBDwEPAAAB8QHwAAAB8UAAAA/BQAAPAQ8BAQ/xD/FBQU/xQQEBAfAAAAAPAQ///////w8PDw8P///wAAAAAA//8PDw8PDzhERDhE/EpKSjR+AgIGBgJ+An4CY1VJQWM4REQ8BEB+IB4gBgJ+AgKZpeelmRwqSSocTHIBckwwSk1NMDBIeEgwvGJaRj0+SUlJAH4BAQF+KioqKipERF9EREBRSkRAQERKUUAAAP8BA+CA/wAACAhrawg2EjYkNgYPCQ8GAAAYGAAAABAQADBA/wEBAB8BAR4AGR0XEgA8PDw8AAAAAAA=';
export const FONT = Uint8Array.from(atob(FONT_B64), ch => ch.charCodeAt(0)); // 256 glyphs × 5 columns, LSB = top row
export class HD44780 {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; this.reset(); }
  reset() { this.dd = new Uint8Array(128).fill(32); this.cg = new Uint8Array(64); this.ac = 0; this.cgMode = false; this.cgAddr = 0; this.mode8 = true; this.half = null;
    this.disp = false; this.cursor = false; this.blink = false; this.inc = true; this.shiftOn = false; this.shift = 0; this.lines = 1; this.bl = true; this.ver = 0; }
  strobe(rs, hi, lo) { // one E falling edge: hi = D7..D4 nibble, lo = D3..D0
    if (this.mode8) { this.exec(rs, (hi << 4) | (lo || 0)); return; }
    if (this.half === null) { this.half = hi; return; }
    const b = (this.half << 4) | hi; this.half = null; this.exec(rs, b);
  }
  wrapAc() { if (this.lines === 2) { if (this.ac === 0x28) this.ac = 0x40; else if (this.ac >= 0x68) this.ac = 0; else if (this.ac === 0x3F) this.ac = 0x27; else if (this.ac < 0) this.ac = 0x67; } else { this.ac = (this.ac + 80) % 80; } }
  exec(rs, b) {
    this.ver++;
    if (rs) {
      if (this.cgMode) { this.cg[this.cgAddr & 63] = b & 0x1F; this.cgAddr = (this.cgAddr + 1) & 63; return; }
      this.dd[this.ac & 0x7F] = b; this.ac += this.inc ? 1 : -1; this.wrapAc();
      if (this.shiftOn) this.shift += this.inc ? 1 : -1; return;
    }
    if (b & 0x80) { this.cgMode = false; this.ac = b & 0x7F; }
    else if (b & 0x40) { this.cgMode = true; this.cgAddr = b & 0x3F; }
    else if (b & 0x20) { this.mode8 = !!(b & 0x10); this.lines = b & 0x08 ? 2 : 1; this.half = null; }
    else if (b & 0x10) { if (b & 0x08) this.shift += b & 0x04 ? -1 : 1; else { this.ac += b & 0x04 ? 1 : -1; this.wrapAc(); } }
    else if (b & 0x08) { this.disp = !!(b & 4); this.cursor = !!(b & 2); this.blink = !!(b & 1); }
    else if (b & 0x04) { this.inc = !!(b & 2); this.shiftOn = !!(b & 1); }
    else if (b & 0x02) { this.ac = 0; this.shift = 0; this.cgMode = false; }
    else if (b & 0x01) { this.dd.fill(32); this.ac = 0; this.shift = 0; this.inc = true; this.cgMode = false; }
  }
  rowBase(r) { return [0x00, 0x40, this.cols === 20 ? 0x14 : 0x10, this.cols === 20 ? 0x54 : 0x50][r]; }
  charAt(r, c) { // returns char code shown at row r, column c
    if (this.lines === 1 && r > 0 && this.rows <= 2) return 32;
    const base = r % 2 === 0 ? 0 : 0x40; const extra = r >= 2 ? this.cols : 0;
    const off = ((c + extra + this.shift) % 40 + 40) % 40;
    return this.dd[base + off];
  }
  glyph(code) { // 8 rows of 5-bit patterns
    if (code < 16) { const i = (code & 7) * 8; return Array.from(this.cg.slice(i, i + 8)); }
    let g = code;
    if (code === 0xDF) g = 0xF8; // degree sign
    else if (code === 0x7E) g = 0x1A; else if (code === 0x7F) g = 0x1B; // arrows
    else if (code >= 0x80) g = 0x3F;
    const rows = [];
    for (let y = 0; y < 8; y++) { let bits = 0; for (let x = 0; x < 5; x++) if ((FONT[g * 5 + x] >> y) & 1) bits |= 1 << (4 - x); rows.push(bits); }
    return rows;
  }
}
// PCF8574 I2C backpack bit map: P0=RS P1=RW P2=E P3=backlight P4..P7=D4..D7
export function pcf8574Write(lcd, st, b) {
  const prevE = st.port & 0x04; st.port = b; lcd.bl = !!(b & 0x08);
  if (prevE && !(b & 0x04)) lcd.strobe(b & 1, (b >> 4) & 0x0F, 0);
}
const ARGS = { 0x20: 1, 0x21: 2, 0x22: 2, 0x81: 1, 0xA8: 1, 0xD3: 1, 0xD5: 1, 0xD9: 1, 0xDA: 1, 0xDB: 1, 0x8D: 1, 0x26: 6, 0x27: 6, 0x29: 5, 0x2A: 5, 0xA3: 2, 0xAD: 1, 0xD8: 1 };
export class SSD1306 {
  constructor(w, h, ctrl) { this.W = w; this.H = h; this.sh = ctrl === 'sh1106'; this.cols = this.sh ? 132 : 128; this.ram = new Uint8Array(this.cols * 8); this.reset(); }
  reset() { this.on = false; this.pump = this.sh; this.contrast = 0x7F; this.invert = false; this.allOn = false; this.mode = 2; this.col = 0; this.page = 0;
    this.c0 = 0; this.c1 = 127; this.p0 = 0; this.p1 = 7; this.remap = false; this.comDec = false; this.startLine = 0; this.pend = null; this.ver = 0; }
  write(bytes) {
    let i = 0;
    while (i < bytes.length) {
      const ctl = bytes[i++]; const co = ctl & 0x80, dc = ctl & 0x40;
      if (co) { if (i < bytes.length) this.byte(dc, bytes[i++]); continue; }
      for (; i < bytes.length; i++) this.byte(dc, bytes[i]);
    }
    this.ver++;
  }
  byte(dc, b) { if (dc) this.data(b); else this.cmd(b); }
  cmd(b) {
    if (this.pend) { this.pend.args.push(b); if (this.pend.args.length >= this.pend.need) { this.applyArgs(this.pend.op, this.pend.args); this.pend = null; } return; }
    let need = ARGS[b]; if (this.sh && (b === 0x20 || b === 0x21 || b === 0x22 || b === 0x8D)) need = 0;
    if (!this.sh && b === 0xAD) need = 0;
    if (need) { this.pend = { op: b, need, args: [] }; return; }
    if (b === 0xAE) this.on = false; else if (b === 0xAF) this.on = true;
    else if (b === 0xA6) this.invert = false; else if (b === 0xA7) this.invert = true;
    else if (b === 0xA4) this.allOn = false; else if (b === 0xA5) this.allOn = true;
    else if (b === 0xA0) this.remap = false; else if (b === 0xA1) this.remap = true;
    else if (b === 0xC0) this.comDec = false; else if (b === 0xC8) this.comDec = true;
    else if (b >= 0x40 && b <= 0x7F) this.startLine = b & 0x3F;
    else if (b >= 0xB0 && b <= 0xB7) this.page = b & 7;
    else if (b <= 0x0F) this.col = (this.col & 0xF0) | b;
    else if (b >= 0x10 && b <= 0x1F) this.col = ((b & 0x0F) << 4) | (this.col & 0x0F);
  }
  applyArgs(op, a) {
    if (op === 0x20) this.mode = a[0] & 3;
    else if (op === 0x21) { this.c0 = a[0] & 127; this.c1 = a[1] & 127; this.col = this.c0; }
    else if (op === 0x22) { this.p0 = a[0] & 7; this.p1 = a[1] & 7; this.page = this.p0; }
    else if (op === 0x81) this.contrast = a[0];
    else if (op === 0x8D) this.pump = !!(a[0] & 0x04);
    else if (op === 0xAD) this.pump = !!(a[0] & 0x01);
  }
  data(b) {
    if (this.col < this.cols && this.page < 8) this.ram[this.page * this.cols + this.col] = b;
    if (this.mode === 0) { this.col++; if (this.col > this.c1) { this.col = this.c0; this.page++; if (this.page > this.p1) this.page = this.p0; } }
    else if (this.mode === 1) { this.page++; if (this.page > this.p1) { this.page = this.p0; this.col++; if (this.col > this.c1) this.col = this.c0; } }
    else { this.col++; if (this.col >= this.cols) this.col = this.cols - 1; }
  }
  visible() { return this.on && this.pump; }
  pixel(x, y) { // display coordinate -> lit?
    if (this.allOn) return !this.invert;
    let col = this.remap ? x : this.W - 1 - x; if (this.sh) col += 2;
    let row = this.comDec ? y : this.H - 1 - y; row = (row + this.startLine) % 64;
    if (this.H === 32 && !this.comDec) row = 31 - y;
    const v = (this.ram[(row >> 3) * this.cols + col] >> (row & 7)) & 1;
    return this.invert ? !v : !!v;
  }
}
export function crc8(data, poly = 0x31, init = 0xFF) { let c = init; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ poly) & 0xFF : (c << 1) & 0xFF; } return c; }
