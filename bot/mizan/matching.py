"""Match the building name written in a listing to a building we hold sales for.

Listings use nicknames ("Marina Crest", "Palm Vista Res."). Registered sales use project
names. The alias table joins them. Fuzzy matching only proposes candidates; the user
always confirms with one tap.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

# Common listing abbreviations -> full words
_ABBREV = {
    "res": "residences", "resi": "residences", "residence": "residences",
    "twr": "tower", "towers": "tower", "hts": "heights", "ht": "heights",
    "bldg": "building", "blg": "building", "apts": "apartments", "apt": "apartments",
    "jvc": "jumeirah village circle", "jlt": "jumeirah lake towers", "dxb": "dubai",
    "no": "", "the": "",
}
_ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}


def normalise(text: str) -> str:
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    words = []
    for w in text.split():
        w = _ROMAN.get(w, w)
        w = _ABBREV.get(w, w)
        if w:
            words.extend(w.split())
    return " ".join(words)


@dataclass
class Candidate:
    building_id: int
    name: str
    area: str
    score: float


def _score(query: str, alias: str) -> float:
    if not query or not alias:
        return 0.0
    ratio = SequenceMatcher(None, query, alias).ratio()
    q, a = set(query.split()), set(alias.split())
    overlap = len(q & a) / max(len(a), 1)
    # A trailing number ("2") must agree, otherwise Tower 1 and Tower 2 look identical.
    qn = {w for w in q if w.isdigit()}
    an = {w for w in a if w.isdigit()}
    if qn and an and not (qn & an):
        penalty = 0.25          # "Tower 1" vs "Tower 2"
    elif bool(qn) != bool(an):
        penalty = 0.15          # "Marina Crest 2" vs plain "Marina Crest"
    else:
        penalty = 0.0
    return max(ratio, overlap) - penalty


def candidates(query: str, alias_rows, area_hint: str | None = None, limit: int = 3, floor: float = 0.45):
    """alias_rows: iterable of (alias, building_id, name, area)."""
    q = normalise(query)
    area_n = normalise(area_hint) if area_hint else ""
    best: dict[int, Candidate] = {}
    for alias, bid, name, area in alias_rows:
        s = _score(q, alias)
        # The listing text often contains the area too ("Marina Crest, Dubai Marina")
        s = max(s, _score(q, f"{alias} {normalise(area)}"))
        if area_n and area_n in normalise(area):
            s += 0.05
        if s >= floor and (bid not in best or s > best[bid].score):
            best[bid] = Candidate(bid, name, area, round(s, 3))
    return sorted(best.values(), key=lambda c: c.score, reverse=True)[:limit]
