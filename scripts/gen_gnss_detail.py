"""Give every GNSS marker a function, a date where one is defensible, and a note
of what else shares the site.

The hover card already had altitude and operator; what it could not say was what
the station actually does. `fn` is the job, `co` is what else is on the hill.
Dates are only filled where the year is on the record - a station whose
commissioning date is not public is left blank rather than guessed.
"""
import io, json

P = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map\data\launch-map.json'

# What each layer of a ground segment does, in plain words.
FN = {
 'mcs':     'Master control - works out where the satellites really are, builds the navigation message and keeps system time.',
 'amcs':    'Alternate master control - takes over the constellation if the primary centre is lost.',
 'monitor': 'Monitoring station - tracks every satellite in view and sends the raw measurements to master control.',
 'uplink':  'Uplink station - transmits the navigation message and commands back to the satellites.',
 'both':    'Monitoring station and ground antenna - measures the satellites and uplinks their navigation message.',
 'sensor':  'Sensor station - a reference receiver whose measurements feed the orbit and clock solution.',
 'iot':     'In-orbit test site - checks each new satellite\'s signals before it is let into the constellation.',
 'service': 'Service centre - the user-facing side: performance reporting, service status and the help desk.',
 'security': 'Security monitoring - watches the encrypted government service and the system\'s security posture.',
}

