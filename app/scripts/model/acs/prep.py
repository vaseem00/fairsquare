"""A long-history flat sales file (2011 on) under the product's cleaning rules.

  python scripts/model/acs/prep.py <Transactions .csv> [<another .csv> ...]

Source: the raw Data.Dubai "Transactions" downloads (kept outside the repository, read only), the files
`npm run data:build` was given, in the same order.
Rules mirrored from src/lib/ingest/data-dubai.ts: row rules 1-8, then 10 (unlike-unit blocks), 10a (like-unit blocks
off the building's level, 0.85x..1.18x), 10b (size under 0.5x / over 2x the building x bedrooms median), over ALL years.
Rule 12 (36-month window) is NOT applied: the point is longer history. Rows inside the snapshot window are checked
against the committed snapshot (data/open-data/sales.csv.gz) by transaction id: the two must be the same set.
Not mirrored: a transaction id that is in two files, or twice in one (rule 9 and the overlap rule). The files of
19 Nov 2026 have none; the snapshot check below fails when a later download does.
Writes data.npz and data_meta.json into the work folder (lib.HERE).
"""
import csv, gzip, json, os, re, sys, time
from datetime import date
from collections import Counter, defaultdict
import numpy as np

import lib as L
HERE = L.HERE; REPO = L.REPO
EPOCH = date(2020, 1, 1).toordinal()
INPUTS = sys.argv[1:]
if not INPUTS: sys.exit("usage: python scripts/model/acs/prep.py <Transactions .csv> [<another .csv> ...]")
# No sale can be dated after the day the files were downloaded (manifest.downloadedOn), as in data:build.
LATEST = json.load(open(os.path.join(REPO, "data", "open-data", "manifest.json"), encoding="utf-8"))["downloadedOn"]
SQFT = 10.7639
SALE = {"Sell", "Sale", "Sell - Pre registration", "Delayed Sell"}
ARABIC = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")
ROOMS = re.compile(r"^([1-9]\d*)\s*(?:b\s*/\s*r|br)?$")

def dnum(s):
    return date(int(s[:4]), int(s[5:7]), int(s[8:10])).toordinal() - EPOCH

def rooms(raw):
    s = raw.strip().lower()
    if s == "studio": return 0
    m = ROOMS.match(s)
    if not m: return None
    n = int(m.group(1))
    return n if 1 <= n <= 7 else None

def clean(s):
    return " ".join(ARABIC.sub("", s).split())

t0 = time.time()
rows = []  # tuples
bidx = {}; bnames = []
csv.field_size_limit(1 << 30)
for path in INPUTS:
  with open(path, "r", encoding="utf-8-sig", newline="") as f:
    rd = csv.reader(f)
    hdr = [h.strip().lower() for h in next(rd)]; ix = {h: i for i, h in enumerate(hdr)}
    I = lambda k: ix[k]
    c_sub, c_proc, c_use, c_date, c_rooms, c_area, c_worth = I("property_sub_type_en"), I("procedure_name_en"), I("property_usage_en"), I("instance_date"), I("rooms_en"), I("procedure_area"), I("actual_worth")
    c_b, c_a, c_pn, c_pj, c_m, c_reg, c_tx, c_grp = I("building_name_en"), I("area_name_en"), I("project_number"), I("project_name_en"), I("master_project_en"), I("reg_type_en"), I("transaction_id"), I("trans_group_en")
    for p in rd:
        if p[c_grp] != "Sales": continue
        if p[c_sub] != "Flat" or p[c_proc] not in SALE: continue
        if p[c_use] and p[c_use] != "Residential": continue
        bed = rooms(p[c_rooms])
        if bed is None: continue
        bn = clean(p[c_b])
        if not bn: continue
        try:
            sqm = float(p[c_area]); worth = float(p[c_worth])
        except ValueError:
            continue
        if not (sqm > 0 and worth > 0): continue
        size = round(sqm * SQFT, 2); price = round(worth)
        if size < 150 or size > 15000: continue
        psf = price / size
        if psf < 279 or psf > 20000: continue
        d = p[c_date][:10]
        if len(d) != 10 or d > LATEST: continue
        an = clean(p[c_a]); key = bn + "|" + an
        b = bidx.get(key)
        if b is None:
            b = len(bnames); bidx[key] = b; bnames.append(key)
        pn = p[c_pn].strip(); pn = str(int(float(pn))) if pn else ""
        rows.append((dnum(d), b, bed, 0 if not p[c_reg].startswith("Off") else 1, size, price, p[c_tx], pn, clean(p[c_pj]), clean(p[c_m]), an))
