"""Add the deep-space and near-Earth tracking networks to the atlas.

The map had the three NASA DSN complexes and a handful of control centres. Deep
space needs antennas 120 degrees apart so something is always in view, and every
agency that flies beyond Earth orbit has built or rented that ring - this adds
ESA's ESTRACK, Russia's, China's CLTC, India's IDSN and ISTRAC, Japan's JAXA
network, and the commercial polar teleports everyone else buys passes from.
"""
import io, json

P = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map\data\launch-map.json'


def f(n, lat, lon, cty, op, fn, nb, el=None, est=None, co=None):
    d = {'n': n, 't': 'facility', 'lat': lat, 'lon': lon, 'cty': cty, 'el': el, 'ar': None,
         'la': None, 'est': est, 'op': op, 'nb': nb, 'fn': fn}
    if co:
        d['co'] = co
    return d


DEEP = 'Deep-space antenna - tracks spacecraft beyond Earth orbit, where the signal arrives a billion times weaker than from LEO.'
NEAR = 'Near-Earth tracking station - passes with satellites in low orbit, a few minutes at a time as they go over.'
POLAR = 'Polar teleport - a high-latitude site sees a sun-synchronous satellite on almost every one of its orbits, which no mid-latitude station can.'

NEW = [
 # ---- ESA ESTRACK -----------------------------------------------------
 f('ESTRACK - New Norcia (DSA 1)', -31.048, 116.191, 'Australia', 'ESA', DEEP,
   'ESA\'s first 35 m deep-space dish, and the southern leg of its ring.', 252, '2002'),
 f('ESTRACK - Cebreros (DSA 2)', 40.453, -4.368, 'Spain', 'ESA', DEEP,
   'The European leg; built for Venus Express and still working the planetary missions.', 794, '2005',
   'NASA\'s Madrid deep-space complex is 20 km away at Robledo.'),
 f('ESTRACK - Malargue (DSA 3)', -35.776, -69.398, 'Argentina', 'ESA', DEEP,
   'The Americas leg, completing ESA\'s 120-degree spacing.', 1550, '2012'),
 f('ESTRACK - Kourou', 5.252, -52.804, 'French Guiana', 'ESA', NEAR,
   'Catches launchers minutes after lift-off from the pads next door.', 10, '1975',
   'The Guiana Space Centre and a Galileo uplink station.'),
 f('ESTRACK - Redu', 50.002, 5.146, 'Belgium', 'ESA', NEAR,
   'Satellite checkout and routine passes.', 385, '1968',
   'The Galileo in-orbit test site.'),
 f('ESTRACK - Santa Maria', 36.997, -25.136, 'Portugal', 'ESA', NEAR,
   'Azores station, used for launch tracking across the Atlantic.', 276, '2008',
   'A Galileo sensor station.'),
 f('ESTRACK - Kiruna', 67.857, 20.964, 'Sweden', 'ESA', POLAR,
   'ESA\'s Arctic station at Salmijarvi.', 391, '1990',
   'The Esrange rocket range and SSC\'s teleport.'),
 f('ESTRACK - Perth', -31.803, 115.885, 'Australia', 'ESA', NEAR,
   'Western Australian station for launch and early-orbit work.', 22, '1980s'),
 # ---- Russia ----------------------------------------------------------
 f('Bear Lakes (Medvezhi Ozera)', 55.871, 37.955, 'Russia', 'Roscosmos / RAS', DEEP,
   'A 64 m dish outside Moscow, used for deep-space and radio astronomy.', 180, '1950s'),
 f('Ussuriysk Deep Space Station', 44.015, 131.757, 'Russia', 'Roscosmos', DEEP,
   'The far-eastern 70 m antenna, built for planetary missions.', 100, '1970s',
   'A GLONASS monitoring station.'),
 f('Kalyazin Radio Astronomy Observatory', 57.223, 37.900, 'Russia', 'RAS', DEEP,
   'A 64 m dish shared between astronomy and spacecraft tracking.', 130, '1992'),
 # ---- China CLTC ------------------------------------------------------
 f('Kashi Deep Space Station', 39.504, 76.734, 'China', 'CLTC', DEEP,
   'A 35 m dish, part of China\'s deep-space ring with Jiamusi and Neuquen.', 1300, '2013',
   'A BeiDou uplink station.'),
 f('Jiamusi Deep Space Station', 46.494, 130.770, 'China', 'CLTC', DEEP,
   'China\'s 66 m dish - the biggest in its deep-space network.', 90, '2013',
   'A BeiDou uplink station.'),
 f('Beijing Aerospace Control Center', 40.080, 116.270, 'China', 'CLTC / PLA',
   'Mission control - flies crewed and deep-space missions minute by minute.',
   'Where Shenzhou and Chang\'e missions are actually run from.', 50, '1996'),
 f('Weinan Tracking Station', 34.500, 109.500, 'China', 'CLTC', NEAR,
   'One of the domestic stations that ring the Chinese launch corridors.', 350, '1960s'),
 f('Qingdao Tracking Station', 36.070, 120.380, 'China', 'CLTC', NEAR,
   'Coastal station covering the eastern approaches.', 25, '1960s'),
 # ---- India -----------------------------------------------------------
 f('Indian Deep Space Network (Byalalu)', 13.034, 77.370, 'India', 'ISRO', DEEP,
   '32 m and 18 m dishes built for Chandrayaan and Mangalyaan.', 850, '2008',
   'The NavIC master control facility is on the same campus.'),
 f('ISTRAC - Lucknow', 26.912, 80.956, 'India', 'ISRO', NEAR,
   'Northern tracking station for launch and routine passes.', 125, '1970s',
   'A NavIC monitoring station.'),
 f('ISTRAC - Port Blair', 11.638, 92.726, 'India', 'ISRO', NEAR,
   'Andaman station - it watches launches head out over the Bay of Bengal.', 20, '1980s',
   'A NavIC monitoring station.'),
 f('ISTRAC - Thiruvananthapuram', 8.524, 76.869, 'India', 'ISRO', NEAR,
   'Southern station beside the sounding-rocket range.', 15, '1960s',
   'The Thumba launching station and VSSC.'),
 f('ISTRAC - Brunei', 4.903, 114.940, 'Brunei', 'ISRO', NEAR,
   'Overseas station covering the eastern launch corridor.', 20, '2000s'),
 f('ISTRAC - Biak', -1.180, 136.110, 'Indonesia', 'ISRO', NEAR,
   'Equatorial Pacific station for early-orbit tracking.', 15, '1990s'),
 f('ISTRAC - Mauritius', -20.230, 57.480, 'Mauritius', 'ISRO', NEAR,
   'Indian Ocean station, important for PSLV ascent coverage.', 150, '1980s'),
 # ---- Japan -----------------------------------------------------------
 f('Usuda Deep Space Center', 36.133, 138.362, 'Japan', 'JAXA', DEEP,
   'The 64 m dish that brought Hayabusa\'s telemetry home.', 1450, '1984'),
 f('Misasa Deep Space Station', 36.129, 138.363, 'Japan', 'JAXA', DEEP,
   'The 54 m dish built to replace Usuda\'s ageing antenna.', 1450, '2021',
   'Usuda, a few hundred metres away.'),
 f('Katsuura Tracking Station', 35.200, 140.310, 'Japan', 'JAXA', NEAR,
   'Pacific-coast station for launch and early orbit.', 60, '1960s'),
 f('Masuda Tracking Station', 30.555, 130.968, 'Japan', 'JAXA', NEAR,
   'On Tanegashima, watching launches leave the pad.', 30, '1960s',
   'The Tanegashima Space Center.'),
 f('Okinawa Tracking Station', 26.500, 127.930, 'Japan', 'JAXA', NEAR,
   'Southern station extending launch coverage.', 100, '1960s',
   'A QZSS tracking station.'),
 # ---- NASA near-Earth and commercial polar ----------------------------
 f('White Sands Complex', 32.541, -106.611, 'United States', 'NASA',
   'Relay ground terminal - the gateway for TDRS, the satellites that relay data from other satellites.',
   'How the ISS and Hubble talk to the ground almost continuously.', 1450, '1983'),
 f('Wallops Ground Station', 37.925, -75.475, 'United States', 'NASA', NEAR,
   'Near-Earth network station beside the launch range.', 12, '1945',
   'The Wallops Flight Facility launch pads.'),
 f('Alaska Satellite Facility', 64.859, -147.850, 'United States', 'NASA / UAF', POLAR,
   'Fairbanks antennas that take most of the polar-orbiting science downlinks.', 180, '1991',
   'A GPS monitoring station.'),
 f('KSAT Svalbard (SvalSat)', 78.229, 15.389, 'Norway', 'KSAT', POLAR,
   'The busiest polar teleport in the world - a sun-synchronous satellite can be met on every orbit.', 458, '1997',
   'A Galileo sensor and uplink station.'),
 f('KSAT Troll (TrollSat)', -72.012, 2.535, 'Antarctica', 'KSAT', POLAR,
   'The southern half of the polar pair; between them they catch both ends of every orbit.', 1270, '2007',
   'The Galileo Antarctic sensor station and Norway\'s Troll base.'),
 f('SSC Santiago Station', -33.151, -70.667, 'Chile', 'SSC', NEAR,
   'South American teleport used by many operators.', 730, '1960s'),
 f('SSC Dongara (Western Australia)', -29.046, 115.349, 'Australia', 'SSC', NEAR,
   'Australian teleport serving launch and routine passes.', 50, '2000s'),
 f('SSC Inuvik', 68.318, -133.549, 'Canada', 'SSC', POLAR,
   'Arctic Canadian station for polar-orbiting missions.', 100, '2010'),
 f('Awarua Ground Station', -46.530, 168.380, 'New Zealand', 'SSC / Awarua', POLAR,
   'Southern New Zealand teleport - far enough south to catch descending passes early.', 10, '2008'),
]

