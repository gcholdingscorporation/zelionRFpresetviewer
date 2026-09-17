# Rotorflight Blackbox Analyser - double-click to run.
import os, re, sys, math, threading, traceback, subprocess, importlib
import tkinter as tk
from tkinter import filedialog, ttk, messagebox, scrolledtext

REQUIRED = [("numpy", "numpy"), ("orangebox", "orangebox")]


def _missing():
    out = []
    for mod, pkg in REQUIRED:
        try:
            importlib.import_module(mod)
        except ImportError:
            out.append(pkg)
    return out


def _pip(pkg, log, user=False):
    cmd = [sys.executable, "-m", "pip", "install"] + (["--user"] if user else []) + [pkg]
    log("\n>>> " + " ".join(cmd) + "\n")
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as e:
        log("could not run pip: %s\n" % e)
        return False
    if p.stdout:
        log(p.stdout)
    if p.stderr:
        log(p.stderr)
    return True


def _install(pkgs, log):
    """One package per pip call. orangebox emits a packaging error that aborts
    anything queued behind it in the same command - that is how numpy went
    missing in the first place."""
    ok = True
    for pkg in pkgs:
        _pip(pkg, log)
        importlib.invalidate_caches()
        try:
            importlib.import_module(pkg)
            log("%s: OK\n" % pkg)
            continue
        except ImportError:
            pass
        log("%s still missing - retrying into your user folder\n" % pkg)
        _pip(pkg, log, user=True)
        importlib.invalidate_caches()
        try:
            importlib.import_module(pkg)
            log("%s: OK\n" % pkg)
        except ImportError:
            log("%s: STILL MISSING\n" % pkg)
            ok = False
    return ok


def _setup_gate():
    miss = _missing()
    if not miss:
        return
    root = tk.Tk()
    root.title("Rotorflight Blackbox Analyser - setup")
    root.geometry("780x460")
    ttk.Label(root, wraplength=740, justify="left", padding=10, text=(
        "Missing: " + ", ".join(miss) + "\n\n"
        "Python being used by this launcher:\n" + sys.executable + "\n\n"
        "If you already installed these, they went into a different Python "
        "installation than the one above. Installing them here puts them in the "
        "right place.")).pack(fill="x")
    box = scrolledtext.ScrolledText(root, height=15, font=("Consolas", 9))
    box.pack(fill="both", expand=True, padx=10)
    bar = ttk.Frame(root, padding=8)
    bar.pack(fill="x")
    st = {"restart": False}

    def log(s):
        box.insert("end", s)
        box.see("end")
        root.update_idletasks()

    def go():
        btn.config(state="disabled")
        qb.config(state="disabled")
        if _install(miss, log):
            log("\nAll set. Restarting the app...\n")
            st["restart"] = True
            root.after(1200, root.destroy)
        else:
            log("\nStill not right. Copy this text and send it to Claude.\n")
            qb.config(state="normal")

    btn = ttk.Button(bar, text="Install them now", command=go)
    btn.pack(side="left")
    qb = ttk.Button(bar, text="Quit", command=root.destroy)
    qb.pack(side="left", padx=6)
    ttk.Button(bar, text="Copy this log",
               command=lambda: (root.clipboard_clear(),
                                root.clipboard_append(box.get("1.0", "end")))
               ).pack(side="left")
    root.mainloop()
    if st["restart"]:
        try:
            subprocess.Popen([sys.executable] + sys.argv)
        except Exception:
            pass
    sys.exit(0)


_setup_gate()

import numpy as np
from orangebox import Parser

AXES = (("ROLL", 0), ("PITCH", 1), ("YAW", 2))


# ---------- signal helpers ----------
def spectrum(sig, fs):
    sig = np.asarray(sig, float)
    sig = sig - sig.mean()
    if len(sig) < 256:
        return None, None
    sp = np.abs(np.fft.rfft(sig * np.hanning(len(sig)))) ** 2
    fr = np.fft.rfftfreq(len(sig), 1.0 / fs)
    k = fr >= 1.0
    return fr[k], sp[k]


def top_peaks(sig, fs, n=6):
    fr, sp = spectrum(sig, fs)
    if fr is None or sp.sum() <= 0:
        return []
    tot = sp.sum(); out = []; w = sp.copy()
    for _ in range(n):
        i = int(w.argmax())
        if w[i] <= 0:
            break
        out.append((float(fr[i]), 100.0 * sp[i] / tot))
        w[max(0, i - 4): i + 5] = 0
    return out