print("row rules passed:", len(rows), "buildings", len(bnames), round(time.time() - t0, 1), flush=True)

n = len(rows)
day = np.array([r[0] for r in rows], np.int32); b = np.array([r[1] for r in rows], np.int32); bed = np.array([r[2] for r in rows], np.int8)
basis = np.array([r[3] for r in rows], np.int8); size = np.array([r[4] for r in rows]); price = np.array([r[5] for r in rows], np.float64)
tx = [r[6] for r in rows]
# building facts: most common project number / project name / master project, area
pn_c = defaultdict(Counter); pj_c = defaultdict(Counter); m_c = defaultdict(Counter); area_of = {}
for r in rows:
    pn_c[r[1]][r[7]] += 1; pj_c[r[1]][r[8]] += 1; m_c[r[1]][r[9]] += 1; area_of[r[1]] = r[10]
del rows
keep = np.ones(n, bool)
# Rule 10: blocks (same building, date, price), 3+ rows, unlike units
gkey = {}
gid = np.empty(n, np.int64)
for i in range(n):
    k = (int(b[i]), int(day[i]), float(price[i]))
    g = gkey.get(k)
    if g is None: g = len(gkey); gkey[k] = g
    gid[i] = g
G = len(gkey); del gkey
gn = np.bincount(gid, minlength=G)
gmin = np.full(G, np.inf); gmax = np.zeros(G); np.minimum.at(gmin, gid, size); np.maximum.at(gmax, gid, size)
gsum = np.bincount(gid, size, minlength=G)
gbmin = np.full(G, 99); gbmax = np.full(G, -1); np.minimum.at(gbmin, gid, bed); np.maximum.at(gbmax, gid, bed)
unlike = (gn >= 3) & ((gbmin != gbmax) | (gmax > gmin * 1.05))
r10 = unlike[gid]; keep &= ~r10
inblock = (gn[gid] >= 3) & keep
# Rule 10a
lev = (b.astype(np.int64) * 8 + bed) * 2 + basis
others = defaultdict(list)
need = set(lev[inblock].tolist())
psf = price / size
for i in np.where(keep & ~inblock)[0]:
    k = int(lev[i])
    if k in need: others[k].append((int(day[i]), float(psf[i])))
others = {k: (np.array([x[0] for x in v]), np.array([x[1] for x in v])) for k, v in others.items()}
judged = {}; r10a = np.zeros(n, bool)
for i in np.where(inblock)[0]:
    part = (int(gid[i]), int(basis[i]))
    if part not in judged:
        off = False
        o = others.get(int(lev[i]))
        if o is not None:
            near = o[1][(o[0] >= day[i] - 365) & (o[0] <= day[i] + 365)]
            if len(near) >= 5:
                g = gid[i]; ratio = price[i] * gn[g] / gsum[g] / np.median(near)
                off = ratio < 0.85 or ratio > 1.18
        judged[part] = off
    r10a[i] = judged[part]
keep &= ~r10a
# Rule 10b
ck = b.astype(np.int64) * 8 + bed
ki = np.where(keep)[0]
o = ki[np.argsort(ck[ki], kind="stable")]; ks = ck[o]
uk, st = np.unique(ks, return_index=True); en = np.append(st[1:], len(ks))
r10b = np.zeros(n, bool)
for s_, e_ in zip(st.tolist(), en.tolist()):
    if e_ - s_ >= 5:
        ii = o[s_:e_]; m = np.median(size[ii])
        r10b[ii] = (size[ii] < m * 0.5) | (size[ii] > m * 2)
