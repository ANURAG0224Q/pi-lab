// Python runtime worker: Pyodide + shim modules that talk to the simulator synchronously
// through SharedArrayBuffer + Atomics (so time.sleep, loops and input() behave like on a real Pi).
let pyodide = null, ctl, data, pins, intr;
const enc = new TextEncoder(), dec = new TextDecoder();
const absNow = () => performance.timeOrigin + performance.now();
function rpc(obj) {
  if (Atomics.exchange(intr, 0, 0)) return { stop: true };
  Atomics.store(ctl, 0, 1);
  postMessage({ t: 'rpc', req: obj });
  while (Atomics.load(ctl, 0) === 1) {
    Atomics.wait(ctl, 0, 1, 100);
    if (Atomics.load(intr, 0) && Atomics.load(ctl, 0) === 1) { Atomics.store(intr, 0, 0); Atomics.store(ctl, 0, 0); return { stop: true }; }
  }
  const len = Atomics.load(ctl, 1); const buf = new Uint8Array(len); buf.set(data.subarray(0, len));
  Atomics.store(ctl, 0, 0);
  return JSON.parse(dec.decode(buf));
}
function pinRead(b) {
  const o = b * 5, now = absNow(); let l = pins[o];
  if (now >= pins[o + 3]) l = pins[o + 4]; else if (now >= pins[o + 1]) l = pins[o + 2];
  if (l === 2) return Math.random() < 0.5 ? 1 : 0;
  return l;
}
function sleepUntil(tEnd, wantEvents) { // ms epoch; returns 0 done, 1 events waiting, 2 stop
  for (;;) {
    if (Atomics.exchange(intr, 0, 0)) return 2;
    if (wantEvents && Atomics.load(ctl, 4) > 0) return 1;
    const rem = tEnd - absNow(); if (rem <= 0) return 0;
    if (rem < 1.5) { while (absNow() < tEnd) { /* spin for sub-ms precision */ } return 0; }
    const w = Atomics.load(ctl, 3);
    Atomics.wait(ctl, 3, w, Math.min(rem - 1, 50));
  }
}
const api = {
  rpc: (s) => JSON.stringify(rpc(JSON.parse(s))),
  pin: (b) => pinRead(b),
  now: () => absNow() / 1000,
  sleep_until: (t, ev) => sleepUntil(t * 1000, !!ev),
  stopped: () => !!Atomics.load(intr, 0),
  pending: () => Atomics.load(ctl, 4),
  clear_stop: () => { Atomics.store(ctl, 2, 0); Atomics.store(intr, 0, 0); },
};
async function init(msg) {
ctl = new Int32Array(msg.ctlBuf); data = new Uint8Array(msg.dataBuf); pins = new Float64Array(msg.pinBuf); intr = new Int32Array(msg.intrBuf);
  const B = self.PILAB_BASE || '/';
  importScripts(B + 'pyodide/pyodide.js');
  pyodide = await loadPyodide({ indexURL: B + 'pyodide/' });
  const td = new TextDecoder();
  pyodide.setStdout({ write: (b) => { postMessage({ t: 'out', s: td.decode(b, { stream: true }) }); return b.length; }, isatty: true });
  pyodide.setStderr({ write: (b) => { postMessage({ t: 'err', s: td.decode(b, { stream: true }) }); return b.length; }, isatty: true });
  pyodide.setInterruptBuffer(intr);
  pyodide.registerJsModule('_pilab', api);
  pyodide.setStdin({ stdin: () => { const r = rpc({ op: 'input' }); if (r.stop) return null; return r.line; }, isatty: false });
  importScripts(B + 'js/pyshims.js');
  const FS = pyodide.FS; const root = '/home/pyodide/pilab';
  for (const [path, src] of Object.entries(self.PY_FILES)) {
    const full = root + '/' + path; const dir = full.slice(0, full.lastIndexOf('/'));
    FS.mkdirTree(dir); FS.writeFile(full, src);
  }
  for (const [name, b64] of Object.entries(self.PY_BIN)) FS.writeFile('/home/pyodide/' + name, Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  pyodide.runPython(`import sys; sys.path.insert(0, '${root}'); import _pilab_rt`);
  postMessage({ t: 'ready', version: pyodide.version });
}
async function run(msg) {
  Atomics.store(ctl, 2, 0); Atomics.store(ctl, 4, 0); intr[0] = 0;
  let status = 'done';
  try {
    pyodide.globals.set('__user_code__', msg.code);
    pyodide.globals.set('__board__', msg.board);
    await pyodide.runPythonAsync('import _pilab_rt\n_pilab_rt.run_user(__user_code__, __board__)');
  } catch (e) { status = 'error'; postMessage({ t: 'err', s: String(e.message || e) + '\n' }); }
  try { const st = pyodide.runPython('_pilab_rt.LAST_STATUS'); if (st) status = st; } catch (e) { }
  postMessage({ t: 'end', status });
}
onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') init(m).catch((err) => postMessage({ t: 'fatal', s: String(err && err.message || err) }));
  else if (m.t === 'run') run(m);
};