def band_pct(sig, fs, lo, hi):
    fr, sp = spectrum(sig, fs)
    if fr is None or sp.sum() <= 0:
        return 0.0
    return 100.0 * sp[(fr >= lo) & (fr < hi)].sum() / sp.sum()


def lag_corr(a, b, fs, maxms=100):
    a = np.asarray(a, float); b = np.asarray(b, float)
    a = a - a.mean(); b = b - b.mean()
    if a.std() < 1e-9 or b.std() < 1e-9:
        return None
    best, bl = -2.0, 0
    for l in range(int(fs * maxms / 1000) + 1):
        c = np.corrcoef(a, b)[0, 1] if l == 0 else np.corrcoef(a[:-l], b[l:])[0, 1]
        if not math.isnan(c) and c > best:
            best, bl = c, l
    return bl * 1000.0 / fs, best


def harmonic_tag(hz, f1, ftail=None):
    if f1:
        for k in range(1, 9):
            if abs(hz - k * f1) < max(1.5, 0.04 * k * f1):
                return f"  <== {k}/rev MAIN ROTOR (mechanical)"
    if ftail:
        for k in range(1, 5):
            if abs(hz - k * ftail) < max(2.0, 0.04 * k * ftail):
                return f"  <== {k}/rev TAIL ROTOR (mechanical)"
    return ""


# ---------- analysis ----------
class Log:
    def __init__(self, path, idx):
        p = Parser.load(path, log_index=idx)
        self.headers = p.headers
        self.names = list(p.field_names)
        self.rows = [f.data for f in p.frames()]
        self.n = len(self.rows)
        self.idx = idx

    def col(self, *pats):
        for pat in pats:
            rx = re.compile(pat, re.I)
            for i, nm in enumerate(self.names):
                if rx.search(nm):
                    return np.asarray([r[i] for r in self.rows], float)
        return None


