// Main-thread side of the Python runtime: owns the worker, answers its synchronous requests
// against the simulator, mirrors pin levels into shared memory and handles Run/Stop/input().
import { BOARDS } from './pi.js';
const enc = new TextEncoder();
export class PyBridge {
  constructor(sim, ui) {
    this.sim = sim; this.ui = ui; this.worker = null; this.state = 'idle'; this.ready = null; this.pendingInput = false;
    this.shared = typeof SharedArrayBuffer !== 'undefined';
    const SAB = this.shared ? SharedArrayBuffer : ArrayBuffer; // without isolation the circuit still works; Python needs the shared kind
    this.ctl = new Int32Array(new SAB(64)); this.dataBuf = new SAB(1 << 20); this.data = new Uint8Array(this.dataBuf);
    this.pinBuf = new SAB(28 * 5 * 8); this.pins = new Float64Array(this.pinBuf); this.intr = new Int32Array(new SAB(4));
    for (let b = 0; b < 28; b++) { this.pins[b * 5] = 0; this.pins[b * 5 + 1] = 1e300; this.pins[b * 5 + 3] = 1e300; }
    sim.onLevels = (lv, sched) => this.mirror(lv, sched);
    sim.onSchedule = () => this.mirror(this.sim.levels, this.sim.sched || {});
    sim.onEvent = () => this.flagEvents();
    if (sim.levels) this.mirror(sim.levels, sim.sched || {});
  }
  mirror(lv, sched) {
    const P = this.pins;
    for (let b = 0; b < 28; b++) { const o = b * 5, s = sched[b]; P[o] = lv[b];
      if (s) { P[o + 1] = s.t1; P[o + 2] = s.l1; P[o + 3] = s.t2; P[o + 4] = s.l2; } else { P[o + 1] = 1e300; P[o + 3] = 1e300; } }
  }
  flagEvents() {
    const now = this.sim.now(); const due = this.sim.events.some(e => e.t <= now);
    if (due) { Atomics.store(this.ctl, 4, 1); Atomics.add(this.ctl, 3, 1); if (this.shared) Atomics.notify(this.ctl, 3); }
    else if (this.sim.events.length) { clearTimeout(this.evTimer); const nx = Math.min(...this.sim.events.map(e => e.t)); this.evTimer = setTimeout(() => this.flagEvents(), Math.max(0, (nx - now) * 1000)); }
  }
  load() {
    if (this.ready) return this.ready;
    this.ui.status('loading', 'Loading Python (first run only, ≈12 MB)…');
    const base = new URL('.', document.baseURI).href; // works at / and under a sub-path such as /pi-lab/
    // A blob worker inherits this page's cross-origin isolation, so no special headers are needed on the worker file.
    const boot = new Blob([`self.PILAB_BASE = ${JSON.stringify(base)}; importScripts(${JSON.stringify(base + 'js/py-worker.js')});`], { type: 'text/javascript' });
    this.worker = new Worker(URL.createObjectURL(boot));
    this.ready = new Promise((res, rej) => { this._res = res; this._rej = rej; });
    this.worker.onmessage = (e) => this.onMsg(e.data);
    this.worker.onerror = (e) => { this.ui.err('Python worker failed: ' + (e.message || 'unknown error') + '\n'); this._rej && this._rej(e); };
    this.worker.postMessage({ t: 'init', ctlBuf: this.ctl.buffer, dataBuf: this.dataBuf, pinBuf: this.pinBuf, intrBuf: this.intr.buffer });
    return this.ready;
  }
  onMsg(m) {
    switch (m.t) {
      case 'ready': this.ui.status('idle', 'Python ' + m.version + ' ready'); this._res(); break;
      case 'fatal': this.ui.err('Python could not start: ' + m.s + '\n'); this.ui.status('error', 'Python failed to load'); this._rej(new Error(m.s)); this.ready = null; break;
      case 'out': this.ui.out(m.s); break;
      case 'err': this.ui.err(m.s); break;
      case 'rpc': this.handle(m.req); break;
      case 'end': this.finish(m.status); break;
    }
  }
  reply(obj) {
    const b = enc.encode(JSON.stringify(obj));
    if (b.length > this.data.length) { this.reply({ oserror: 75, msg: 'reply too large' }); return; }
    this.data.set(b); Atomics.store(this.ctl, 1, b.length); Atomics.store(this.ctl, 0, 2); Atomics.notify(this.ctl, 0);
  }
  async run(code, boardId) {
    if (this.state === 'running') return;
    this.state = 'starting'; this.ui.runState('starting');
    try { await this.load(); } catch (e) { this.state = 'idle'; this.ui.runState('idle'); return; }
    this.sim.events = []; this.sim.watch = {}; this.sim.prevLvl = {}; Atomics.store(this.ctl, 2, 0); Atomics.store(this.ctl, 4, 0); Atomics.store(this.ctl, 0, 0); this.intr[0] = 0;
    this.state = 'running'; this.ui.runState('running'); this.ui.status('running', 'Running main.py');
    const b = BOARDS[boardId];
    this.worker.postMessage({ t: 'run', code, board: JSON.stringify({ id: boardId, name: b.name, cpu: b.soc, rev: b.rev || '', ram: b.ram || '' }) });
  }
  stop() {
    if (this.state !== 'running') return;
    this.state = 'stopping'; this.ui.status('stopping', 'Stopping…');
    Atomics.store(this.ctl, 2, 1); this.intr[0] = 2; Atomics.add(this.ctl, 3, 1); Atomics.notify(this.ctl, 3); Atomics.notify(this.ctl, 0);
    if (this.pendingInput) { this.pendingInput = false; this.ui.endInput(); this.reply({ stop: true }); }
    clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => { if (this.state === 'stopping') { this.worker.terminate(); this.worker = null; this.ready = null; this.ui.err('Python did not stop within 3 s, so it was restarted.\n'); this.finish('stopped'); } }, 3000);
  }
  finish(status) {
    clearTimeout(this.killTimer);
    const sim = this.sim; // a process ending stops its software PWM and edge watches; plain outputs keep their level (as on a real Pi)
    for (let b = 0; b < 28; b++) if (sim.gpio[b].pwm) { sim.gpio[b].pwm = null; sim.gpio[b].level = 0; }
    sim.watch = {}; sim.events = []; this.pendingInput = false; this.ui.endInput();
    sim.update('end');
    this.state = 'idle'; this.ui.runState('idle');
    const msg = { done: 'Program finished', stopped: 'Stopped', error: 'Program ended with an error' }[status] || 'Program ended';
    this.ui.status(status === 'error' ? 'error' : 'idle', msg); this.ui.sys('— ' + msg + ' —');
  }
  submitInput(line) { if (!this.pendingInput) return; this.pendingInput = false; this.ui.out(line + '\n'); this.reply({ line: line + '\n' }); }
  handle(r) {
    const sim = this.sim;
    try {
      switch (r.op) {
        case 'setup': sim.setup(r.bcm, r.mode, r.pull); if (r.mode === 'out' && r.initial !== null && r.initial !== undefined) sim.write(r.bcm, r.initial); else if (r.mode === 'out' && sim.gpio[r.bcm].mode === 'out') { } sim.update('setup'); return this.reply({});
        case 'state': { const g = sim.gpio[r.bcm]; return this.reply({ mode: g.user ? g.mode : 'in' }); }
        case 'write': sim.write(r.bcm, r.v); sim.update('write'); return this.reply({});
        case 'wseq': for (const [b, v] of r.ops) { sim.write(b, v); sim.update('wseq'); } return this.reply({});
        case 'pwm': if (!r.freq) { sim.pwm(r.bcm, null); sim.write(r.bcm, r.duty >= 1 ? 1 : 0); } else sim.pwm(r.bcm, r.freq, r.duty); sim.update('pwm'); return this.reply({});
        case 'watch': if (r.edge) { sim.watch[r.bcm] = r.edge; sim.prevLvl[r.bcm] = sim.levels[r.bcm] === 2 ? 0 : sim.levels[r.bcm]; } else { delete sim.watch[r.bcm]; sim.events = sim.events.filter(e => e.bcm !== r.bcm); } return this.reply({});
        case 'events': { const ev = sim.takeEvents(); Atomics.store(this.ctl, 4, 0); this.flagEvents(); const base = (performance.timeOrigin + sim.t0) / 1000; return this.reply({ ev: ev.map(e => [e.bcm, e.level, base + e.t]) }); }
        case 'cleanup': for (const b of r.bcms) { sim.pwm(b, null); sim.setup(b, 'in', undefined); sim.gpio[b].pull = 'off'; sim.gpio[b].user = false; delete sim.watch[b]; } sim.update('cleanup'); return this.reply({});
        case 'i2c': { const res = sim.i2cXfer(r.addr, r.msgs); if (res.err) return this.reply({ err: res.err }); return this.reply({ data: res.data }); }
        case 'i2cscan': return this.reply({ list: sim.i2cScan() });
        case 'spi': return this.reply({ data: sim.spiXfer(r.dev, r.data) });
        case 'dht': return this.reply(sim.dhtRead(r.bcm));
        case 'w1': return this.reply({ list: sim.w1List() });
        case 'ws': return this.reply({ n: sim.wsShow(r.bcm, r.px) });
        case 'uart_read': return this.reply({ s: sim.uartRead() });
        case 'uart_write': sim.uartWrite(r.s); this.ui.uartTx && this.ui.uartTx(r.s); return this.reply({});
        case 'rfid': return this.reply(sim.rfid());
        case 'rfid_write': sim.rfidWrite(r.card, r.text); return this.reply({});
        case 'cputemp': return this.reply({ t: 44 + Math.round(Math.random() * 30) / 10 });
        case 'input': this.pendingInput = true; this.ui.askInput(); return; // replied when the user presses Enter
        case 'end': return this.reply({});
        default: return this.reply({ oserror: 38, msg: 'Function not implemented: ' + r.op });
      }
    } catch (e) { console.error(e); this.ui.err('[simulator] ' + e.message + '\n'); return this.reply({ oserror: 5, msg: 'I/O error' }); }
  }
}
