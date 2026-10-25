// Small DC circuit solver (modified nodal analysis with Norton sources) used by the simulator.
// Node 0 is the Raspberry Pi ground. Nonlinear parts (diodes, LEDs, transistors, MOSFETs, coils)
// are piecewise-linear and iterated until their operating states stop changing.
export const GMIN = 1e-10;
export class Circuit {
  constructor() { this.idx = new Map(); this.n = 0; this.G = null; this.b = null; this.v = null; }
  node(net) { // net id (string|number) -> matrix index (1-based); ground = 0
    if (net === 'GND') return 0;
    let i = this.idx.get(net);
    if (i === undefined) { i = ++this.n; this.idx.set(net, i); }
    return i;
  }
  begin() {
    const n = this.n;
    if (!this.G || this.G.length !== n * n) { this.G = new Float64Array(n * n); this.b = new Float64Array(n); }
    else { this.G.fill(0); this.b.fill(0); }
    for (let i = 0; i < n; i++) this.G[i * n + i] = GMIN;
  }
  g(a, b, g) { // conductance between nodes a,b
    if (this.track && g > 1e-8) this.track.push(a, b);
    const n = this.n, G = this.G;
    if (a) G[(a - 1) * n + a - 1] += g;
    if (b) G[(b - 1) * n + b - 1] += g;
    if (a && b) { G[(a - 1) * n + b - 1] -= g; G[(b - 1) * n + a - 1] -= g; }
  }
  r(a, b, r) { this.g(a, b, 1 / Math.max(r, 1e-6)); }
  i(a, b, i) { // current source pushing i amps from node a, through the source, into node b
    if (a) this.b[a - 1] -= i;
    if (b) this.b[b - 1] += i;
  }
  vs(p, m, v, rint) { // voltage source v (p relative to m) with internal resistance rint (Norton form)
    const g = 1 / Math.max(rint, 1e-6);
    this.g(p, m, g); this.i(m, p, v * g);
  }
  vccs(op, om, cp, cm, gm, i0 = 0) { // current gm*(V(cp)-V(cm)) - i0 flowing from op to om (through the element)
    const n = this.n, G = this.G;
    if (this.track) this.track.push(op, om);
    const add = (r, c, val) => { if (r && c) G[(r - 1) * n + c - 1] += val; };
    add(op, cp, gm); add(op, cm, -gm); add(om, cp, -gm); add(om, cm, gm);
    if (op) this.b[op - 1] += i0;
    if (om) this.b[om - 1] -= i0;
  }
  solve() {
    const n = this.n;
    if (n === 0) { this.v = new Float64Array(1); return true; }
    const A = this.G.slice(), x = this.b.slice();
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) { const a = Math.abs(A[i * n + k]); if (a > mx) { mx = a; p = i; } }
      if (mx < 1e-30) continue;
      if (p !== k) { for (let j = k; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; } const t = x[k]; x[k] = x[p]; x[p] = t; }
      const piv = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / piv;
        if (f === 0) continue;
        for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        x[i] -= f * x[k];
      }
    }
    const v = new Float64Array(n + 1);
    for (let k = n - 1; k >= 0; k--) {
      let s = x[k];
      for (let j = k + 1; j < n; j++) s -= A[k * n + j] * v[j + 1];
      const d = A[k * n + k];
      v[k + 1] = Math.abs(d) < 1e-30 ? 0 : s / d;
    }
    for (let i = 0; i <= n; i++) if (!isFinite(v[i])) v[i] = 0;
    this.v = v;
    return true;
  }
  V(node) { return node > 0 && this.v ? this.v[node] : 0; }
}
