"""gen_compendium.py — build data/compendium.json for the PRC Orbital Catalog.

The page used to carry 207 hand-typed rows inline, which is why BeiDou showed
14 satellites against a real constellation of 60-odd and why whole programmes
were missing.  The facts now come from the catalogue and only the judgements
are hand-written:

  CelesTrak SATCAT (the static /pub/satcat.csv, which is not subject to the
  rate limiting that hits the dynamic endpoints) supplies every PRC payload
  ever catalogued - in orbit and decayed - plus every payload any other owner
  has launched from a Chinese site, which is what the "other-country launch"
  filter is built from.

  scripts/compendium_notes.py supplies the series attributions and remarks.

  scripts/compendium_curated.json keeps the 207 original hand-written notes,
  matched back on by NORAD id so none of that work is lost; where one exists
  it wins over the generated series note.

Run:  python scripts/gen_compendium.py [path/to/satcat.csv]
Without an argument it downloads a fresh copy.
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import compendium_notes as N   # noqa: E402

SATCAT_URL = "https://celestrak.org/pub/satcat.csv"
# Jiuquan, Taiyuan, Xichang, Wenchang, the Yellow Sea and South China Sea
# sea-launch areas.  A payload on this list whose OWNER is not PRC is a
# satellite China launched for somebody else.
CN_SITES = {"JSC", "TAISC", "XICLF", "WSC", "YSLA", "SEAL", "SCSLA"}
SITE_NAME = {
    "JSC": "Jiuquan", "TAISC": "Taiyuan", "XICLF": "Xichang", "WSC": "Wenchang",
    "YSLA": "Yellow Sea", "SEAL": "Sea Launch", "SCSLA": "South China Sea",
}
OWNER_NAME = {
    "PAKI": "Pakistan", "ALG": "Algeria", "EGYP": "Egypt", "VENZ": "Venezuela",
    "TURK": "Turkey", "SAUD": "Saudi Arabia", "GER": "Germany", "SWED": "Sweden",
    "ECU": "Ecuador", "ARGN": "Argentina", "UAE": "UAE", "BRAZ": "Brazil",
    "NIG": "Nigeria", "BOL": "Bolivia", "LAOS": "Laos", "BELA": "Belarus",
    "ETH": "Ethiopia", "SUDN": "Sudan", "THAI": "Thailand", "ITSO": "Intelsat",
    "EUTE": "Eutelsat", "ABS": "ABS", "AC": "Asia-Pacific", "CHBZ": "China/Brazil",
    "USBZ": "US/Brazil", "IM": "Inmarsat", "ISRA": "Israel", "AUS": "Australia",
    "ITA": "Italy", "FR": "France", "NETH": "Netherlands", "SPN": "Spain",
    "UK": "United Kingdom", "US": "United States", "TBD": "unassigned",
    "DEN": "Denmark", "LUXE": "Luxembourg", "CZCH": "Czechia", "POL": "Poland",
    "RWA": "Rwanda", "SING": "Singapore", "MALA": "Malaysia", "SKOR": "South Korea",
}

# Historically important objects kept whatever their fate.  Fengyun-1C is the
# reason this list exists: the satellite was destroyed in 2007 but its debris
# is still the defining feature of its altitude band.
ALWAYS_KEEP = {25730, 4382, 41731, 37820, 41765}   # FY-1C, DFH-1, Micius, Tiangong-1/-2


def fetch_satcat(path=None):
    if path:
        return io.open(path, encoding="utf-8", newline="").read()
    print("downloading", SATCAT_URL)
    req = urllib.request.Request(SATCAT_URL, headers={"User-Agent": "nazar-compendium/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def orbit_class(ap, pe, inc, period):
    """The catalogue gives apogee, perigee and inclination; the orbit regime
    the table groups by has to be derived from them."""
    if ap is None or pe is None:
        return "LEO"
    if ap > 30000 and pe > 30000:
        return "IGSO" if (inc or 0) > 5 else "GEO"
    if ap - pe > 5000:                       # a big spread is the tell
        return "HEO" if ap > 30000 else "GTO"
    if pe > 15000:
        return "MEO"
    if 95 < (inc or 0) < 105 and ap < 2000:  # retrograde and near-circular
        return "SSO"
    return "LEO"


def status_of(row, inc_decay):
    """OPS_STATUS_CODE is sparse, so decay date and orbit do most of the work."""
    if row["DECAY_DATE"]:
        return "DEC"
    code = (row["OPS_STATUS_CODE"] or "").strip()
    if code in ("+", "P", "B", "S"):
        return "OP"
    if code in ("-", "D"):
        return "DEC"
    if code == "?":
        return "UNK"
    return "UNK" if inc_decay else "OP"


SERIES_RE = [(re.compile(s["pattern"], re.I), s) for s in N.SERIES]


def namekey(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def classify(name):
    for rx, spec in SERIES_RE:
        if rx.search(name):
            return spec
    return None


def fallback_series(name):
    """Strip the trailing designator so unlisted satellites still group."""
    base = re.split(r"[\s-]*\(", name)[0]
    base = re.sub(r"[\s_-]*\d[\dA-Z/.-]*$", "", base).strip(" -_")
    return base.title() if base else name.title()


def main():
    raw = fetch_satcat(sys.argv[1] if len(sys.argv) > 1 else None)
    rows = list(csv.DictReader(io.StringIO(raw)))

    # The 207 hand-typed rows carried NORAD ids that pointed at the wrong
    # object 153 times out of 207 - Russian satellites, spent rocket bodies,
    # other people's debris - so none of their orbital data or identifiers is
    # carried over.  Only the prose is, matched on a normalised name.
    curated = {}
    cur_path = os.path.join(HERE, "compendium_curated.json")
    if os.path.exists(cur_path):
        for rec in json.load(io.open(cur_path, encoding="utf-8")):
            if rec.get("notes"):
                curated[namekey(rec.get("name", ""))] = rec

    out, counts = [], {}
    for r in rows:
        if r["OBJECT_TYPE"] != "PAY":
            continue
        owner, site = r["OWNER"], r["LAUNCH_SITE"]
        norad = int(r["NORAD_CAT_ID"])
        foreign = owner != "PRC" and site in CN_SITES
        if owner != "PRC" and not foreign and norad not in ALWAYS_KEEP:
            continue

        name = (r["OBJECT_NAME"] or "").strip()
        ap, pe = num(r["APOGEE"]), num(r["PERIGEE"])
        inc, period = num(r["INCLINATION"]), num(r["PERIOD"])
        spec = classify(name)
        cur = curated.get(namekey(name))

        # Altitude: mean of apogee and perigee when they are close, the range
        # itself when they are not - an elliptical orbit has no one altitude.
        if ap is None or pe is None:
            alt = "—"
        elif ap - pe > 150:
            alt = "{:,.0f}–{:,.0f}".format(pe, ap)
        else:
            alt = "{:,.0f}".format((ap + pe) / 2)

        rec = {
            "n": name,
            "s": (spec or {}).get("series") or (cur or {}).get("series") or fallback_series(name),
            "f": (spec or {}).get("func") or (cur or {}).get("func") or "OTH",
            "o": orbit_class(ap, pe, inc, period),
            "a": alt,
            "i": "{:.1f}°".format(inc) if inc is not None else "—",
            "l": r["LAUNCH_DATE"] or "",
            "e": r["DECAY_DATE"] or "",
            "d": str(norad),
            "c": r["OBJECT_ID"] or "",
            "t": status_of(r, bool(r["DECAY_DATE"])),
            "r": (N.SATS.get(name.upper())
                  or (cur or {}).get("notes")
                  or (spec or {}).get("note")
                  or ""),
        }
        if foreign:
            rec["fo"] = OWNER_NAME.get(owner, owner)
            rec["ls"] = SITE_NAME.get(site, site)
            if not rec["r"]:
                rec["r"] = ("<span class='flag flag-for'>FOREIGN</span>Launched by China for "
                            + rec["fo"] + " from " + rec["ls"] + ".")
        elif not rec["r"]:
            rec["r"] = ("No public technical detail has been released for this satellite, and no "
                        "series attribution is established in the open sources. Orbit, launch date "
                        "and the COSPAR launch id are the available evidence.")
        if norad in ALWAYS_KEEP:
            rec["keep"] = 1
        counts[rec["f"]] = counts.get(rec["f"], 0) + 1
        out.append(rec)

    out.sort(key=lambda r: (r["l"] or "0000"), reverse=True)
    doc = {
        "built": date.today().isoformat(),
        "source": "CelesTrak SATCAT (/pub/satcat.csv), payloads only",
        "counts": {
            "total": len(out),
            "inOrbit": sum(1 for r in out if not r["e"]),
            "decayed": sum(1 for r in out if r["e"]),
            "foreign": sum(1 for r in out if r.get("fo")),
            "curatedNotes": sum(1 for r in out if namekey(r["n"]) in curated),
            "byFunc": counts,
        },
        "sats": out,
    }
    dest = os.path.join(ROOT, "data", "compendium.json")
    with io.open(dest, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote {} ({:,} satellites, {:,} bytes)".format(
        dest, len(out), os.path.getsize(dest)))
    for k, v in sorted(doc["counts"].items(), key=lambda kv: str(kv[0])):
        print("   ", k, v)


if __name__ == "__main__":
    main()