keep &= ~r10b
print("rule 10 unlike blocks", int(r10.sum()), "| 10a", int(r10a.sum()), "| 10b", int(r10b.sum()), "| kept all years", int(keep.sum()), flush=True)

# check against the committed snapshot
snap = set()
with gzip.open(os.path.join(REPO, "data", "open-data", "sales.csv.gz"), "rt", encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f): snap.add(r["ref"][4:])
insnap = np.array([t in snap for t in tx])
_man = json.load(open(os.path.join(REPO, "data", "open-data", "manifest.json"), encoding="utf-8"))
W0, W1 = dnum(_man["dataFrom"]), dnum(_man["dataThrough"])
inwin = (day >= W0) & (day <= W1)
chk = dict(snapshot_rows=len(snap), mine_in_window=int((keep & inwin).sum()), both=int((keep & inwin & insnap).sum()),
           mine_not_snapshot=int((keep & inwin & ~insnap).sum()), snapshot_not_mine=int(len(snap) - (keep & insnap).sum()))
print("snapshot check", chk, flush=True)

# first sale / first ready sale per building over all years (kept by row rules, as the product does)
NB = len(bnames)
first = np.full(NB, 10**9); np.minimum.at(first, b, day)
firstr = np.full(NB, 10**9); rm = basis == 0; np.minimum.at(firstr, b[rm], day[rm])

# project family: numbered phases of one project name in one DLD area (as t2/sib_bt.py "group" mode), else the project number
import unicodedata
STOP = {"the", "a", "an", "of", "by", "at", "and"}
TRAIL = re.compile(r"(\s+(phase\s+)?([0-9]+|[ivx]+|[a-h]))+$")
def norm(s):
    s = unicodedata.normalize("NFKD", s.lower()); s = "".join(ch for ch in s if not unicodedata.combining(ch)).replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())
def group_key(name):
    s = norm(name)
    s2 = TRAIL.sub("", " " + s).strip() if " " in s else s
    if s2 == s: return None
    toks = [t for t in s2.split() if t not in STOP]
    return s2 if len(toks) >= 2 else None
areas = {}; masters = {"": 0}; projs = {"": 0}; fams = {"": 0}
B_area = np.zeros(NB, np.int32); B_master = np.zeros(NB, np.int32); B_proj = np.zeros(NB, np.int32); B_fam = np.zeros(NB, np.int32)
B_pname = []
for i in range(NB):
    a = area_of[i]; B_area[i] = areas.setdefault(a, len(areas))
    B_master[i] = masters.setdefault(m_c[i].most_common(1)[0][0], len(masters))
    pn = pn_c[i].most_common(1)[0][0]; B_proj[i] = projs.setdefault(pn, len(projs))
    pj = pj_c[i].most_common(1)[0][0]; B_pname.append(pj)
    if pn:
        gk = group_key(pj)
        B_fam[i] = fams.setdefault((gk + "|" + a) if gk else ("#" + pn), len(fams))
sel = keep & (day >= dnum("2011-01-01"))
np.savez_compressed(os.path.join(HERE, "data.npz"), day=day[sel], b=b[sel], bed=bed[sel], basis=basis[sel], size=size[sel], price=price[sel],
                    insnap=insnap[sel], blockn=gn[gid][sel].astype(np.int32), gid=gid[sel],
                    B_area=B_area, B_master=B_master, B_proj=B_proj, B_fam=B_fam, B_first=first, B_firstr=firstr)
inv = lambda d: [k for k, _ in sorted(d.items(), key=lambda kv: kv[1])]
json.dump(dict(buildings=bnames, areas=inv(areas), masters=inv(masters), projs=inv(projs), fams=inv(fams), pname=B_pname, check=chk,
               rules=dict(r10=int(r10.sum()), r10a=int(r10a.sum()), r10b=int(r10b.sum()), kept_all=int(keep.sum()), kept_2011=int(sel.sum()))),
          open(os.path.join(HERE, "data_meta.json"), "w", encoding="utf-8"))
print("written", int(sel.sum()), round(time.time() - t0, 1))