# name -> (function key, established, co-located with)
DETAIL = {
 # ---- GPS -------------------------------------------------------------
 'GPS Master Control Station': ('mcs', '1985', 'Schriever SFB, with the 2nd Space Operations Squadron that flies the constellation.'),
 'GPS Alternate Master Control Station': ('amcs', '1990s', 'Vandenberg SFB - the launch range is on the same base.'),
 'GPS Monitor Station - Cape Canaveral': ('both', '1980s', 'The Eastern Range: launch pads and the Space Force station.'),
 'GPS Monitor Station - Ascension': ('both', '1980s', 'The island\'s airfield and the Eastern Range downrange tracking site.'),
 'GPS Monitor Station - Diego Garcia': ('both', '1980s', 'The joint UK/US base and its Space Surveillance Telescope.'),
 'GPS Monitor Station - Kwajalein': ('both', '1980s', 'The Reagan Test Site radars, and the atoll SpaceX launched Falcon 1 from.'),
 'GPS Monitor Station - Hawaii': ('monitor', '1980s', None),
 'GPS Monitor Station - Fairbanks': ('monitor', '2005-06 (NGA stations joined the network)', 'The Alaska Satellite Facility\'s polar ground station.'),
 'GPS Monitor Station - Washington (USNO)': ('monitor', '2005-06', 'The US Naval Observatory Master Clock, which GPS time is steered against.'),
 'GPS Monitor Station - Quito': ('monitor', '2005-06', None),
 'GPS Monitor Station - Buenos Aires': ('monitor', '2005-06', None),
 'GPS Monitor Station - Hermitage': ('monitor', '2005-06', None),
 'GPS Monitor Station - Manama': ('monitor', '2005-06', None),
 'GPS Monitor Station - Osan': ('monitor', '2005-06', 'Osan Air Base.'),
 'GPS Monitor Station - Adelaide': ('monitor', '2005-06', None),
 'GPS Monitor Station - Wellington': ('monitor', '2005-06', None),
 'GPS Monitor Station - Papeete': ('monitor', '2005-06', None),
 'GPS Monitor Station - Hartebeesthoek': ('monitor', '2005-06', 'The HartRAO radio observatory, an SLR station and GLONASS equipment on the same hill.'),
 # ---- GLONASS ---------------------------------------------------------
 'GLONASS System Control Centre': ('mcs', '1982', 'Krasnoznamensk, the main Russian military space control centre.'),
 'GLONASS Station - Schelkovo': ('monitor', None, 'A satellite laser ranging station, which measures the orbits independently of radio.'),
 'GLONASS Station - St Petersburg': ('both', None, None),
 'GLONASS Station - Yenisejsk': ('both', None, 'A deep-space and satellite tracking complex.'),
 'GLONASS Station - Komsomolsk-on-Amur': ('both', None, 'A long-standing Russian tracking station.'),
 'GLONASS Station - Ussuriysk': ('monitor', None, 'A deep-space communications complex.'),
 'GLONASS Station - Yakutsk': ('monitor', None, None),
 'GLONASS Station - Vorkuta': ('monitor', None, None),
 'GLONASS Station - Nurek (Okno)': ('monitor', '2010s', 'The Okno optical space-surveillance complex, which watches high orbits.'),
 'GLONASS Station - Brasilia': ('monitor', '2013', 'The University of Brasilia campus; the first GLONASS station outside Russia.'),
 'GLONASS Station - Santa Maria': ('monitor', '2014', 'The Federal University of Santa Maria.'),
 'GLONASS Station - Hartebeesthoek': ('monitor', '2014', 'HartRAO, alongside the GPS monitor station and an SLR station.'),
 'GLONASS Station - Novolazarevskaya': ('monitor', '2015', 'The Russian Antarctic research base.'),
 # ---- Galileo ---------------------------------------------------------
 'Galileo Control Centre (Oberpfaffenhofen)': ('mcs', '2012', 'DLR\'s space operations centre, which also flies other missions.'),
 'Galileo Control Centre (Fucino)': ('mcs', '2010', 'The Fucino teleport, one of the largest civil satellite ground stations in the world.'),
 'Galileo Uplink Station - Kourou': ('uplink', '2010s', 'The Guiana Space Centre and ESA\'s Kourou tracking station.'),
 'Galileo Uplink Station - Reunion': ('uplink', '2010s', None),
 'Galileo Uplink Station - Noumea': ('uplink', '2010s', None),
 'Galileo Uplink Station - Papeete': ('uplink', '2010s', 'The GPS monitor station is on the same island.'),
 'Galileo Station - Svalbard': ('both', '2010s', 'KSAT\'s Svalbard ground station, the busiest polar teleport there is.'),
 'Galileo Sensor Station - Kiruna': ('sensor', '2010s', 'The Esrange complex: a sounding-rocket range and SSC\'s teleport.'),
 'Galileo Sensor Station - Jan Mayen': ('sensor', '2010s', None),
 'Galileo Sensor Station - Troll': ('sensor', '2013', 'Norway\'s Troll base and KSAT\'s Antarctic antennas.'),
 'Galileo Sensor Station - Azores': ('sensor', '2010s', 'The Santa Maria tracking station, also used by ESA.'),
 'Galileo Sensor Station - Maspalomas': ('sensor', '2010s', 'INTA\'s Maspalomas station, which also supports ESA and NASA passes.'),
 'Galileo Sensor Station - Kerguelen': ('sensor', '2010s', 'The French sub-Antarctic research base.'),
 'Galileo In-Orbit Test Site - Redu': ('iot', '2011', 'ESA\'s Redu centre, which also runs cyber-security and satellite test work.'),
 'Galileo GNSS Service Centre - Madrid': ('service', '2013', None),
 'Galileo Security Monitoring Centre - Saint-Germain': ('security', '2016', None),
 # ---- BeiDou ----------------------------------------------------------
 'BeiDou Master Control': ('mcs', '2000s', 'The Xi\'an Satellite Control Centre, which flies most Chinese spacecraft.'),
 'BeiDou Uplink Station - Kashgar': ('uplink', '2000s', 'A CLTC tracking station in the far west.'),
 'BeiDou Uplink Station - Jiamusi': ('uplink', '2000s', 'A 66 m deep-space antenna used for lunar and planetary missions.'),
 'BeiDou Uplink Station - Sanya': ('uplink', '2000s', 'Hainan tracking facilities near the Wenchang launch site.'),
 'BeiDou Station - Swakopmund': ('monitor', '2001', 'The CLTC tracking station that supported China\'s crewed flights.'),
 'BeiDou Station - Neuquen': ('monitor', '2017', 'The Espacio Lejano 35 m deep-space antenna.'),
 'BeiDou Station - Kiruna': ('monitor', '2010s', 'SSC\'s teleport, shared with Galileo and many other operators.'),
 # ---- QZSS ------------------------------------------------------------
 'QZSS Master Control Station': ('mcs', '2018 (service start)', 'Hitachi-Ota, with the main tracking and control antennas.'),
 'QZSS Tracking Station - Okinawa': ('both', '2010s', None),
 'QZSS Tracking Station - Sarobetsu': ('both', '2010s', None),
 'QZSS Monitoring Station - Guam': ('monitor', '2010s', None),
 'QZSS Monitoring Station - Hawaii': ('monitor', '2010s', None),
 'QZSS Monitoring Station - Bangkok': ('monitor', '2010s', None),
 'QZSS Monitoring Station - Canberra': ('monitor', '2010s', None),
 'QZSS Monitoring Station - Bengaluru': ('monitor', '2010s', None),
 # ---- NavIC -----------------------------------------------------------
 'NavIC Master Control Facility': ('mcs', '2013', 'Byalalu, which also hosts the Indian Deep Space Network dishes.'),
 'NavIC IRIMS - Hassan': ('monitor', '2013-15', 'ISRO\'s Master Control Facility for geostationary satellites.'),
 'NavIC IRIMS - Bhopal': ('monitor', '2013-15', None),
 'NavIC IRIMS - Jodhpur': ('monitor', '2013-15', None),
 'NavIC IRIMS - Lucknow': ('monitor', '2013-15', 'An ISTRAC tracking station.'),
 'NavIC IRIMS - Shillong': ('monitor', '2013-15', None),
 'NavIC IRIMS - Port Blair': ('monitor', '2013-15', 'An ISTRAC tracking station on the Andamans.'),
 'NavIC IRIMS - Dehradun': ('monitor', '2013-15', 'The Indian Institute of Remote Sensing.'),
 'NavIC IRIMS - Mahendragiri': ('monitor', '2013-15', 'ISRO\'s propulsion complex.'),
}

sites = json.load(io.open(P, encoding='utf-8'))
by = {s['n']: s for s in sites}
hit = miss = 0
for name, (fnkey, est, co) in DETAIL.items():
    s = by.get(name)
    if not s:
        print('  no marker named', name); miss += 1; continue
    s['fn'] = FN[fnkey]
    if est and not s.get('est'):
        s['est'] = est
    if co:
        s['co'] = co
    hit += 1
io.open(P, 'w', encoding='utf-8').write(json.dumps(sites, ensure_ascii=False, indent=1))
print('GNSS markers detailed: %d (missed %d)' % (hit, miss))
print('with a function: %d  with a date: %d  with co-located: %d'
      % (sum(1 for s in sites if s.get('fn')),
         sum(1 for s in sites if s['t'] == 'gnss' and s.get('est')),
         sum(1 for s in sites if s.get('co'))))