def analyse(path, idx, emit):
    L = Log(path, idx)
    if L.n < 500:
        emit(f"  flight {idx}: only {L.n} frames - skipped\n")
        return None

    t = L.col(r"^time")
    dur = (t[-1] - t[0]) / 1e6 if t is not None else L.n / 1000.0
    fs = (L.n - 1) / dur if dur > 0 else 1000.0

    emit("=" * 72 + "\n")
    emit(f"FLIGHT {idx}   {dur:.0f}s   {L.n} frames   {fs:.0f} Hz logged   "
         f"(can see up to {fs/2:.0f} Hz)\n")
    emit(f"  firmware   {L.headers.get('Firmware revision','?')}\n")
    emit(f"  craft      {L.headers.get('Craft name', L.headers.get('name','?'))}\n")
    emit(f"  debug mode {L.headers.get('debug_mode','?')}   axis {L.headers.get('debug_axis','?')}\n")
    if fs < 900:
        emit(f"  !! logging rate {fs:.0f} Hz is low. Above {fs/2:.0f} Hz is invisible.\n")

    # ---- airborne mask ----
    hs = None
    for pat in (r"headspeed", r"^rpm", r"rpm\[0\]"):
        c = L.col(pat)
        if c is not None and np.nanmax(c) > 300:
            hs = c; break
    mask = np.ones(L.n, bool)
    if hs is not None:
        ref = np.median(hs[hs > 300]) if (hs > 300).any() else 0
        if ref > 0:
            mask = hs > 0.6 * ref
    air = mask.sum()
    emit(f"  airborne   {air} of {L.n} frames ({100*air/L.n:.0f}%) - "
         f"stats below use AIRBORNE ONLY\n")
    if air < 500:
        emit("  !! too little airborne data; falling back to whole log\n")
        mask = np.ones(L.n, bool); air = L.n

    def m(a):
        return None if a is None else a[mask]

    f1 = ftail = None
    if hs is not None:
        h = m(hs)
        f1 = h.mean() / 60.0
        emit(f"\n  GOVERNOR / HEADSPEED\n")
        emit(f"    mean {h.mean():7.0f} rpm   sd {h.std():5.1f} ({100*h.std()/h.mean():.2f}%)"
             f"   min {h.min():.0f}   max {h.max():.0f}\n")
        emit(f"    worst droop below mean: {100*(h.mean()-h.min())/h.mean():.1f}%\n")
        emit(f"    1/rev {f1:.1f} Hz   2/rev {2*f1:.1f} Hz   3/rev {3*f1:.1f} Hz\n")
        for hz, pc in top_peaks(h, fs, 3):
            emit(f"    headspeed oscillation {hz:6.2f} Hz  {pc:4.1f}%\n")
        tr = L.col(r"tail.*rpm", r"rpm\[1\]")
        if tr is not None and np.nanmax(tr) > 300:
            ftail = m(tr).mean() / 60.0
            emit(f"    tail 1/rev {ftail:.1f} Hz\n")

    # ---- per axis ----
    findings = []
    dterm = {}
    for nm, ax in AXES:
        g = m(L.col(rf"gyroADC\[{ax}\]", rf"^gyro\[{ax}\]"))
        s = m(L.col(rf"setpoint\[{ax}\]"))
        if g is None:
            continue
        emit(f"\n  {nm}\n")
        emit(f"    gyro          rms {g.std():8.1f}   peak {np.abs(g).max():8.0f}\n")
        if s is not None and s.std() > 1e-6:
            e = s - g
            emit(f"    setpoint      rms {s.std():8.1f}   peak {np.abs(s).max():8.0f}\n")
            emit(f"    tracking err  rms {e.std():8.1f}   = {100*e.std()/s.std():.0f}% of setpoint\n")
            lc = lag_corr(s, g, fs)
            if lc:
                emit(f"    response lag  {lc[0]:6.1f} ms   correlation {lc[1]:.3f}\n")
        emit(f"    spectrum:\n")
        for hz, pc in top_peaks(g, fs, 6):
            tg = harmonic_tag(hz, f1, ftail)
            if tg:
                findings.append(f"{nm}: {hz:.1f}Hz mechanical peak ({pc:.1f}%)")
            emit(f"        {hz:7.2f} Hz  {pc:5.1f}%{tg}\n")
        emit(f"    energy   1-8Hz {band_pct(g,fs,1,8):5.1f}%"
             f"   8-30Hz {band_pct(g,fs,8,30):5.1f}%"
             f"   30-60Hz {band_pct(g,fs,30,60):5.1f}%"
             f"   60Hz+ {band_pct(g,fs,60,fs/2):5.1f}%\n")
        for lbl, pat in (("P", rf"axisP\[{ax}\]"), ("I", rf"axisI\[{ax}\]"),
                         ("D", rf"axisD\[{ax}\]"), ("F", rf"axisF\[{ax}\]"),
                         ("B", rf"axisB\[{ax}\]"), ("O", rf"axisO\[{ax}\]")):
            a = m(L.col(pat))
            if a is not None:
                emit(f"    {lbl}-term       rms {a.std():8.1f}   peak {np.abs(a).max():8.0f}\n")
                if lbl == "D":
                    dterm[nm] = a.std()

    if "ROLL" in dterm and "PITCH" in dterm:
        r, p = dterm["ROLL"], dterm["PITCH"]
        hi, lo = max(r, p), max(min(r, p), 1e-9)
        if hi / lo > 4:
            which = "ROLL" if r < p else "PITCH"
            findings.append(f"{which} D-term is {hi/lo:.0f}x smaller than the other cyclic axis")

    # ---- raw vs filtered (debug channels) ----
    dbg = [m(L.col(rf"debug\[{i}\]")) for i in range(4)]
    if any(d is not None for d in dbg):
        emit(f"\n  DEBUG CHANNELS (debug_mode={L.headers.get('debug_mode','?')})\n")
        emit("    NOTE: under GYRO_SCALED these carry PRE-FILTER gyro. Channel->axis\n")
        emit("    mapping is not documented here, so treat labels as indicative.\n")
        for i, d in enumerate(dbg):
            if d is None or d.std() < 1e-6:
                continue
            emit(f"    debug[{i}]  rms {d.std():8.1f}  peak {np.abs(d).max():8.0f}"
                 f"   30-60Hz {band_pct(d,fs,30,60):4.1f}%  60Hz+ {band_pct(d,fs,60,fs/2):4.1f}%\n")
            for hz, pc in top_peaks(d, fs, 4):
                tg = harmonic_tag(hz, f1, ftail)
                if tg:
                    findings.append(f"debug[{i}] (pre-filter): {hz:.1f}Hz {tg.strip('< =')}")
                emit(f"        {hz:7.2f} Hz  {pc:5.1f}%{tg}\n")

    # ---- cross coupling: pure pitch input -> roll response ----
    spr = m(L.col(r"setpoint\[0\]")); spp = m(L.col(r"setpoint\[1\]"))
    gr = m(L.col(r"gyroADC\[0\]")); gp = m(L.col(r"gyroADC\[1\]"))
    if all(x is not None for x in (spr, spp, gr, gp)):
        emit("\n  CROSS COUPLING\n")
        for lbl, drive, quiet, resp in (("pitch input -> roll", spp, spr, gr),
                                        ("roll input -> pitch", spr, spp, gp)):
            thr = np.percentile(np.abs(drive), 90)
            qt = np.percentile(np.abs(quiet), 30)
            sel = (np.abs(drive) > thr) & (np.abs(quiet) < qt)
            if sel.sum() > 200:
                emit(f"    {lbl}: {sel.sum():6d} samples, "
                     f"unwanted axis rms {resp[sel].std():7.1f} "
                     f"({100*resp[sel].std()/max(np.abs(drive[sel]).mean(),1e-9):.0f}% of input)\n")
            else:
                emit(f"    {lbl}: not enough isolated input in this flight\n")

    # ---- yaw coupling ----
    gy = m(L.col(r"gyroADC\[2\]")); spy = m(L.col(r"setpoint\[2\]"))
    coll = m(L.col(r"setpoint\[3\]", r"rcCommand\[3\]"))
    if gy is not None and spy is not None:
        yerr = spy - gy
        emit("\n  TAIL COUPLING  (how much the tail moves that you did NOT ask for)\n")
        emit(f"    yaw error rms {yerr.std():.1f}\n")
        if coll is not None and len(coll) == len(yerr):
            dc = np.abs(np.gradient(coll))
            if dc.std() > 1e-9:
                c = np.corrcoef(dc, np.abs(yerr))[0, 1]
                emit(f"    collective movement vs yaw error : corr {c:+.3f}\n")
                if c > 0.25:
                    findings.append(f"collective->yaw coupling (corr {c:+.2f}) - collective precomp may need work")
        if spr is not None and spp is not None:
            cyc = np.sqrt(spr ** 2 + spp ** 2)
            dcy = np.abs(np.gradient(cyc))
            if dcy.std() > 1e-9:
                c2 = np.corrcoef(dcy, np.abs(yerr))[0, 1]
                emit(f"    cyclic movement vs yaw error     : corr {c2:+.3f}\n")
                if c2 > 0.25:
                    findings.append(f"cyclic->yaw coupling (corr {c2:+.2f}) - yaw_cyclic_ff_gain may need raising")

    # ---- actuators ----
    emit("\n  SERVOS / MOTOR\n")
    for i in range(6):
        sv = m(L.col(rf"servo\[{i}\]"))
        if sv is None:
            continue
        rng = sv.max() - sv.min()
        sat = 100.0 * np.mean((sv > sv.max() - 0.02 * max(rng, 1)) |
                              (sv < sv.min() + 0.02 * max(rng, 1)))
        emit(f"    servo{i}  {sv.min():7.0f} .. {sv.max():7.0f}   rms {sv.std():6.1f}"
             f"   at travel limits {sat:4.1f}%\n")
        if sat > 5:
            findings.append(f"servo{i} sits at its travel limit {sat:.0f}% of the time")
    mo = m(L.col(r"motor\[0\]"))
    if mo is not None:
        emit(f"    motor0  {mo.min():7.0f} .. {mo.max():7.0f}   mean {mo.mean():7.0f}\n")

    # ---- power ----
    v = m(L.col(r"vbat", r"voltage")); cur = m(L.col(r"amperage", r"current"))
    if v is not None or cur is not None:
        emit("\n  POWER\n")
        if v is not None:
            emit(f"    voltage  mean {v.mean():8.1f}  min {v.min():8.1f}"
                 f"  sag {v.max()-v.min():7.1f}\n")
        if cur is not None:
            emit(f"    current  mean {cur.mean():8.1f}  max {cur.max():8.1f}\n")

    emit("\n")
    return {"idx": idx, "dur": dur, "fs": fs, "findings": findings}


