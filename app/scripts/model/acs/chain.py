"""Stage 5: the chain "ACS first, today's answer as the fallback", per held-out sale.
Today: A = tier-1 median with the fixed 5% band (diff >= 5% above, <= -5% below); B = the shipped tier-2 range where its rule
shows one (rounded ends; above / below / within), otherwise no answer. New: the ACS rounded range when ACS shows, else today's.
A listing is the held-out sale priced at its true AED per sq ft times f. Right verdict: within at f = 1, above at f > 1, below at f < 1."""
import numpy as np
FS = (0.8, 0.9, 1.0, 1.1, 1.2)

def verdicts(D, E, acs_shown):
    """dict f -> (today verdict, new verdict) as int arrays: 1 above, 0 within, -1 below, 9 no answer; plus answered masks and centres."""
    truth = np.exp(D["truth"]); A = D["scen"] == 0; B = D["scen"] == 1
    t1 = np.exp(D["t1"]); sshown = (D["sreason"] == 0) & B
    today_ans = A | sshown; new_ans = today_ans | acs_shown
    out = {}
    for f in FS:
        p = truth * f
        d = p / t1 - 1; vt1 = np.where(d >= 0.05, 1, np.where(d <= -0.05, -1, 0))
        vs = np.where(p > D["srhi"], 1, np.where(p < D["srlo"], -1, 0))
        va = np.where(p > E["rhi"], 1, np.where(p < E["rlo"], -1, 0))
        today = np.where(A, vt1, np.where(sshown, vs, 9)); new = np.where(acs_shown, va, today)
        out[f] = (today, new)
    ctoday = np.where(A, D["t1"], np.where(sshown, D["sc"], np.nan)); cnew = np.where(acs_shown, D["main_centre"], ctoday)
    return out, today_ans, new_ans, ctoday, cnew

def right(f): return 0 if f == 1.0 else (1 if f > 1 else -1)

def summary(D, V, m, w):
    """For the rows m (both answered where a verdict is compared): per f the share right today / new, the share that differ,
    and of those that differ who is right. Weighted by w."""
    res = {}
    for f in FS:
        t, n = V[f]; mm = m & (t != 9) & (n != 9); ww = w[mm]; W = ww.sum()
        if W == 0: continue
        r = right(f); tr = t[mm] == r; nr = n[mm] == r; df = t[mm] != n[mm]
        res[f] = dict(n=int(mm.sum()), todayRight=100 * float((tr * ww).sum() / W), newRight=100 * float((nr * ww).sum() / W), differ=100 * float((df * ww).sum() / W),
                      newRightOnly=100 * float(((df & nr & ~tr) * ww).sum() / W), todayRightOnly=100 * float(((df & tr & ~nr) * ww).sum() / W), bothWrong=100 * float(((df & ~tr & ~nr) * ww).sum() / W),
                      todayWrongDir=100 * float(((t[mm] == -r) * ww).sum() / W) if r != 0 else None, newWrongDir=100 * float(((n[mm] == -r) * ww).sum() / W) if r != 0 else None)
    return res