sites = json.load(io.open(P, encoding='utf-8'))
have = {s['n'] for s in sites}
added = [s for s in NEW if s['n'] not in have]
sites.extend(added)

# Say what the three NASA complexes do, now that the others carry a function.
EXIST = {
 'Goldstone Deep Space Complex': (DEEP, 'The 70 m dish in the Mojave; the American leg of the DSN ring.'),
 'Canberra Deep Space Complex': (DEEP, 'The only DSN complex in the southern hemisphere - some spacecraft can only be heard from here.'),
 'Madrid Deep Space Complex': (DEEP, 'The European leg, at Robledo de Chavela; ESA\'s Cebreros dish is 20 km away.'),
 'ISTRAC (ISRO Telemetry & Tracking)': (NEAR, 'The network control centre for ISRO\'s tracking stations.'),
 'ESA ESOC (Mission Control)': ('Mission control - flies ESA\'s spacecraft and runs the ESTRACK network.', None),
 'Xi\'an Satellite Control Center': ('Mission control - flies most Chinese spacecraft once they are in orbit.', None),
}
for s in sites:
    d = EXIST.get(s['n'])
    if d and not s.get('fn'):
        s['fn'] = d[0]
        if d[1]:
            s['co'] = d[1]

io.open(P, 'w', encoding='utf-8').write(json.dumps(sites, ensure_ascii=False, indent=1))
print('added %d tracking stations; markers now %d (facility: %d)'
      % (len(added), len(sites), sum(1 for s in sites if s['t'] == 'facility')))
