"""Fill out the GNSS ground segment on the launch atlas.

The map had GPS's monitoring network and one control centre per constellation.
Every system has the same three layers - a control centre, monitoring stations
that watch the satellites, and uplink antennas that send the navigation message
back up - so this adds those layers for GPS, GLONASS, Galileo, BeiDou, QZSS and
NavIC. Coordinates are the published site or, where the exact antenna is not
public, the facility or town that hosts it; the note says which.
"""
import io, json

REPO = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map'
P = REPO + r'\data\launch-map.json'


def st(n, lat, lon, cty, op, nb, el=None, est=None):
    return {'n': n, 't': 'gnss', 'lat': lat, 'lon': lon, 'cty': cty,
            'el': el, 'ar': None, 'la': None, 'est': est, 'op': op, 'nb': nb}


NEW = [
 # ---- GPS: the rest of the monitoring network -------------------------
 st('GPS Monitor Station - Cape Canaveral', 28.486, -80.577, 'United States', 'US Space Force',
    'Air Force monitor station and ground antenna on the Eastern Range.', 3),
 st('GPS Monitor Station - Fairbanks', 64.978, -147.512, 'United States', 'NGA',
    'The high-latitude station in the NGA half of the network.', 135),
 st('GPS Monitor Station - Washington (USNO)', 38.921, -77.067, 'United States', 'US Naval Observatory',
    'Co-located with the Master Clock that GPS time is steered against.', 70),
 st('GPS Monitor Station - Quito', -0.214, -78.500, 'Ecuador', 'NGA',
    'Equatorial station; being on the equator fills a geometry gap in the network.', 2850),
 st('GPS Monitor Station - Buenos Aires', -34.572, -58.439, 'Argentina', 'NGA',
    'Southern-hemisphere monitor station.', 25),
 st('GPS Monitor Station - Hermitage', 51.450, -1.420, 'United Kingdom', 'NGA',
    'The European station in the NGA network.', 130),
 st('GPS Monitor Station - Manama', 26.209, 50.586, 'Bahrain', 'NGA',
    'Gulf station, covering the Middle East and Indian Ocean arc.', 10),
 st('GPS Monitor Station - Osan', 37.090, 127.030, 'South Korea', 'NGA',
    'East Asian monitor station at Osan Air Base.', 20),
 st('GPS Monitor Station - Adelaide', -34.729, 138.619, 'Australia', 'NGA',
    'Australian monitor station.', 50),
 st('GPS Monitor Station - Wellington', -41.286, 174.776, 'New Zealand', 'NGA',
    'South Pacific monitor station.', 20),
 st('GPS Monitor Station - Papeete', -17.537, -149.566, 'French Polynesia', 'NGA',
    'Mid-Pacific station - the ocean gaps are what the network is shaped around.', 5),
 st('GPS Monitor Station - Hartebeesthoek', -25.887, 27.707, 'South Africa', 'NGA',
    'Hosted at the HartRAO radio-astronomy site; the African station.', 1550),
 st('GPS Alternate Master Control Station', 34.742, -120.572, 'United States', 'US Space Force',
    'Vandenberg SFB - takes over if Schriever is lost, which is why it sits on the other coast.', 100),

 # ---- GLONASS ---------------------------------------------------------
 st('GLONASS Station - Schelkovo', 55.930, 38.000, 'Russia', 'Roscosmos / RNIIKP',
    'Laser ranging and monitoring station near Moscow.', 180),
 st('GLONASS Station - St Petersburg', 59.950, 30.320, 'Russia', 'Roscosmos',
    'Western monitoring and upload station.', 10),
 st('GLONASS Station - Yenisejsk', 58.450, 92.170, 'Russia', 'Roscosmos',
    'Central Siberian station; the network is strung along Russia to keep every satellite in view.', 80),
 st('GLONASS Station - Komsomolsk-on-Amur', 50.550, 137.000, 'Russia', 'Roscosmos',
    'Far-eastern upload station.', 25),
 st('GLONASS Station - Ussuriysk', 44.000, 131.760, 'Russia', 'Roscosmos',
    'Pacific-facing tracking station.', 100),
 st('GLONASS Station - Yakutsk', 62.030, 129.680, 'Russia', 'Roscosmos',
    'Northern monitoring station.', 100),
 st('GLONASS Station - Vorkuta', 67.490, 64.040, 'Russia', 'Roscosmos',
    'Arctic monitoring station.', 180),
 st('GLONASS Station - Nurek (Okno)', 38.280, 69.330, 'Tajikistan', 'Roscosmos / Russian MoD',
    'The Okno space-surveillance complex also carries GLONASS ground equipment.', 2200),
 st('GLONASS Station - Brasilia', -15.780, -47.930, 'Brazil', 'Roscosmos / INPE',
    'One of the first GLONASS stations outside Russia, hosted with Brazil.', 1100),
 st('GLONASS Station - Santa Maria', -29.720, -53.720, 'Brazil', 'Roscosmos / UFSM',
    'Southern Brazilian monitoring station.', 110),
 st('GLONASS Station - Hartebeesthoek', -25.887, 27.707, 'South Africa', 'Roscosmos / SANSA',
    'Russian monitoring equipment at the South African site - the same hill as several other networks.', 1550),
 st('GLONASS Station - Novolazarevskaya', -70.770, 11.830, 'Antarctica', 'Roscosmos / AARI',
    'Antarctic station; polar sites see the high-inclination arcs no mid-latitude site can.', 100),

 # ---- Galileo ---------------------------------------------------------
 st('Galileo Uplink Station - Kourou', 5.251, -52.805, 'French Guiana', 'EUSPA / ESA',
    'Uplink antennas that send the navigation message back to the satellites.', 10),
 st('Galileo Uplink Station - Reunion', -20.900, 55.500, 'Reunion (France)', 'EUSPA / ESA',
    'Indian Ocean uplink site.', 60),
 st('Galileo Uplink Station - Noumea', -22.270, 166.440, 'New Caledonia (France)', 'EUSPA / ESA',
    'Pacific uplink site.', 20),
 st('Galileo Uplink Station - Papeete', -17.570, -149.610, 'French Polynesia', 'EUSPA / ESA',
    'Mid-Pacific uplink site; the overseas territories are what give Europe global coverage.', 10),
 st('Galileo Station - Svalbard', 78.230, 15.390, 'Norway', 'EUSPA / KSAT',
    'Sensor station and uplink inside the Arctic circle.', 450),
 st('Galileo Sensor Station - Kiruna', 67.857, 20.964, 'Sweden', 'EUSPA / SSC',
    'Northern European sensor station.', 390),
 st('Galileo Sensor Station - Jan Mayen', 70.920, -8.720, 'Norway', 'EUSPA',
    'North Atlantic sensor station on a volcanic island.', 40),
 st('Galileo Sensor Station - Troll', -72.012, 2.535, 'Antarctica', 'EUSPA / Norwegian Polar Institute',
    'Antarctic sensor station at the Troll base.', 1270),
 st('Galileo Sensor Station - Azores', 37.740, -25.660, 'Portugal', 'EUSPA',
    'Mid-Atlantic sensor station.', 110),
 st('Galileo Sensor Station - Maspalomas', 27.763, -15.634, 'Spain', 'EUSPA / INTA',
    'Canary Islands station, shared with ESA tracking.', 205),
 st('Galileo Sensor Station - Kerguelen', -49.350, 70.256, 'France', 'EUSPA / CNES',
    'Southern Indian Ocean sensor station, about as remote as ground segments get.', 30),
 st('Galileo In-Orbit Test Site - Redu', 50.002, 5.146, 'Belgium', 'ESA',
    'Where each Galileo satellite is checked out after launch.', 385),
 st('Galileo GNSS Service Centre - Madrid', 40.458, -3.529, 'Spain', 'EUSPA',
    'The user-facing side: service status, performance reporting and the help desk.', 600),
 st('Galileo Security Monitoring Centre - Saint-Germain', 48.900, 2.090, 'France', 'EUSPA',
    'Watches the Public Regulated Service and the system\u2019s security posture.', 80),

 # ---- BeiDou ----------------------------------------------------------
 st('BeiDou Uplink Station - Kashgar', 39.470, 75.990, 'China', 'CSNO',
    'Western uplink station; with Jiamusi and Sanya it covers the whole Chinese arc.', 1290),
 st('BeiDou Uplink Station - Jiamusi', 46.800, 130.370, 'China', 'CSNO',
    'North-eastern uplink station, also a deep-space antenna site.', 90),
 st('BeiDou Uplink Station - Sanya', 18.250, 109.510, 'China', 'CSNO',
    'Southern uplink station on Hainan.', 10),
 st('BeiDou Station - Swakopmund', -22.680, 14.530, 'Namibia', 'CSNO / CLTC',
    'Chinese tracking station in Namibia, used for both crewed missions and navigation support.', 50),
 st('BeiDou Station - Neuquen', -38.192, -70.149, 'Argentina', 'CSNO / CLTC',
    'The Espacio Lejano deep-space station in Patagonia; the southern-hemisphere anchor.', 1100),
 st('BeiDou Station - Kiruna', 67.857, 20.964, 'Sweden', 'CSNO / SSC',
    'Commercial polar coverage bought from the Swedish Space Corporation.', 390),

 # ---- QZSS ------------------------------------------------------------
 st('QZSS Tracking Station - Okinawa', 26.500, 127.930, 'Japan', 'QSS / JAXA',
    'Southern tracking and control station.', 100),
 st('QZSS Tracking Station - Sarobetsu', 45.100, 141.700, 'Japan', 'QSS / JAXA',
    'Northern Hokkaido tracking station.', 20),
 st('QZSS Monitoring Station - Guam', 13.470, 144.750, 'Guam (USA)', 'QSS',
    'Pacific monitoring station.', 100),
 st('QZSS Monitoring Station - Hawaii', 21.310, -157.860, 'United States', 'QSS',
    'Eastern Pacific monitoring station.', 10),
 st('QZSS Monitoring Station - Bangkok', 13.740, 100.520, 'Thailand', 'QSS',
    'South-East Asian monitoring station - QZSS is usable well beyond Japan.', 5),
 st('QZSS Monitoring Station - Canberra', -35.280, 149.130, 'Australia', 'QSS',
    'Southern monitoring station; the quasi-zenith orbits reach deep into the southern hemisphere.', 580),
 st('QZSS Monitoring Station - Bengaluru', 12.970, 77.590, 'India', 'QSS',
    'Western edge of the QZSS monitoring network.', 920),

 # ---- NavIC -----------------------------------------------------------
 st('NavIC IRIMS - Hassan', 13.005, 76.100, 'India', 'ISRO',
    'Ranging and integrity monitoring station, co-located with the Master Control Facility.', 950),
 st('NavIC IRIMS - Bhopal', 23.260, 77.410, 'India', 'ISRO',
    'Central Indian ranging and integrity monitoring station.', 525),
 st('NavIC IRIMS - Jodhpur', 26.240, 73.020, 'India', 'ISRO',
    'Western desert station.', 230),
 st('NavIC IRIMS - Lucknow', 26.850, 80.950, 'India', 'ISRO',
    'Northern plains station.', 125),
 st('NavIC IRIMS - Shillong', 25.580, 91.890, 'India', 'ISRO',
    'North-eastern station; the spread across India is what fixes the orbits.', 1500),
 st('NavIC IRIMS - Port Blair', 11.620, 92.730, 'India', 'ISRO',
    'Andaman Islands station, the eastern edge of the network.', 20),
 st('NavIC IRIMS - Dehradun', 30.320, 78.030, 'India', 'ISRO',
    'Himalayan foothills station.', 640),
 st('NavIC IRIMS - Mahendragiri', 8.450, 77.520, 'India', 'ISRO',
    'Southern station at the ISRO propulsion complex.', 300),
]

sites = json.load(io.open(P, encoding='utf-8'))
have = {s['n'] for s in sites}
added = [s for s in NEW if s['n'] not in have]
sites.extend(added)
io.open(P, 'w', encoding='utf-8').write(json.dumps(sites, ensure_ascii=False, indent=1))
print('added %d GNSS stations; markers now %d (gnss: %d)'
      % (len(added), len(sites), sum(1 for s in sites if s['t'] == 'gnss')))
by = {}
for s in sites:
    if s['t'] == 'gnss':
        k = s['n'].split()[0]
        by[k] = by.get(k, 0) + 1
print('by system:', by)
