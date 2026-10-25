// WebAudio output: buzzer tones (active ≈2.3 kHz, passive = the PWM frequency driving it) and relay clicks.
import { partOf } from './geom.js';
export class AudioOut {
  constructor() { this.ctx = null; this.voices = new Map(); this.relay = new Map(); this.muted = false; }
  unlock() {
    if (!this.ctx) { try { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.12; this.master.connect(this.ctx.destination); } catch (e) { this.ctx = null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  click(vol = 0.3) {
    if (!this.ctx || this.ctx.state !== 'running') return; const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 0.012); const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = this.ctx.createBufferSource(); s.buffer = buf; const g = this.ctx.createGain(); g.gain.value = vol * 3; s.connect(g); g.connect(this.master); s.start(t);
  }
  voice(id) {
    let v = this.voices.get(id); if (v) return v;
    const o = this.ctx.createOscillator(); o.type = 'square'; const g = this.ctx.createGain(); g.gain.value = 0; o.connect(g); g.connect(this.master); o.start();
    v = { o, g, on: false }; this.voices.set(id, v); return v;
  }
  update(project, sim) {
    const seen = new Set();
    for (const c of project.comps) {
      const part = partOf(c); if (!part) continue;
      if (part.kind === 'relay' || part.kind === 'relaymod') {
        const on = JSON.stringify(c.st && c.st.on); const prev = this.relay.get(c.id);
        if (prev !== undefined && prev !== on) this.click(0.5); this.relay.set(c.id, on); continue;
      }
      if (part.kind !== 'buzzer' || !this.ctx || this.ctx.state !== 'running') continue;
      seen.add(c.id);
      const p = part.p, base = (c.mbase && c.mbase.drive) || 0, avg = (c.m && c.m.drive) || 0; const src = c.mdep && c.mdep.drive && c.mdep.drive[0];
      let f = 0, vol = 0;
      if (p.active) { if (src && src.freq < 30) { const ph = (sim.now() * src.freq) % 1; vol = ph < src.duty && base > 0.05 ? 1 : 0; } else vol = src ? Math.min(1, avg / Math.max(0.05, base) * (base > 0.05 ? 1 : 0)) : base > 0.05 ? 1 : 0; f = 2300; }
      else if (src && base > 0.02 && src.freq >= 20 && src.freq <= 20000) { f = src.freq; vol = Math.min(1, 0.4 + base) * (1 - Math.abs(0.5 - src.duty)); }
      const v = this.voice(c.id); const t = this.ctx.currentTime;
      if (vol > 0.01 && f) { v.o.frequency.setTargetAtTime(f, t, 0.003); v.g.gain.setTargetAtTime(this.muted ? 0 : vol * 0.5, t, 0.004); v.on = true; }
      else if (v.on) { v.g.gain.setTargetAtTime(0, t, 0.004); v.on = false; }
    }
    for (const [id, v] of this.voices) if (!seen.has(id)) { try { v.o.stop(); } catch (e) { } this.voices.delete(id); }
  }
}