def full_run(paths, emit, done):
    allf = []
    try:
        for path in paths:
            emit(f"\n########  {os.path.basename(path)}  "
                 f"({os.path.getsize(path)/1e6:.1f} MB)  ########\n")
            first = True
            i = 1
            while i <= 40:
                try:
                    r = analyse(path, i, emit)
                except Exception as e:
                    if first:
                        emit(f"  ERROR reading flight {i}: {type(e).__name__}: {e}\n")
                    break
                first = False
                if r:
                    r["file"] = os.path.basename(path)
                    allf.append(r)
                i += 1
            # field inventory once per file
            try:
                L = Log(path, 1)
                emit("  ---- every field in this file ----\n")
                emit("  " + ", ".join(L.names) + "\n")
                emit("  ---- every header in this file ----\n")
                for k, v in sorted(L.headers.items()):
                    emit(f"    {k} = {v}\n")
            except Exception:
                pass
        # summary
        emit("\n" + "=" * 72 + "\nSUMMARY - THINGS WORTH LOOKING AT\n" + "=" * 72 + "\n")
        seen = {}
        for r in allf:
            for f in r["findings"]:
                key = re.sub(r"[\d.+-]+", "#", f)
                seen.setdefault(key, [f, 0])
                seen[key][1] += 1
        if not seen:
            emit("  Nothing flagged. Tracking, filtering and actuators all look normal.\n")
        else:
            for key, (txt, n) in sorted(seen.items(), key=lambda kv: -kv[1][1]):
                emit(f"  [{n} of {len(allf)} flights]  {txt}\n")
        emit(f"\n  {len(allf)} flights analysed, "
             f"{sum(r['dur'] for r in allf)/60:.1f} minutes total.\n")
    except Exception:
        emit("\nUNEXPECTED ERROR:\n" + traceback.format_exc())
    finally:
        done()


