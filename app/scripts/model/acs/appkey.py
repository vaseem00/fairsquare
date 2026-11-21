"""The app's building key (src/lib/domain/normalise.ts + src/lib/ingest/identity.ts dldKey), in Python."""
import re
ABBREV = {"res": "residences", "resi": "residences", "residence": "residences", "twr": "tower", "towers": "tower", "hts": "heights", "ht": "heights", "bldg": "building", "blg": "building",
          "apts": "apartments", "apt": "apartments", "jvc": "jumeirah village circle", "jlt": "jumeirah lake towers", "dxb": "dubai", "no": "", "the": ""}
ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}
NUMBER_WORDS = {w: str(i + 1) for i, w in enumerate("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
def normalise(text):
    cleaned = re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower().replace("&", " and "))
    out = []
    for raw in re.split(r"\s+", cleaned):
        if not raw: continue
        w = ROMAN.get(raw, raw); w = NUMBER_WORDS.get(w, w); w = ABBREV.get(w, w)
        if w: out.extend(w.split(" "))
    return " ".join(out)
def dld_key(building, area_dld): return normalise(building) + "|" + normalise(area_dld)
