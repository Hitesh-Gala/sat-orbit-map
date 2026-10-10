"""Add the launch locations NextSpaceflight's map carries that NAZAR did not.

Both sites draw their launch locations from the same open database (The Space
Devs' Launch Library), so the comparison is against that rather than against a
scrape of their client-rendered map.
"""
import json, io

REPO = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map'
P = REPO + r'\data\launch-map.json'
sites = json.load(io.open(P, encoding='utf-8'))

NEW = [
 {"n": "Hokkaido Spaceport (Taiki)", "t": "launch", "lat": 42.506, "lon": 143.441,
  "cty": "Japan", "el": 30, "la": 7, "est": "2021 (Taiki test field 1995)",
  "op": "Space Cotan / Interstellar Technologies",
  "nb": "Japan's private launch base on the Pacific coast of Hokkaido - Interstellar's MOMO flew from here."},
 {"n": "Spaceport Kii (Kushimoto)", "t": "launch", "lat": 33.544, "lon": 135.890,
  "cty": "Japan", "el": 30, "la": 3, "est": "2021",
  "op": "Space One",
  "nb": "Japan's first privately built orbital pad, on the Kii peninsula; home of the Kairos small launcher."},
 {"n": "Shahrud Missile Test Site", "t": "launch", "lat": 36.201, "lon": 55.334,
  "cty": "Iran", "el": 1300, "la": 6, "est": "2013",
  "op": "IRGC Aerospace Force",
  "nb": "Iran's second launch site, run by the Revolutionary Guard rather than the civil space agency - Qased and Qaem fly from here."},
 {"n": "Reagan Test Site (Kwajalein / Omelek)", "t": "launch", "lat": 9.048, "lon": 167.743,
  "cty": "Marshall Islands (USA)", "el": 2, "la": 5, "est": "1960s",
  "op": "US Army Space & Missile Defense Command",
  "nb": "The atoll where Falcon 1 first reached orbit in 2008, after three failures from the same small pad on Omelek."},
 {"n": "Tonghae Satellite Launching Ground", "t": "launch", "lat": 40.856, "lon": 129.666,
  "cty": "North Korea", "el": 10, "la": 2, "est": "1984",
  "op": "NADA (DPRK)",
  "nb": "The older of North Korea's two launch sites, on the east coast at Musudan-ri; largely superseded by Sohae."},
 {"n": "El Arenosillo Test Centre", "t": "launch", "lat": 37.097, "lon": -6.739,
  "cty": "Spain", "el": 10, "la": 1, "est": "1966",
  "op": "INTA",
  "nb": "Spain's sounding-rocket range on the Atlantic coast; PLD Space flew the suborbital Miura 1 from here in 2023."},
 {"n": "Koonibba Test Range", "t": "launch", "lat": -31.886, "lon": 133.449,
  "cty": "Australia", "el": 80, "la": 1, "est": "2020",
  "op": "Southern Launch (with the Koonibba Community)",
  "nb": "A suborbital range on Wirangu land in South Australia, used for recoverable test flights."},
 {"n": "Pacific Missile Range Facility (Barking Sands)", "t": "launch", "lat": 21.982, "lon": -159.759,
  "cty": "United States", "el": 5, "la": 1, "est": "1956",
  "op": "US Navy",
  "nb": "Kauai's range - mostly missile-defence work, but the Super Strypi orbital attempt flew from here."},
 {"n": "Etlaq Spaceport", "t": "launch", "lat": 18.786, "lon": 56.822,
  "cty": "Oman", "el": 20, "la": 0, "est": "2023",
  "op": "Etlaq / National Space Programme of Oman",
  "nb": "The Arabian peninsula's first spaceport, at Duqm; suborbital so far, with an orbital pad planned."},
]

have = {s['n'] for s in sites}
added = [s for s in NEW if s['n'] not in have]
sites.extend(added)

# The open database also lists the Haiyang sea platform as its own location,
# a hundred-odd kilometres off the port NAZAR already marks.
for s in sites:
    if s['n'].startswith('Haiyang') and 'offshore' not in (s.get('nb') or ''):
        s['nb'] = (s.get('nb', '').rstrip('.') +
                   '. Rockets leave from a barge offshore, so launch records place the pad out at sea, not at the port itself.')

io.open(P, 'w', encoding='utf-8').write(json.dumps(sites, ensure_ascii=False, indent=1))
print('added %d sites; file now has %d markers (%d launch sites)'
      % (len(added), len(sites), sum(1 for s in sites if s['t'] == 'launch')))
for s in added:
    print('  +', s['n'])