# ---------- GUI ----------
class App:
    def __init__(self, root):
        self.root = root
        root.title("Rotorflight Blackbox Analyser")
        root.geometry("1000x680")
        bar = ttk.Frame(root, padding=8); bar.pack(fill="x")
        self.btn = ttk.Button(bar, text="Open blackbox log(s)...", command=self.pick)
        self.btn.pack(side="left")
        ttk.Button(bar, text="Copy all", command=self.copy).pack(side="left", padx=6)
        ttk.Button(bar, text="Save report...", command=self.save).pack(side="left")
        self.status = ttk.Label(bar, text="Pick one or more .BBL / .BFL files.")
        self.status.pack(side="left", padx=12)
        self.pb = ttk.Progressbar(root, mode="indeterminate"); self.pb.pack(fill="x", padx=8)
        f = ttk.Frame(root); f.pack(fill="both", expand=True, padx=8, pady=8)
        self.txt = tk.Text(f, wrap="none", font=("Consolas", 9))
        sy = ttk.Scrollbar(f, orient="vertical", command=self.txt.yview)
        sx = ttk.Scrollbar(f, orient="horizontal", command=self.txt.xview)
        self.txt.configure(yscrollcommand=sy.set, xscrollcommand=sx.set)
        self.txt.grid(row=0, column=0, sticky="nsew"); sy.grid(row=0, column=1, sticky="ns")
        sx.grid(row=1, column=0, sticky="ew")
        f.rowconfigure(0, weight=1); f.columnconfigure(0, weight=1)
        self.buf = []

    def emit(self, s):
        self.buf.append(s)
        self.root.after(0, self._append, s)

    def _append(self, s):
        self.txt.insert("end", s); self.txt.see("end")

    def pick(self):
        paths = filedialog.askopenfilenames(
            title="Choose Rotorflight blackbox logs",
            filetypes=[("Blackbox logs", "*.BBL *.bbl *.BFL *.bfl"), ("All files", "*.*")])
        if not paths:
            return
        self.txt.delete("1.0", "end"); self.buf = []
        self.btn.config(state="disabled"); self.pb.start(12)
        self.status.config(text=f"Reading {len(paths)} file(s)... this can take a few minutes.")
        threading.Thread(target=full_run, args=(list(paths), self.emit, self.finished),
                         daemon=True).start()

    def finished(self):
        self.root.after(0, self._fin)

    def _fin(self):
        self.pb.stop(); self.btn.config(state="normal")
        self.status.config(text="Done. Use 'Copy all' and paste it back to Claude.")

    def copy(self):
        self.root.clipboard_clear()
        self.root.clipboard_append("".join(self.buf))
        self.status.config(text="Copied to clipboard.")

    def save(self):
        p = filedialog.asksaveasfilename(defaultextension=".txt",
                                         initialfile="rotorflight_report.txt")
        if p:
            with open(p, "w", encoding="utf-8") as fh:
                fh.write("".join(self.buf))
            self.status.config(text=f"Saved to {p}")


if __name__ == "__main__":
    r = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except Exception:
        pass
    App(r)
    r.mainloop()
