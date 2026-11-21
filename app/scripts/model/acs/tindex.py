"""Monthly price index with building-cell fixed effects (a repeat-building index), per DLD area x basis,
pooled to Dubai x basis where thin. numpy only; importable by the next stage.

Model, for sales in (T - months*30.4375 days, T]:
  ln psf_i - beta[basis, bed] * (ln size_i - mean ln size of the cell) = alpha[cell] + theta[group(i), month(i)] + e_i
  cell = building x bedrooms x basis; month 0 = the 30.44 days that end at T.
  theta[area x basis] = tau[basis] + d[area x basis];  d is ridge-shrunk to 0 (k, in sales per month) and smoothed in time
  with a random-walk penalty (lam). Optional third level: community (master project) deviation from its area.
Each level is solved exactly from the cell x month count matrix (no iteration)."""
import numpy as np
import lib as L

MON = L.MON

def _solve_fe(cellid, C, mo, M, y, w, offset=None, k=0.0, lam=0.0):
    """Month effects with cell fixed effects absorbed. With k = lam = 0: minimum-norm solution (levels are arbitrary).
    offset: known month effects already removed (array M) -> returns the deviation from it."""
    N = np.zeros((C, M)); np.add.at(N, (cellid, mo), w)
    nc = N.sum(1); ok = nc > 0
    sy = np.bincount(cellid, w * y, minlength=C); ny = np.bincount(mo, w * y, minlength=M)
    Ni = N[ok] / nc[ok][:, None]
    A = np.diag(N.sum(0)) - N[ok].T @ Ni
    rhs = ny - Ni.T @ sy[ok]
    if offset is not None: rhs = rhs - A @ offset
    if k > 0 or lam > 0:
        D = np.diff(np.eye(M), axis=0)
        return np.linalg.solve(A + k * np.eye(M) + lam * D.T @ D, rhs), N.sum(0)
    return np.linalg.lstsq(A, rhs, rcond=None)[0], N.sum(0)

class Index:
    def __init__(self, S, B, T, months=48, slopes=None, k=20.0, lam=50.0, kc=None, lamc=None, mask=None, robust=True):
        self.T = T; self.M = M = months
        m = (S["day"] <= T) & (S["day"] > T - int(round(months * MON)))
        if mask is not None: m &= mask
        idx = np.where(m)[0]; self.idx = idx
        mo = np.minimum(((T - S["day"][idx]) / MON).astype(np.int64), M - 1)
        cid, C = L.ids(S["cell"][idx]); bs = S["basis"][idx]; bd = np.minimum(S["bed"][idx], 4)
        if slopes is None: slopes = fit_slopes(S, T)
        self.slopes = slopes
        cm = np.bincount(cid, S["ls"][idx], minlength=C) / np.bincount(cid, minlength=C)
        y = S["lp"][idx] - slopes[bs, bd] * (S["ls"][idx] - cm[cid])
        w = np.ones(len(idx))
        self.tau = np.zeros((2, M)); self.n_dubai = np.zeros((2, M))
        for it in range(2 if robust else 1):
            for s in (0, 1):
                r = np.where(bs == s)[0]; c2, C2 = L.ids(cid[r])
                self.tau[s], self.n_dubai[s] = _solve_fe(c2, C2, mo[r], M, y[r], w[r])
                self.tau[s] -= self.tau[s][0]
            if it == 0 and robust:
                res = y - self.tau[bs, mo]; res = L.demean(res, cid, C)
                sd = 1.4826 * np.median(np.abs(res)); w = (np.abs(res) <= 4 * sd).astype(float)
        self.w = w
        ar = S["area"][idx]; self.d = {}; self.n_area = {}
        for a in np.unique(ar):
            for s in (0, 1):
                r = np.where((ar == a) & (bs == s))[0]
                if len(r) == 0: continue
                c2, C2 = L.ids(cid[r])
                self.d[(int(a), s)], self.n_area[(int(a), s)] = _solve_fe(c2, C2, mo[r], M, y[r], w[r], offset=self.tau[s], k=k, lam=lam)
        self.dc = {}
        if kc is not None:
            ms = S["master"][idx]
            for c in np.unique(ms):
                if c == 0: continue
                for s in (0, 1):
                    r = np.where((ms == c) & (bs == s))[0]
                    if len(r) < 30: continue
                    c2, C2 = L.ids(cid[r])
                    # a community can span areas: remove each sale's own area index first
                    off = np.zeros(len(r)); aa = ar[r]
                    for a in np.unique(aa): off[aa == a] = self.theta(int(a), s)[mo[r][aa == a]]
                    self.dc[(int(c), s)] = _solve_fe(c2, C2, mo[r], M, y[r] - off, w[r], offset=np.zeros(M), k=kc, lam=lamc)[0]
        self._keep = (idx, mo, cid, y)

    def theta(self, area, basis, master=0):
        t = self.tau[basis] + self.d.get((area, basis), 0.0)
        if master and (master, basis) in self.dc: t = t + self.dc[(master, basis)]
        return t

    def adjust(self, area, basis, day, anchor="m0", master=0):
        """ln factor that moves a sale registered on `day` to the data date T. Vectorised over equal-length arrays."""
        area = np.asarray(area); basis = np.asarray(basis); day = np.asarray(day); master = np.zeros_like(area) if np.isscalar(master) else np.asarray(master)
        mo = np.clip(((self.T - day) / MON).astype(np.int64), 0, self.M - 1)
        out = np.zeros(len(day))
        key = (area * 2 + basis) * 100000 + master
        for kk in np.unique(key):
            mk = key == kk; a = int(area[mk][0]); s = int(basis[mk][0]); c = int(master[mk][0]); th = self.theta(a, s, c)
            if anchor == "m0": out[mk] = th[0] - th[mo[mk]]
            elif anchor == "mean3": out[mk] = th[:3].mean() - th[mo[mk]]
            elif anchor == "skip2": out[mk] = th[2] - th[np.maximum(mo[mk], 2)]
        return out

def fit_slopes(S, T, days=1095):
    """Within cell x half-year size slope per basis x bedrooms (capped at 4), from the `days` to T."""
    ii = np.where((S["day"] <= T) & (S["day"] > T - days))[0]
    g, G = L.ids(S["cell"][ii], (T - S["day"][ii]) // 183)
    out = np.zeros((2, 5)); bs = S["basis"][ii]; bd = np.minimum(S["bed"][ii], 4)
    for s in (0, 1):
        for k in range(5):
            m = (bs == s) & (bd == k)
            if m.sum() < 200: out[s, k] = out[s, max(k - 1, 0)]; continue
            g2, G2 = L.ids(g[m]); out[s, k] = L.fe_slope(S["lp"][ii][m], S["ls"][ii][m], g2, G2)[0]
    return out
