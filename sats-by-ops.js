// Sats by Operator — same InstancedMesh engine as viz3d, but every sat
// is coloured by which named operator / constellation / mission family
// its TLE name matches.  Users toggle individual categories on / off
// from the left-panel checklist.

const { fetchTLEs, makeSatrecs, propagate, EARTH_R_KM } = window.Argos;

const $ = id => document.getElementById(id);
const REFRESH_MS    = 4000;
const CHUNK_SIZE    = 1500;
const MAX_INSTANCES = 22_000;
const SAT_RADIUS    = 1.6;        // matches viz3d's hover-friendly default

// =========================================================================
// Categories
//
// Order matters: the first .test() that matches wins, so put the more
// specific patterns (constellation names) before the broad ones (catch-
// alls).  Colours chosen to be distinct against the night-sky background
// and to roughly cluster by tier (greens for major LEO comms, blues for
// GNSS, reds for ISR, yellows for met).
// =========================================================================

const CATEGORIES = [
  // ----- GNSS constellations ---------------------------------------------
  { id: 'gnss-gps',     tier: 'GNSS',           label: 'GPS / NAVSTAR',           color: '#4a90e2', test: n => /^(NAVSTAR|GPS\s|GPS-)/i.test(n) },
  { id: 'gnss-glonass', tier: 'GNSS',           label: 'GLONASS',                 color: '#9b59b6', test: n => /^GLONASS\b/i.test(n) },
  { id: 'gnss-galileo', tier: 'GNSS',           label: 'Galileo',                 color: '#5fc7e6', test: n => /^GALILEO\b/i.test(n) || /^GSAT0\d/i.test(n) },
  { id: 'gnss-beidou',  tier: 'GNSS',           label: 'BeiDou',                  color: '#e74c3c', test: n => /^BEIDOU\b/i.test(n) },
  { id: 'gnss-qzss',    tier: 'GNSS',           label: 'QZSS (Japan)',            color: '#e67e22', test: n => /^QZS-/i.test(n) || /^QZSS\b/i.test(n) },
  { id: 'gnss-navic',   tier: 'GNSS',           label: 'NAVIC / IRNSS (India)',   color: '#27ae60', test: n => /^(IRNSS|NVS-)/i.test(n) },
  { id: 'gnss-centispace', tier: 'GNSS',        label: 'CentiSpace (China LEO PNT)', color: '#6c5ce7', test: n => /^CENTISPACE/i.test(n) },

  // ----- Mega-constellations / LEO comms ---------------------------------
  { id: 'op-starlink',  tier: 'Constellations', label: 'Starlink (SpaceX)',       color: '#67e8a4', test: n => /^STARLINK/i.test(n) },
  { id: 'op-oneweb',    tier: 'Constellations', label: 'Eutelsat OneWeb',         color: '#67c8ff', test: n => /^ONEWEB/i.test(n) },
  { id: 'op-kuiper',    tier: 'Constellations', label: 'Amazon Leo (ex-Kuiper)',  color: '#f39c12', test: n => /^KUIPER/i.test(n) },
  { id: 'op-iridium',   tier: 'Constellations', label: 'Iridium',                 color: '#bdc3c7', test: n => /^IRIDIUM/i.test(n) },
  { id: 'op-globalstar',tier: 'Constellations', label: 'Globalstar',              color: '#7f8c8d', test: n => /^GLOBALSTAR/i.test(n) },
  { id: 'op-orbcomm',   tier: 'Constellations', label: 'ORBCOMM',                 color: '#aab2bd', test: n => /^ORBCOMM/i.test(n) },
  { id: 'op-guowang',   tier: 'Constellations', label: 'Guowang / Xingwang (China)', color: '#ff7f50', test: n => /^(GUOWANG|HULIANWANG|XINGWANG|GW[- ])/i.test(n) },
  { id: 'op-qianfan',   tier: 'Constellations', label: 'Qianfan / G60 (China)',   color: '#ffa07a', test: n => /^(QIANFAN|G60)/i.test(n) },
  { id: 'op-kineis',    tier: 'Constellations', label: 'Kinéis (France IoT)',     color: '#2ecc71', test: n => /^KINEIS/i.test(n) },
  { id: 'op-spacemobile',tier: 'Constellations',label: 'AST SpaceMobile (D2C)',   color: '#a3e635', test: n => /^(SPACEMOBILE|BLUEWALKER|BLUEBIRD)/i.test(n) },
  { id: 'op-gonets',    tier: 'Constellations', label: 'Gonets (Russia)',         color: '#5fae8c', test: n => /^GONETS/i.test(n) },
  { id: 'op-geespace',  tier: 'Constellations', label: 'GeeSpace / Geely (China)', color: '#e6b800', test: n => /^GEESAT/i.test(n) },
  { id: 'op-tianqi',    tier: 'Constellations', label: 'Tianqi IoT (China)',      color: '#ff9e4a', test: n => /^TIANQI[- ]/i.test(n) },
  { id: 'op-sitro',     tier: 'Constellations', label: 'Sitronics SITRO-AIS (Russia)', color: '#7fd1b0', test: n => /^SITRO/i.test(n) },

  // ----- Earth observation companies -------------------------------------
  { id: 'eo-planet',    tier: 'Earth Obs',      label: 'Planet (Flock / SkySat)', color: '#16a085', test: n => /^(FLOCK|SKYSAT|PELICAN|TANAGER)/i.test(n) },
  { id: 'eo-spire',     tier: 'Earth Obs',      label: 'Spire (LEMUR)',           color: '#1abc9c', test: n => /^LEMUR/i.test(n) },
  { id: 'eo-maxar',     tier: 'Earth Obs',      label: 'Vantor — ex-Maxar (WorldView)', color: '#3498db', test: n => /^(WORLDVIEW|GEOEYE|MAXAR|QUICKBIRD|LEGION)/i.test(n) },
  { id: 'eo-blacksky',  tier: 'Earth Obs',      label: 'BlackSky',                color: '#5b6dcd', test: n => /^BLACKSKY/i.test(n) },
  { id: 'eo-capella',   tier: 'Earth Obs',      label: 'Capella Space (SAR)',     color: '#8e44ad', test: n => /^CAPELLA/i.test(n) },
  { id: 'eo-iceye',     tier: 'Earth Obs',      label: 'ICEYE (SAR)',             color: '#2980b9', test: n => /^ICEYE/i.test(n) },
  { id: 'eo-hawkeye',   tier: 'Earth Obs',      label: 'HawkEye 360 (RF)',        color: '#00b8d4', test: n => /^HAWK[- ]/i.test(n) },
  { id: 'eo-satellogic',tier: 'Earth Obs',      label: 'Satellogic (NuSat)',      color: '#26c6a8', test: n => /^(NUSAT|ÑUSAT)/i.test(n) },
  { id: 'eo-synspective',tier: 'Earth Obs',     label: 'Synspective (StriX SAR)', color: '#7e57c2', test: n => /^STRIX/i.test(n) },
  { id: 'eo-iqps',      tier: 'Earth Obs',      label: 'iQPS (QPS-SAR)',          color: '#9575cd', test: n => /^QPS-SAR/i.test(n) },
  { id: 'eo-unseenlabs',tier: 'Earth Obs',      label: 'Unseenlabs (BRO, RF)',    color: '#0097a7', test: n => /^BRO-/i.test(n) },
  { id: 'eo-iride',     tier: 'Earth Obs',      label: 'IRIDE (Italy)',           color: '#4dd0e1', test: n => /^IRIDE/i.test(n) },
  { id: 'eo-ghgsat',    tier: 'Earth Obs',      label: 'GHGSat (methane)',        color: '#66bb6a', test: n => /^GHGSAT/i.test(n) },
  { id: 'eo-superview', tier: 'Earth Obs',      label: 'SuperView / Gaojing (China)', color: '#5c9ce6', test: n => /^SUPERVIEW/i.test(n) },
  { id: 'eo-sentinel',  tier: 'Earth Obs',      label: 'Copernicus Sentinel (EU)', color: '#3d9970', test: n => /^SENTINEL/i.test(n) },

  // ----- Communications (mostly GEO) -------------------------------------
  { id: 'com-inmarsat', tier: 'Communications', label: 'Viasat / Inmarsat',       color: '#d35400', test: n => /^(INMARSAT|VIASAT)/i.test(n) },
  { id: 'com-intelsat', tier: 'Communications', label: 'Intelsat / Galaxy (SES Group)', color: '#c0392b', test: n => /^(INTELSAT|GALAXY )/i.test(n) },
  { id: 'com-eutelsat', tier: 'Communications', label: 'Eutelsat',                color: '#e74c3c', test: n => /^EUTELSAT/i.test(n) },
  { id: 'com-ses',      tier: 'Communications', label: 'SES / O3b',               color: '#f1c40f', test: n => /^(SES[- ]|ASTRA|O3B)/i.test(n) },
  { id: 'com-chinasat', tier: 'Communications', label: 'ChinaSat / Zhongxing',    color: '#c39bd3', test: n => /^(CHINASAT|ZHONGXING|ZX[- ])/i.test(n) },
  { id: 'com-apstar',   tier: 'Communications', label: 'APSTAR / AsiaSat',        color: '#d2b4de', test: n => /^(APSTAR|ASIASAT)/i.test(n) },
  { id: 'com-gsat',     tier: 'Communications', label: 'GSAT (India, ISRO/NSIL)', color: '#e59866', test: n => /^GSAT[- ]/i.test(n) },
  { id: 'com-echostar', tier: 'Communications', label: 'EchoStar / DirecTV / Dish (US DBS)', color: '#eb984e', test: n => /^(ECHOSTAR|DIRECTV|DISH )/i.test(n) },
  { id: 'com-express',  tier: 'Communications', label: 'Express (Russia, RSCC)',  color: '#cd6155', test: n => /^EXPRESS-/i.test(n) },

  // ----- Meteorology -----------------------------------------------------
  { id: 'met-noaa',     tier: 'Meteorology',    label: 'NOAA / GOES (USA)',       color: '#5dade2', test: n => /^(NOAA\s|GOES)/i.test(n) },
  { id: 'met-meteosat', tier: 'Meteorology',    label: 'METEOSAT / METOP (EU)',   color: '#48c9b0', test: n => /^(METEOSAT|METOP)/i.test(n) },
  { id: 'met-fengyun',  tier: 'Meteorology',    label: 'FengYun (China)',         color: '#ec7063', test: n => /^(FENGYUN|FY[- ])/i.test(n) },
  { id: 'met-himawari', tier: 'Meteorology',    label: 'Himawari (Japan)',        color: '#f5b041', test: n => /^HIMAWARI/i.test(n) },
  { id: 'met-insat',    tier: 'Meteorology',    label: 'INSAT / KALPANA (India)', color: '#52be80', test: n => /^(INSAT|KALPANA)/i.test(n) },

  // ----- Publicly attributed ISR -----------------------------------------
  { id: 'isr-yaogan',   tier: 'ISR',            label: 'Yaogan (China)',          color: '#ff6b6b', test: n => /^YAOGAN/i.test(n) },
  { id: 'isr-gaofen',   tier: 'ISR',            label: 'Gaofen (China)',          color: '#ff8c52', test: n => /^GAOFEN/i.test(n) },
  { id: 'isr-jilin',    tier: 'ISR',            label: 'Jilin (China)',           color: '#ffaa6b', test: n => /^JILIN/i.test(n) },
  { id: 'isr-usa',      tier: 'ISR',            label: 'USA-series (US classified)', color: '#bd1a1a', test: n => /^USA\s*\d/i.test(n) },
  { id: 'isr-sda',      tier: 'ISR',            label: 'SDA Tranche (US military)', color: '#cb4335', test: n => /^(SDA[ _-]?\d|PRAETORIAN)/i.test(n) },
  { id: 'isr-cosmos',   tier: 'ISR',            label: 'Cosmos (Russia)',         color: '#76448a', test: n => /^COSMOS\s*\d/i.test(n) },

  // ----- Catch-all -------------------------------------------------------
  // Default OFF so the ~10 k uncategorised dots don't drown out the
  // labelled categories on first paint.
  { id: 'other',        tier: 'Other',          label: 'Other / uncategorised',   color: '#7d8a99', defaultOff: true, test: () => true },
];

function categorize(name) {
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].test(name)) return i;
  }
  return CATEGORIES.length - 1;
}

// =========================================================================
// Operator dossiers — shown in the click-through pop-up.  Keyed by the
// category `id`.  `fleet` = total operated to date, `active` = roughly how
// many are working now, `retired` = de-orbited / decommissioned / dead.
// `note` explains why the live-globe dot count can be lower than the real
// fleet.  Figures compiled from open sources, late 2025 / early 2026.
// =========================================================================

const COMPANY_INFO = {
  // ---- GNSS (government systems) ----
  'gnss-gps': {
    name: 'GPS / NAVSTAR', operator: 'U.S. Space Force', founded: '1978 (full service 1995)',
    fleet: '~78 launched across Blocks I–III', active: '31 operational', retired: 'Block I/II/IIA/IIR units decommissioned',
    desc: 'The United States’ global navigation system — free positioning, navigation and timing worldwide, run by the US Space Force (Space Systems Command).',
    news: 'GPS III / IIIF modernisation ongoing; newest GPS III space vehicles launched on Falcon 9 / Vulcan.',
    note: 'GPS deliberately keeps ~31 healthy birds; retired NAVSTARs leave the active catalogue, so the dot count stays near the operational baseline.' },
  'gnss-glonass': {
    name: 'GLONASS', operator: 'Roscosmos (Russia)', founded: '1982 (restored 2011)',
    fleet: '130+ launched since 1982', active: '~24 operational', retired: 'Most first- and second-gen units decayed',
    desc: 'Russia’s global navigation constellation in three MEO planes. GLONASS-K/K2 satellites are the current modernisation.',
    news: 'GLONASS-K2 launches continuing to refresh the fleet.' },
  'gnss-galileo': {
    name: 'Galileo', operator: 'EUSPA / ESA (European Union)', founded: '2011 (first launch)',
    fleet: '~30 launched', active: '~24 operational + spares', retired: 'Two early IOV/GIOVE test sats retired',
    desc: 'The EU’s civil-controlled GNSS — the most accurate open positioning signal available. Second-generation (G2) satellites are in build.',
    news: 'Galileo Second Generation (G2-G) satellites ordered; constellation being completed to full 24+spares.',
    note: 'Galileo satellites are catalogued under their build designation “GSAT0101 …”, so most appear as “GSAT0xxx” rather than “GALILEO” — this category folds both spellings in.' },
  'gnss-beidou': {
    name: 'BeiDou (BDS)', operator: 'CSNO (China)', founded: '2000 (BDS-3 global 2020)',
    fleet: '~60 launched across BDS-1/2/3', active: '~45 operational', retired: 'BDS-1 and early BDS-2 units retired',
    desc: 'China’s GNSS across GEO, IGSO and MEO. BDS-3 completed global service in 2020.',
    news: 'Next-generation BeiDou design finalised in 2025; test satellites due 2027, full fleet by 2035.' },
  'gnss-qzss': {
    name: 'QZSS (Michibiki)', operator: 'QSS / Cabinet Office (Japan)', founded: '2010 (QZS-1)',
    fleet: '~5 launched', active: '4 operational', retired: 'QZS-1 (original) replaced',
    desc: 'Japan’s regional GPS-augmentation system in inclined geosynchronous + GEO orbits, optimised for high-elevation coverage over Japan.',
    news: 'Expanding from 4 to a 7-satellite autonomous constellation by the late 2020s.' },
  'gnss-navic': {
    name: 'NavIC / IRNSS', operator: 'ISRO (India)', founded: '2013 (IRNSS-1A)',
    fleet: '~11 launched', active: '7–8 operational', retired: 'IRNSS-1A (atomic-clock failure) retired',
    desc: 'India’s regional navigation system over the subcontinent. NVS-series (NVS-01/-02) are the modernised second generation.',
    news: 'NVS-series replacing first-gen IRNSS birds with L1 civil signals.' },
  'gnss-centispace': {
    name: 'CentiSpace (未来导航)', operator: 'Beijing Future Navigation Technology (China)', founded: '2018 (first test satellites)',
    fleet: '~33 launched', active: '~30 operational', retired: 'Early CentiSpace-1 test units',
    desc: 'A Chinese LEO navigation-augmentation constellation that broadcasts correction signals to sharpen GPS/BeiDou/Galileo positioning from metres toward centimetres — a low-orbit PNT enhancement layer rather than a standalone GNSS.',
    news: 'Multiple 2024–25 batches expanding toward a planned ~160-satellite constellation.',
    note: 'Augmentation birds named “CENTISPACE-…”; they enhance existing GNSS rather than replace it.' },

  // ---- LEO mega-constellations ----
  'op-starlink': {
    name: 'Starlink', operator: 'SpaceX (USA)', founded: '2019 (first operational launch)',
    fleet: '~10,000+ launched', active: '~9,350 operational (Dec 2025)', retired: '~1,000+ de-orbited (routine ~5-yr replacement)',
    desc: 'By far the largest satellite constellation ever built — SpaceX’s LEO broadband network. ~2,500 satellites launched in 2025 alone across 140+ flights.',
    news: 'Direct-to-Cell service scaling with carriers; larger V3 satellites planned for Starship.',
    note: 'The globe shows most of these, but the shared "active" catalogue and this page’s instance cap can trim the very newest batches.' },
  'op-oneweb': {
    name: 'Eutelsat OneWeb', operator: 'Eutelsat Group', founded: '2012 (merged with Eutelsat, Sept 2023)',
    fleet: '~656 Gen-1 launched', active: '~630 operational', retired: 'A handful of early failures',
    desc: 'A 648-satellite first-generation LEO broadband network, now the LEO layer of Eutelsat’s multi-orbit (GEO+LEO) offering after the 2023 merger.',
    news: 'Ordered 340 next-gen OneWeb satellites from Airbus (2025–26) toward a ~1,040-sat constellation.' },
  'op-kuiper': {
    name: 'Amazon Leo', operator: 'Amazon (USA)', founded: '2019 as Project Kuiper (rebranded Amazon Leo, Nov 2025)',
    fleet: '~375+ launched', active: 'ramping toward 3,236 licensed', retired: '2 prototypes de-orbited',
    desc: 'Amazon’s LEO broadband constellation, rebranded from "Project Kuiper" in November 2025. Must place half of its 3,236 licensed satellites in service by July 2026 (FCC).',
    news: 'Rebrand to Amazon Leo + commercial-service debut and terminal line-up unveiled late 2025.',
    note: 'Named "KUIPER-…" in the catalogue and still early in deployment, so the count climbs fast between refreshes.' },
  'op-iridium': {
    name: 'Iridium', operator: 'Iridium Communications (USA)', founded: '1997 (Iridium NEXT 2017–19)',
    fleet: '~80 NEXT deployed (of 81 built) + 95 original 1st-gen', active: '66 operational + ~14 on-orbit spares', retired: 'Entire 1st-gen constellation de-orbited by 2019',
    desc: 'The only truly pole-to-pole, cross-linked LEO voice/data network — L-band phones, IoT and aviation safety services.',
    news: 'Rocket Lab agreed to acquire Iridium for ~$8B (announced 2026).' },
  'op-globalstar': {
    name: 'Globalstar', operator: 'Globalstar, Inc. (USA)', founded: '1991',
    fleet: '~90+ launched across two generations', active: '~31 L-band', retired: 'Most 1st-gen units retired',
    desc: 'Mobile-satellite voice + IoT operator. Powers Apple iPhone Emergency SOS / satellite messaging.',
    news: 'Apple committed ~$1.7B (incl. a 20% stake) to fund a new MDA-built constellation; ~85% of new capacity reserved for Apple.' },
  'op-orbcomm': {
    name: 'ORBCOMM', operator: 'ORBCOMM Inc. (USA, private)', founded: '1993',
    fleet: 'OG2: 62 launched', active: '~61 in orbit', retired: 'OG1 first-gen retired',
    desc: 'The first LEO network built exclusively for IoT / machine-to-machine — 2.4M+ subscribers in transport, maritime, energy and agriculture.',
    news: 'Taken private by GI Partners (2021); OGx high-throughput IoT service now live.' },
  'op-guowang': {
    name: 'Guowang / Xingwang (国网)', operator: 'China Satellite Network Group (SatNet)', founded: '2021 (first launch Dec 2024)',
    fleet: '~180+ launched (2024–2026)', active: '~180 in orbit', retired: '—',
    desc: 'China’s state-backed ~13,000-satellite LEO broadband constellation, with assessed PNT / imaging / SIGINT side-functions — the larger of China’s two flagship LEO networks by count.',
    news: 'Rapid 2025–26 build-out across many launches; individual spacecraft are the "Hulianwang Weixing Digui" (HWD) / Xingwang Digui satellites.',
    note: 'Catalogued mostly under the Chinese descriptors “HULIANWANG DIGUI” (互联网低轨, “internet low-orbit”) and “HULIANWANG JISHU SHIYAN” (internet-technology test), plus a few “GUOWANG” test objects — this category now folds all of them together, which is why the live count is much higher than the old “GUOWANG”-only match.' },
  'op-qianfan': {
    name: 'Qianfan / G60 (Thousand Sails)', operator: 'Shanghai Spacecom (SSST)', founded: '2024',
    fleet: '~200 launched by 2026', active: '~200', retired: '—',
    desc: 'Shanghai-backed commercial LEO broadband "Starlink rival" — Phase 1 of 1,296 satellites, 15,000+ planned.',
    news: 'Deployment paced by early-batch issues; still one of China’s two flagship mega-constellations.' },
  'op-kineis': {
    name: 'Kinéis', operator: 'Kinéis (France)', founded: '2018 (spun out of CLS; Argos heritage from 1978)',
    fleet: '25 launched', active: '25 operational', retired: '—',
    desc: 'A French 25-satellite nanosatellite constellation for global Internet-of-Things connectivity and continuation of the Argos environmental / wildlife-tracking system that has run since 1978.',
    news: 'Constellation completed across five Rocket Lab Electron launches in 2024–25.',
    note: 'A small dedicated IoT fleet named “KINEIS-…”, so expect ~25 dots, not thousands.' },
  'op-spacemobile': {
    name: 'AST SpaceMobile', operator: 'AST SpaceMobile (USA)', founded: '2017',
    fleet: '~6 launched (BlueWalker 3 + BlueBird)', active: '~6', retired: '—',
    desc: 'Building a space-based cellular broadband network that connects directly to ordinary smartphones ("direct-to-cell") using very large phased-array satellites — partnered with AT&T, Verizon and Vodafone.',
    news: 'BlueWalker 3 test satellite (2022); first five commercial BlueBird satellites launched Sept 2024, with larger Block-2 birds to follow.',
    note: 'Catalogued as “SPACEMOBILE-…”, “BLUEBIRD” and “BLUEWALKER-3”. Few but huge satellites, so only a handful of dots appear.' },
  'op-gonets': {
    name: 'Gonets (Гонец)', operator: 'JSC Gonets / Roscosmos (Russia)', founded: '1996 (civil service)',
    fleet: '~40+ launched across two generations', active: '~23 Gonets-M', retired: 'First-generation Gonets-D units retired',
    desc: 'Russia’s low-data-rate store-and-forward LEO messaging system — the civil sibling of the military Strela constellation — used for telemetry, dispatch and remote-area comms.',
    news: 'Gonets-M fleet periodically replenished; a next-generation "Gonets-M1" system is planned.' },
  'op-geespace': {
    name: 'GeeSpace (Geely)', operator: 'Zhejiang Geely Holding (China)', founded: '2018 (Geespace); first launch 2022',
    fleet: '~63 launched', active: '~60 operational', retired: '—',
    desc: 'The "Geely Future Mobility Constellation" (GeeSAT) — a commercial LEO network providing high-precision positioning and communications for autonomous vehicles and consumer devices, built by carmaker Geely.',
    news: 'Second 11-satellite batch and beyond through 2025; near-term target ~72, long-term plan 5,676 satellites.' },
  'op-tianqi': {
    name: 'Tianqi (天启)', operator: 'Guodian Gaoke (China)', founded: '2015',
    fleet: '~30 launched', active: '~30 operational', retired: 'A few early units',
    desc: 'China’s "Apocalypse/Tianqi" narrowband IoT and data-relay constellation — short-message and machine-to-machine connectivity for sensors, transport and industry.',
    news: 'Constellation approaching its ~38-satellite target.',
    note: 'Named “TIANQI-…” (distinct from the “TianQin” gravitational-wave craft).' },
  'op-sitro': {
    name: 'Sitronics SITRO-AIS', operator: 'Sitronics Space (Russia)', founded: '2020',
    fleet: '~47 launched', active: '~47 in orbit', retired: '—',
    desc: 'A Russian nanosatellite constellation tracking ships via their AIS (Automatic Identification System) transponders — maritime traffic monitoring sold as a data service — the largest single Russian commercial fleet by count.',
    news: 'Rapidly grew past 40 satellites in 2024–25 toward a planned ~100+ Earth-monitoring network.' },

  // ---- Earth observation ----
  'eo-planet': {
    name: 'Planet Labs PBC', operator: 'Planet Labs (San Francisco)', founded: '2010',
    fleet: '~600+ launched — the largest EO fleet ever flown', active: '~150+ (Dove/SuperDove flock + ~21 SkySat + Pelican + Tanager)', retired: 'Hundreds of early Doves re-entered (~3-yr design life)',
    desc: 'Images the entire landmass daily with a "line-scanner" flock of ~3 m Doves, plus ~0.5 m SkySats, new high-res Pelican, and hyperspectral Tanager.',
    news: 'First profitable year; Pelican-2 and Tanager-1 online; large multi-year defence backlog.',
    note: 'Doves are named "FLOCK 4x-nn" and SkySats "SKYSAT-…". Because Doves retire every ~3 years, the live count is far below the ~600 ever launched.' },
  'eo-spire': {
    name: 'Spire Global', operator: 'Spire Global, Inc. (USA)', founded: '2012',
    fleet: '~199 LEMUR launched', active: '100+ multipurpose', retired: 'Many early LEMURs re-entered',
    desc: 'Nanosatellite constellation tracking ships (AIS), aircraft (ADS-B) and gathering GPS radio-occultation weather data, sold as data-as-a-service.',
    news: 'Demonstrated two-way optical inter-satellite links; refocusing on data + space-services.' },
  'eo-maxar': {
    name: 'Vantor (formerly Maxar Intelligence)', operator: 'Vantor', founded: 'Maxar 2017; rebranded Vantor, 1 Oct 2025',
    fleet: 'operates ~10 imaging satellites', active: '4 legacy electro-optical (WorldView/GeoEye) + 6 WorldView Legion', retired: 'QuickBird, WorldView-1 heritage & EarlyBird re-entered',
    desc: 'High-resolution (~30 cm) optical Earth imagery. Maxar was taken private by Advent (2023) and split on 1 Oct 2025 into Vantor (imagery) and Lanteris Space Systems (satellite manufacturing).',
    news: 'Rebranded to Vantor and launched the "TensorGlobe" AI spatial-intelligence platform (Oct 2025).',
    note: 'Vantor is a high-resolution imaging company, NOT a mega-constellation — it flies only ~10 satellites, so expect a handful of dots, not thousands. On the globe they read as WORLDVIEW-…, GEOEYE-1 and WORLDVIEW LEGION-…; the old QuickBird / EarlyBird craft re-entered years ago.' },
  'eo-blacksky': {
    name: 'BlackSky', operator: 'BlackSky Technology (USA)', founded: '2014',
    fleet: '~20+ launched', active: '~14 Gen-2 + 3 Gen-3 (late 2025)', retired: 'Several early Gen-1/2 units retired',
    desc: 'Rapid-revisit sub-metre optical imaging plus the Spectra AI analytics platform; dawn-to-dusk monitoring for defence and intelligence.',
    news: 'Gen-3 satellites (~35 cm) brought into service within weeks of launch; strong government contracts.',
    note: 'A focused ~17-satellite fleet — small by design, so only a cluster of dots appears.' },
  'eo-capella': {
    name: 'Capella Space', operator: 'Capella Space (USA)', founded: '2016',
    fleet: '~20 launched (constellation target 36)', active: '~a dozen operational', retired: 'Early "Whitney" units retired',
    desc: 'US commercial X-band Synthetic-Aperture Radar — all-weather, day-and-night imaging that sees through cloud and darkness.',
    news: 'Continuing to replenish/expand with newer Acadia-class SAR satellites.',
    note: 'A small SAR fleet named "CAPELLA-…"; only the current operational birds appear.' },
  'eo-iceye': {
    name: 'ICEYE', operator: 'ICEYE (Finland)', founded: '2014',
    fleet: '60+ launched since 2018 (world’s largest SAR constellation)', active: '~40 operational', retired: 'Earliest X-band units retired',
    desc: 'X-band SAR for flood, disaster and defence monitoring — also builds and sells dedicated satellites to sovereign customers.',
    news: 'Fourth-generation (Gen4) SAR with ~16 cm resolution; 22 satellites launched in 2025.',
    note: 'Many ICEYE craft are owned by customer/sovereign missions and can be catalogued under other names, so the "ICEYE-…" dots undercount the fleet ICEYE actually built.' },
  'eo-hawkeye': {
    name: 'HawkEye 360', operator: 'HawkEye 360 (USA)', founded: '2015',
    fleet: '~39 launched', active: '~30+ operational', retired: 'Pathfinder trio retired',
    desc: 'Commercial radio-frequency (RF) intelligence — detects and geolocates radio emitters (ships going "dark", GPS interference, emergency beacons) by flying satellites in tightly-spaced clusters of three that triangulate signals.',
    news: 'Successive "Cluster" launches building toward ~60 satellites; strong defence/maritime-domain demand.',
    note: 'Named “HAWK-…” and flown in threes, so the dots cluster in trios.' },
  'eo-satellogic': {
    name: 'Satellogic', operator: 'Satellogic (Argentina / USA)', founded: '2010',
    fleet: '~40+ launched', active: '~19 operational', retired: 'Early ÑuSat units retired',
    desc: 'Vertically-integrated sub-metre optical + hyperspectral Earth imaging, aiming to remap the whole planet at high frequency and low cost. Its satellites are named "ÑuSat / NuSat" (a.k.a. NewSat).',
    news: 'Went public via SPAC in 2022; scaling toward a planned ~200-satellite constellation.',
    note: 'Catalogued as “NUSAT-nn (name)”.' },
  'eo-synspective': {
    name: 'Synspective', operator: 'Synspective (Japan)', founded: '2018',
    fleet: '~8 launched', active: '~8 operational', retired: '—',
    desc: 'Japanese small synthetic-aperture-radar (SAR) company imaging through cloud and darkness for disaster response, infrastructure monitoring and land-deformation ("StriX" satellites).',
    news: 'Regular StriX launches (several on Rocket Lab Electron) building toward a 30-satellite constellation.',
    note: 'Named “STRIX-…”.' },
  'eo-iqps': {
    name: 'iQPS', operator: 'Institute for Q-shu Pioneers of Space (Japan)', founded: '2005',
    fleet: '~9 launched', active: '~7 operational', retired: 'Earliest QPS-SAR units',
    desc: 'A Kyushu-based SAR company whose lightweight satellites carry a large deployable mesh antenna for ~0.5–1 m radar imaging, day or night, through cloud ("QPS-SAR").',
    news: 'Ramping launches (Electron / H3) toward a planned 36-satellite constellation.',
    note: 'Named “QPS-SAR-n (name)”.' },
  'eo-unseenlabs': {
    name: 'Unseenlabs', operator: 'Unseenlabs (France)', founded: '2015',
    fleet: '~16 launched', active: '~13 operational', retired: 'Earliest BRO units',
    desc: 'European RF-based maritime surveillance — detects, characterises and geolocates ships by the radio signals they emit, independent of AIS, for fisheries, security and anti-piracy ("BRO" — Breizh Reconnaissance Orbiter).',
    news: 'Steady BRO launches expanding revisit; a European counterpart to HawkEye 360.',
    note: 'Named “BRO-…”.' },
  'eo-iride': {
    name: 'IRIDE', operator: 'Italy (ASI / ESA, EU-funded)', founded: '2023 (programme funded)',
    fleet: '~31 launched (deploying)', active: 'ramping through 2025–26', retired: '—',
    desc: 'A national multi-sensor Earth-observation constellation for Italy — optical, SAR and hyperspectral satellites in several sub-constellations — funded by Italy’s PNRR recovery plan and procured via ESA from a domestic industry consortium.',
    news: 'First IRIDE satellites reached orbit in 2025; the full constellation completes 2025–26.',
    note: 'Named “IRIDE-…”; a government EO system, not a commercial operator.' },
  'eo-ghgsat': {
    name: 'GHGSat', operator: 'GHGSat (Canada)', founded: '2011',
    fleet: '~12 launched', active: '~10 operational', retired: 'GHGSat-D "Claire" demo retired',
    desc: 'Commercial high-resolution greenhouse-gas monitoring from space — pinpoints methane (and CO₂) emissions from individual industrial sites for energy, regulators and carbon-tracking ("GHGSat-C / Vanguard").',
    news: 'Expanding the "Vanguard" microsat fleet to sharpen global methane detection.',
    note: 'A niche but distinctive EO fleet named “GHGSAT-…”.' },
  'eo-superview': {
    name: 'SuperView / Gaojing (高景)', operator: 'China Siwei / Beijing Space View (China)', founded: '2016',
    fleet: '~13 launched', active: '~13 operational', retired: 'A few early units',
    desc: 'China’s commercial sub-metre optical imaging constellation — SuperView-1 (0.5 m) and the higher-resolution SuperView Neo — sold as commercial satellite imagery by state-linked China Siwei.',
    news: 'SuperView Neo batches added sharper optical capacity through the 2020s.',
    note: 'Named “SUPERVIEW-…” / “SUPERVIEW NEO-…”.' },
  'eo-sentinel': {
    name: 'Copernicus Sentinel', operator: 'ESA / European Union', founded: '2014 (Sentinel-1A)',
    fleet: '~14 launched across the families', active: '~11 operational', retired: 'Sentinel-1B (2022 power failure) retired',
    desc: 'The satellite backbone of the EU’s Copernicus programme — the world’s largest free-and-open Earth-observation data source: Sentinel-1 (radar), -2 (optical), -3 (ocean/land), -5P (air quality) and -6 (sea-level altimetry).',
    news: 'Sentinel-1C launched Dec 2024 to restore the radar pair; next-generation "Expansion" missions in build.',
    note: 'A government science programme named “SENTINEL-…”, not a commercial operator.' },

  // ---- Communications (mostly GEO) ----
  'com-inmarsat': {
    name: 'Viasat / Inmarsat', operator: 'Viasat, Inc. (USA)', founded: 'Inmarsat 1979; acquired by Viasat May 2023',
    fleet: '~20 GEO satellites', active: '~19 (Ka-, L- and S-band)', retired: 'Older Inmarsat-2/3 units retired',
    desc: 'Global mobile + broadband connectivity for aviation, maritime, government and safety-of-life services. Inmarsat is now Viasat’s L/S-band arm.',
    news: 'ViaSat-3 F2/F3 high-capacity satellites rolling out to complete global Ka-band coverage.',
    note: 'A GEO operator — a couple of dozen big satellites parked over the equator, so only a thin arc of dots shows.' },
  'com-intelsat': {
    name: 'Intelsat / Galaxy', operator: 'SES Group (Luxembourg)', founded: 'Intelsat 1964; merged into SES, July 2025',
    fleet: '100+ Intelsat satellites over its history', active: '~50 GEO (now within SES)', retired: 'Dozens of legacy Intelsat birds retired',
    desc: 'One of the oldest and largest GEO operators. SES completed its ~$3.1B acquisition of Intelsat on 17 July 2025, creating a ~120-satellite multi-orbit operator.',
    news: 'SES–Intelsat merger closed July 2025; some planned GEO expansion satellites were cancelled.',
    note: 'GEO fleet — a few dozen satellites on the geostationary belt, so expect a sparse ring rather than a swarm. Includes Intelsat’s “GALAXY” North-American broadcast satellites, which are catalogued under that name rather than “INTELSAT”.' },
  'com-eutelsat': {
    name: 'Eutelsat', operator: 'Eutelsat Group (France)', founded: '1977',
    fleet: '~31 GEO satellites', active: '~31 GEO + Eutelsat OneWeb LEO', retired: 'Many first-gen Eutelsat/Hot Bird craft retired',
    desc: 'European GEO broadcaster (TV/broadband), now a multi-orbit operator via its Eutelsat OneWeb LEO layer.',
    news: 'Brand unified in 2025; French-state-backed recapitalisation to fund OneWeb Gen-2.',
    note: 'Its ~31 GEO birds sit on the equatorial belt; the OneWeb LEO sats are counted separately above.' },
  'com-ses': {
    name: 'SES / O3b', operator: 'SES S.A. (Luxembourg)', founded: '1985',
    fleet: '~120 satellites (after the 2025 Intelsat merger)', active: '~90 GEO + ~30 MEO (O3b / O3b mPOWER)', retired: 'Many Astra/legacy GEO units retired',
    desc: 'GEO broadcast + a unique MEO data layer (O3b / O3b mPOWER). Acquired Intelsat in 2025 to become one of the largest operators outside the LEO mega-constellations.',
    news: 'Integrating Intelsat; expanding O3b mPOWER MEO capacity.',
    note: 'Split between the GEO belt and the ~8,000 km MEO O3b ring — two thin bands, not a dense shell.' },
  'com-chinasat': {
    name: 'ChinaSat / Zhongxing', operator: 'China Satcom', founded: '1985 (China Satcom)',
    fleet: '30+ satellites launched', active: '~20+ GEO', retired: 'Older Zhongxing/DFH craft retired',
    desc: 'China’s state GEO backbone for TV/radio, broadband, emergency and (under cover designations) military communications.',
    news: 'ChinaSat-10R (Feb 2025) and ChinaSat-9C (Jun 2025) refreshed broadcast capacity.',
    note: 'GEO operator — a couple dozen satellites on the belt.' },
  'com-apstar': {
    name: 'APSTAR / AsiaSat', operator: 'APT Satellite / AsiaSat (Hong Kong)', founded: 'AsiaSat 1988; APT 1992',
    fleet: '~20 satellites over their history', active: '~10 GEO', retired: 'Early AsiaSat/APStar craft retired',
    desc: 'Hong Kong-based commercial GEO operators leasing C/Ku/Ka capacity across Asia-Pacific and beyond.',
    note: 'GEO fleet — only a handful of active satellites on the equatorial belt.' },
  'com-gsat': {
    name: 'GSAT (India)', operator: 'ISRO / NewSpace India Ltd', founded: '2001 (GSAT-1)',
    fleet: '~24 GSAT launched', active: '~17 GEO', retired: 'Several early GSAT birds retired',
    desc: 'India’s geostationary communications fleet — television, broadband and secure/defence links (e.g. the GSAT-7 "Rukmini" naval satellite, GSAT-N2/-24 high-throughput broadband), now commercialised through NewSpace India Ltd.',
    news: 'GSAT-N2 (2024, launched on Falcon 9) and GSAT-N3 add Ka-band broadband capacity.',
    note: 'GEO fleet named “GSAT-…”. Galileo’s satellites share a “GSAT0xxx” designation but are grouped under Galileo above, not here.' },
  'com-echostar': {
    name: 'EchoStar / DirecTV / Dish', operator: 'EchoStar Corp + DirecTV (USA)', founded: 'DBS service from the mid-1990s',
    fleet: '~30+ launched across the operators', active: '~18 GEO', retired: 'Many early EchoStar/DirecTV birds retired',
    desc: 'The big US direct-broadcast-satellite (DBS) television and broadband fleets — EchoStar/Dish and DirecTV — parked on the geostationary belt beaming TV to home dishes across North America.',
    news: 'Dish and EchoStar re-merged as EchoStar Corp in 2023; the industry is shifting from linear TV toward streaming + direct-to-device.',
    note: 'GEO broadcasters named “ECHOSTAR …”, “DIRECTV …” and “DISH …” — a couple dozen satellites on the belt.' },
  'com-express': {
    name: 'Express (Экспресс)', operator: 'RSCC — Russian Satellite Communications Company', founded: '1994',
    fleet: '~30 Express launched over its history', active: '~18 GEO', retired: 'Early Express / Express-A units retired',
    desc: 'Russia’s civil geostationary communications backbone — TV/radio distribution, telephony, broadband and government links across Russia and neighbouring regions (Express-AM / AMU / AT series).',
    news: 'Express-AMU and Express-RV (highly-elliptical) satellites refreshing coverage, including the Arctic.',
    note: 'State GEO fleet named “EXPRESS-…”.' },

  // ---- Meteorology (government agencies) ----
  'met-noaa': {
    name: 'NOAA / GOES', operator: 'NOAA NESDIS (USA)', founded: '1975 (first GOES)',
    fleet: '~40 GOES + POES/JPSS since the 1970s', active: 'GOES-16/18/19 (GEO) + Suomi NPP, NOAA-20/21 (polar)', retired: 'POES fully retired in Aug 2025',
    desc: 'US civil weather satellites — geostationary GOES for continuous hemispheric imaging plus the polar JPSS series.',
    news: 'The legacy POES constellation was decommissioned in 2025 (NOAA-15/18/19 shut down); JPSS now carries the polar mission.',
    note: 'Some "NOAA-xx" dots you might remember are gone — NOAA-15, -18 and -19 were decommissioned in mid-2025.' },
  'met-meteosat': {
    name: 'Meteosat / MetOp', operator: 'EUMETSAT (Europe)', founded: '1977 (first Meteosat)',
    fleet: '~20 Meteosat + MetOp since 1977', active: 'Meteosat-9/10/11 + Meteosat-12 (MTG) + MetOp-B/-C', retired: 'First-generation Meteosats retired',
    desc: 'Europe’s weather satellites — geostationary Meteosat plus polar-orbiting MetOp, operated by EUMETSAT.',
    news: 'Meteosat Third Generation ramping up: MTG-I1 (Meteosat-12) operational; MTG-S1 sounder launched July 2025.' },
  'met-fengyun': {
    name: 'FengYun', operator: 'China Meteorological Administration', founded: '1988 (FY-1A)',
    fleet: '~20 launched across FY-1/2/3/4', active: 'FY-3 polar + FY-4 GEO series', retired: 'FY-1 and early FY-2 retired',
    desc: 'China’s operational weather fleet — polar (FY-3) and geostationary (FY-4) — with data shared internationally via the WMO.',
    news: 'FY-3H afternoon-orbit satellite launched Sept 2025; FY-4C GEO imager launched Dec 2025.' },
  'met-himawari': {
    name: 'Himawari', operator: 'Japan Meteorological Agency', founded: '1977',
    fleet: '~9 Himawari/GMS since 1977', active: 'Himawari-8 / Himawari-9 (GEO)', retired: 'GMS + Himawari-1..7 retired',
    desc: 'Japan’s geostationary weather satellites covering the Asia-Pacific and western Pacific.',
    news: 'Himawari-10 in preparation to succeed the current pair later this decade.' },
  'met-insat': {
    name: 'INSAT / Kalpana', operator: 'ISRO / IMD (India)', founded: '1982 (INSAT-1A)',
    fleet: '~20 INSAT/GSAT with met payloads', active: 'INSAT-3D/3DR/3DS + Kalpana heritage', retired: 'INSAT-1/2 series retired',
    desc: 'India’s multipurpose GEO satellites carrying weather imagers/sounders alongside communications payloads.',
    news: 'INSAT-3DS launched 2024 to continue the meteorology mission.' },

  // ---- ISR / classified ----
  'isr-yaogan': {
    name: 'Yaogan (遥感)', operator: 'PLA (China)', founded: '2006',
    fleet: '100+ launched', active: 'Dozens operational', retired: 'Early Yaogan units retired',
    desc: 'China’s primary military reconnaissance fleet — optical, SAR and electronic-intelligence satellites, often flown in three-satellite ocean-surveillance clusters.',
    news: 'Yaogan-40 triplet clusters launched through 2025 for "electromagnetic environment" (naval-tracking) missions.' },
  'isr-gaofen': {
    name: 'Gaofen (高分)', operator: 'CNSA / CASC (China)', founded: '2013',
    fleet: '~30+ launched', active: 'GF-1..7 civil + higher-numbered dual-use', retired: 'A few early units retired',
    desc: 'China’s High-Resolution Earth Observation System (CHEOS) — optical, SAR, hyperspectral and a geostationary starer (GF-4).',
    news: 'Higher-numbered GF-11/12/14 craft are dual-use and far less publicised.' },
  'isr-jilin': {
    name: 'Jilin-1', operator: 'Chang Guang (CGSTL, China)', founded: '2014',
    fleet: '~140 launched', active: '117+ operational', retired: 'A few early units retired',
    desc: 'China’s largest commercial EO constellation — sub-metre optical, video, hyperspectral and infrared imaging.',
    news: 'Targeting 300 satellites; ~6× global / 24× over-China revisit.' },
  'isr-usa': {
    name: 'USA-series (classified)', operator: 'U.S. NRO / Space Force', founded: '1984 (USA-1)',
    fleet: '300+ "USA-nnn" designations to date', active: 'Not disclosed', retired: 'Not disclosed',
    desc: 'A catch-all designation for classified US payloads — NRO reconnaissance, missile-warning, Space Development Agency and other military satellites.',
    news: 'NRO proliferated-architecture launches and SDA tranches have added many "USA-nnn" objects recently.',
    note: 'By design, true capabilities and counts are classified — the catalogue lists these only as "USA-nnn", so the dots reveal orbits, not identities.' },
  'isr-sda': {
    name: 'SDA Tranche', operator: 'U.S. Space Development Agency', founded: '2019 (agency); first launch 2023',
    fleet: '~40+ launched', active: '~42 in orbit', retired: 'Tranche 0 demo units ageing out',
    desc: 'The Pentagon’s proliferated LEO "Proliferated Warfighter Space Architecture" — a Transport layer (resilient data relay / connectivity) and a Tracking layer (missile warning and missile tracking) fielded in successive tranches, distinct from the older bespoke "USA-nnn" satellites.',
    news: 'Tranche 0 launched 2023; Tranche 1 Transport/Tracking deployment scaling through 2025–26 toward hundreds of satellites.',
    note: 'Catalogued as “SDA_nnnn” and “PRAETORIAN SDA_nnn” — a fast-growing LEO military mesh.' },
  'isr-cosmos': {
    name: 'Cosmos (Космос)', operator: 'Russian VKS / Roscosmos', founded: '1962 (Cosmos-1)',
    fleet: '2,500+ "Cosmos" launches since 1962', active: 'Dozens operational', retired: 'The vast majority have re-entered',
    desc: 'A generic designation used since 1962 for a huge range of Soviet/Russian military and civil satellites — recon, comms, navigation, early-warning and science.',
    news: 'Recent Cosmos launches include Tundra early-warning and various military payloads.',
    note: '"Cosmos" is a catch-all label spanning six decades and many mission types, so these dots are not a single program or company.' },

  // ---- Catch-all ----
  'other': {
    name: 'Other / uncategorised', operator: 'Many operators', founded: '—',
    fleet: '~10,000 catalogued objects', active: 'Varies', retired: 'Varies',
    desc: 'Everything not matched to a named operator above — rideshare cubesats, newer or smaller operators, science and amateur satellites, and objects catalogued only under an individual name or international designator.',
    note: 'This is why some real operators look "missing": if their satellites are catalogued under individual names the patterns don’t match, they fall in here rather than under their company. Turn this layer on to see them all.' },
};

// Concise corporate / programme history — [year, event] pairs, rendered as
// a timeline in the pop-up so you can see how each operator was founded and
// renamed / merged / split over the years.  Keyed by category `id`.
const COMPANY_HISTORY = {
  'gnss-gps': [['1978','First Block I satellite launched'],['1993','24-satellite constellation complete'],['1995','Full operational capability'],['2018','GPS III modernisation begins']],
  'gnss-glonass': [['1982','First satellite launched (USSR)'],['1995','Constellation completed'],['1990s','Decays after Soviet collapse'],['2011','Restored to full global service']],
  'gnss-galileo': [['2005','GIOVE-A test satellite'],['2011','First operational satellites'],['2016','Initial services declared'],['2020s','Second Generation (G2) in build']],
  'gnss-beidou': [['2000','BDS-1 regional demo (China)'],['2012','BDS-2 covers Asia-Pacific'],['2020','BDS-3 completes global service'],['2025','Next-generation design finalised']],
  'gnss-qzss': [['2010','QZS-1 “Michibiki” launched (Japan)'],['2018','4-satellite service begins'],['late 2020s','Expanding to 7 satellites']],
  'gnss-navic': [['2013','IRNSS-1A launched (ISRO, India)'],['2016','Operational; branded NavIC'],['2023','NVS-01 starts 2nd generation']],
  'gnss-centispace': [['2018','First CentiSpace-1 test satellites'],['2022–25','Constellation build-out'],['plan','~160-satellite LEO PNT layer']],

  'op-starlink': [['2002','SpaceX founded'],['2015','Starlink announced'],['2019','First operational batch launched'],['2020','Public beta service'],['2024','Direct-to-Cell service begins']],
  'op-oneweb': [['2012','Founded as WorldVu by Greg Wyler'],['~2014','Renamed OneWeb'],['2020','Chapter 11; rescued by UK govt + Bharti'],['2023','Merged with Eutelsat → Eutelsat OneWeb']],
  'op-kuiper': [['2019','Announced as “Project Kuiper” (Amazon)'],['2023','First prototype satellites launched'],['2025','Rebranded “Amazon Leo”; service debuts']],
  'op-iridium': [['1991','Founded (Motorola-backed)'],['1998','First-gen constellation live'],['1999','Bankruptcy'],['2001','Assets bought → Iridium Satellite LLC'],['2017–19','Iridium NEXT deployed'],['2026','Rocket Lab agrees to acquire']],
  'op-globalstar': [['1991','Founded (Loral–Qualcomm JV)'],['2000','First-gen service begins'],['2002','Bankruptcy, later reorganised'],['2024','Apple invests ~$1.7B, takes 20% stake']],
  'op-orbcomm': [['1993','Founded (Orbital Sciences unit)'],['2000','Bankruptcy, later reorganised'],['2008','OG1 IoT network operating'],['2021','Taken private by GI Partners']],
  'op-guowang': [['2021','China SatNet established'],['2024','First Guowang satellites launched'],['2025','Passes 100 satellites in orbit']],
  'op-qianfan': [['2024','SSST launches first “Thousand Sails” batch'],['2025','~200 satellites in orbit'],['plan','15,000-satellite build-out']],
  'op-kineis': [['1978','Argos environmental system begins (CNES/NOAA)'],['2018','Kinéis spun out of CLS'],['2024–25','25-satellite IoT constellation deployed on Electron']],
  'op-spacemobile': [['2017','Founded by Abel Avellan'],['2021','Public via SPAC'],['2022','BlueWalker 3 test satellite'],['2024','First five BlueBird satellites launched']],
  'op-gonets': [['1992','First Gonets-D demo (Russia)'],['1996','Gonets civil service begins'],['2015–','Gonets-M fleet refreshed']],
  'op-geespace': [['2018','Geespace established by Geely'],['2022','First nine GeeSAT-1 launched'],['2025','~60+ in orbit; targeting 72 then thousands']],
  'op-tianqi': [['2015','Guodian Gaoke founded'],['2018','First Tianqi IoT satellites'],['2020s','~30-satellite constellation operating']],
  'op-sitro': [['2020','Sitronics Space formed'],['2022–25','SITRO-AIS maritime fleet grows past 40']],

  'eo-planet': [['2010','Founded as Cosmogia → Planet Labs'],['2017','Buys Terra Bella (SkySat) from Google'],['2021','Public via SPAC → Planet Labs PBC'],['2024–25','Adds Pelican (high-res) + Tanager (hyperspectral)']],
  'eo-spire': [['2012','Founded as Nanosatisfi'],['2014','Renamed Spire Global; first LEMURs'],['2021','Public via SPAC']],
  'eo-maxar': [['1992','Founded as WorldView Imaging Corp (US)'],['1995','Renamed EarthWatch Inc.'],['2001','Renamed DigitalGlobe'],['2013','Merges with rival GeoEye (ex-ORBIMAGE, 1992)'],['2017','Acquired by Canada’s MDA → group renamed Maxar'],['2023','Advent International takes Maxar private'],['2025','Split into Vantor (imagery) + Lanteris (manufacturing)']],
  'eo-blacksky': [['2014','Founded within Spaceflight Industries'],['2018','First BlackSky imaging satellites'],['2021','Public via SPAC → BlackSky Technology'],['2025','Gen-3 (~35 cm) enters service']],
  'eo-capella': [['2016','Founded (US)'],['2020','First operational SAR satellite'],['2023–','Acadia-class SAR replenishment']],
  'eo-iceye': [['2014','Founded; spun from Aalto University, Finland'],['2018','Launches world’s first sub-100 kg SAR satellite'],['2025','Gen4 SAR (~16 cm); 60+ launched to date']],
  'eo-hawkeye': [['2015','Founded (USA)'],['2018','First RF-mapping cluster'],['2020s','Scaling toward ~60 satellites']],
  'eo-satellogic': [['2010','Founded (Argentina)'],['2016–','ÑuSat imaging ramps'],['2022','Public via SPAC']],
  'eo-synspective': [['2018','Founded (Japan)'],['2020','StriX-α, first SAR satellite'],['2020s','Building toward 30 SAR satellites']],
  'eo-iqps': [['2005','Founded in Kyushu, Japan'],['2019','First QPS-SAR'],['2020s','Deploying toward 36 SAR satellites']],
  'eo-unseenlabs': [['2015','Founded in Rennes, France'],['2019','First BRO RF satellite'],['2020s','~16 satellites for maritime RF']],
  'eo-iride': [['2023','Italy funds IRIDE (PNRR + ESA)'],['2025','First IRIDE satellites launched'],['2026','Multi-sensor constellation completing']],
  'eo-ghgsat': [['2011','Founded (Montreal)'],['2016','GHGSat-D “Claire” demo'],['2020s','GHGSat-C commercial methane fleet']],
  'eo-superview': [['2016','First SuperView-1 pair'],['2022','SuperView Neo higher-res birds'],['2020s','China Siwei commercial imagery']],
  'eo-sentinel': [['2014','Sentinel-1A launched'],['2015–18','Sentinel-2/-3/-5P follow'],['2024','Sentinel-1C restores the radar pair']],

  'com-inmarsat': [['1979','Inmarsat founded (maritime-safety body)'],['1986','Viasat founded (US)'],['1999','Inmarsat privatised'],['2023','Viasat acquires Inmarsat']],
  'com-intelsat': [['1964','Founded as intergovernmental consortium INTELSAT'],['2001','Privatised'],['2022','Exits Chapter 11'],['2025','Acquired by SES']],
  'com-eutelsat': [['1977','Founded as European intergovernmental org'],['2001','Privatised (Eutelsat S.A.)'],['2023','Merges with OneWeb → Eutelsat Group']],
  'com-ses': [['1985','Founded in Luxembourg (Astra satellites)'],['2001','Acquires GE Americom → SES Global'],['2016','Full takeover of O3b (MEO)'],['2025','Acquires Intelsat']],
  'com-chinasat': [['1984','China’s first comsat (DFH-2)'],['2001','China Satcom formed'],['2009','Absorbs CASC satellite-comms arm'],['2010s–','ChinaSat / Zhongxing GEO fleet grows']],
  'com-apstar': [['1988','AsiaSat founded (Hong Kong)'],['1992','APT Satellite (APStar) founded'],['1990s–','C/Ku/Ka GEO fleets serve Asia-Pacific']],
  'com-gsat': [['2001','GSAT-1 launched (ISRO)'],['2010s','GSAT comms + GSAT-7 defence birds'],['2024','GSAT-N2 broadband on Falcon 9']],
  'com-echostar': [['1996','EchoStar I launched (Dish)'],['1990s','DirecTV DBS fleet expands'],['2023','Dish + EchoStar re-merge as EchoStar Corp']],
  'com-express': [['1994','First modern Express satellites'],['2009–14','Express-AM fleet renewed'],['2020s','Express-AMU / Express-RV additions']],

  'met-noaa': [['1960','TIROS-1, first weather satellite'],['1975','First GOES geostationary satellite'],['2016','GOES-R / GOES-16 next-gen begins'],['2025','Legacy POES constellation retired']],
  'met-meteosat': [['1977','Meteosat-1 launched'],['1986','EUMETSAT established'],['2002','Meteosat Second Generation begins'],['2022','Meteosat Third Generation (MTG-I1)']],
  'met-fengyun': [['1988','FY-1A, first Chinese weather satellite'],['1997','FY-2 geostationary series'],['2016','FY-4 next-gen GEO'],['2025','FY-3H + FY-4C launched']],
  'met-himawari': [['1977','GMS-1 “Himawari” launched (Japan)'],['2014','Himawari-8 advanced imager'],['late 2020s','Himawari-10 planned']],
  'met-insat': [['1982','INSAT-1A launched (India)'],['2002','Kalpana-1 dedicated met satellite'],['2013–','INSAT-3D / 3DR / 3DS imagers']],

  'isr-yaogan': [['2006','First Yaogan launched'],['2010s','SAR + optical + ELINT triads expand'],['2025','Yaogan-40 naval-tracking clusters']],
  'isr-gaofen': [['2013','GF-1 launches the CHEOS programme'],['2015','GF-4 geostationary starer'],['2020s','Higher-numbered dual-use craft added']],
  'isr-jilin': [['2014','Chang Guang (CGSTL) founded'],['2015','First Jilin-1 satellites'],['2024','117+ in orbit; targeting 300']],
  'isr-usa': [['1984','First “USA”-designated payload'],['1990s–2010s','NRO recon + military comsats'],['2020s','Proliferated NRO + SDA tranches']],
  'isr-sda': [['2019','Space Development Agency established'],['2023','Tranche 0 Transport + Tracking launched'],['2024–25','Tranche 1 deployment begins']],
  'isr-cosmos': [['1962','Cosmos-1 launched (USSR)'],['1960s–91','Thousands of Soviet Cosmos payloads'],['1992–','Continued by Russia (VKS / Roscosmos)']],
};

// Pre-build THREE.Color objects so we don't re-allocate per instance per tick.
const CAT_COLOR = CATEGORIES.map(c => new THREE.Color(c.color));

// =========================================================================
// Status helpers
// =========================================================================

function setStatus(msg, isErr) {
  $('sbo-status').textContent = msg;
  $('sbo-status').style.color = isErr ? 'var(--accent2)' : '';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// =========================================================================
// Globe (same chrome as viz3d)
// =========================================================================

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 3.2 }, 0);

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed   = 0.45;
controls.zoomSpeed     = 0.8;
controls.minDistance   = 110;
controls.maxDistance   = 2200;
controls.autoRotate       = true;
controls.autoRotateSpeed  = 0.18;
const stopAutoRotate = () => { controls.autoRotate = false; };
document.getElementById('globe').addEventListener('pointerdown', stopAutoRotate, { once: true });
document.getElementById('globe').addEventListener('wheel',       stopAutoRotate, { once: true });

// Fit the globe to its container (the #globe div is CSS-offset on this
// page so the Earth sits centred in the viewport region *not* covered
// by the .sbo-shell panel).  Re-fit on resize.
function fitGlobeToContainer() {
  const el = document.getElementById('globe');
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    globe.width(rect.width).height(rect.height);
  }
}
fitGlobeToContainer();
window.addEventListener('resize', fitGlobeToContainer);

// =========================================================================
// Instanced mesh (one draw call for ~22 k sphere instances)
// =========================================================================

const SAT_GEOM = new THREE.SphereGeometry(SAT_RADIUS, 8, 8);
const SAT_MAT  = new THREE.MeshBasicMaterial({ color: 0xffffff });
const instMesh = new THREE.InstancedMesh(SAT_GEOM, SAT_MAT, MAX_INSTANCES);
instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
instMesh.frustumCulled = false;
const HIDE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAX_INSTANCES; i++) instMesh.setMatrixAt(i, HIDE_MATRIX);
instMesh.instanceMatrix.needsUpdate = true;
globe.scene().add(instMesh);

// =========================================================================
// App state
// =========================================================================

let allSats   = [];
let satCat    = [];            // category index per sat (computed once at boot)
let satState  = [];            // latest { lat, lon, alt } per sat
let satPeriod = [];            // orbital period in minutes per sat
let propagationActive = false;

// Per-category on/off toggles, default ON unless `defaultOff` in the def.
const categoryEnabled = CATEGORIES.map(c => !c.defaultOff);
// Per-category live count, refreshed each propagation tick.
const categoryCount = CATEGORIES.map(() => 0);

// User-controlled view sliders, both 1.0× by default.  altScale
// exaggerates the radial spread (useful to pull a dense LEO shell
// further off the surface); dotScale changes the on-screen size of
// every sat sphere.
let altScale = 1.0;
let dotScale = 1.0;

// Blink-on-hover state.  When the user hovers a category row in the
// HUD, every sat in that category pulses (scale animation) so they're
// easy to spot on the globe.  -1 = no highlight.
let highlightCat = -1;
let blinkRafId   = null;
let blinkStart   = 0;

const _pos   = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat   = new THREE.Matrix4();

// =========================================================================
// Category panel — built once after categorisation is known
// =========================================================================

function buildCategoryPanel() {
  const container = $('sbo-categories');
  const html = [];
  let lastTier = null;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    if (c.tier !== lastTier) {
      html.push(`<div class="sbo-tier">${escHtml(c.tier)}</div>`);
      lastTier = c.tier;
    }
    html.push(`
      <div class="sbo-row" data-idx="${i}">
        <input type="checkbox" ${categoryEnabled[i] ? 'checked' : ''} aria-label="Toggle ${escHtml(c.label)} on the globe">
        <span class="swatch" style="background:${c.color};color:${c.color}"></span>
        <button type="button" class="lbl" title="About ${escHtml(c.label)}">${escHtml(c.label)}</button>
        <span class="cnt" id="sbo-cnt-${i}">…</span>
        <button type="button" class="sbo-info" title="About ${escHtml(c.label)}" aria-label="About ${escHtml(c.label)}">ⓘ</button>
      </div>
    `);
  }
  container.innerHTML = html.join('');
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const row = cb.closest('.sbo-row');
      const idx = parseInt(row.dataset.idx, 10);
      categoryEnabled[idx] = cb.checked;
      rerenderFiltered();
    });
  });
  // Clicking the operator name or the ⓘ button opens its dossier pop-up.
  container.querySelectorAll('.lbl, .sbo-info').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(el.closest('.sbo-row').dataset.idx, 10);
      openCompany(idx);
    });
  });
  $('sbo-all').addEventListener('click', () => {
    container.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
    for (let i = 0; i < categoryEnabled.length; i++) categoryEnabled[i] = true;
    rerenderFiltered();
  });
  $('sbo-none').addEventListener('click', () => {
    container.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
    for (let i = 0; i < categoryEnabled.length; i++) categoryEnabled[i] = false;
    rerenderFiltered();
  });

  // Blink-on-hover: enter a row → its sats start pulsing.  Leave →
  // they go back to steady.  mouseenter / mouseleave don't bubble so
  // we attach per-row.
  container.querySelectorAll('.sbo-row').forEach(row => {
    const idx = parseInt(row.dataset.idx, 10);
    row.addEventListener('mouseenter', () => setHighlight(idx));
    row.addEventListener('mouseleave', () => setHighlight(-1));
  });
}

// ---- Blink animation -----------------------------------------------------

function setHighlight(catIdx) {
  if (catIdx === highlightCat) return;
  const prev = highlightCat;
  highlightCat = catIdx;
  // Tint the active row in the panel so the user can see which
  // category is currently being pulsed on the globe.
  document.querySelectorAll('.sbo-row.highlight').forEach(r => r.classList.remove('highlight'));
  if (catIdx !== -1) {
    const row = document.querySelector(`.sbo-row[data-idx="${catIdx}"]`);
    if (row) row.classList.add('highlight');
  }
  // Stop case: restore the previous category's instances to the
  // user-set dotScale and cancel the rAF loop.
  if (catIdx === -1) {
    if (prev !== -1) applyScaleToCategory(prev, dotScale);
    blinkRafId = null;
    return;
  }
  // Restore the previous category before starting on the new one so
  // we don't leave a stale stretched group behind.
  if (prev !== -1) applyScaleToCategory(prev, dotScale);
  blinkStart = performance.now();
  if (!blinkRafId) blinkRafId = requestAnimationFrame(blinkStep);
}

function blinkStep() {
  if (highlightCat === -1) {
    blinkRafId = null;
    return;
  }
  // 1.0 Hz pulse, scale between 0.6× and 1.8× of dotScale — big enough
  // to spot, small enough that no individual sphere dominates the
  // view.  |sin(...)| flips the curve so each pulse is symmetrical.
  const t = (performance.now() - blinkStart) / 1000;
  const factor = 0.6 + 1.2 * Math.abs(Math.sin(t * Math.PI));
  applyScaleToCategory(highlightCat, dotScale * factor);
  blinkRafId = requestAnimationFrame(blinkStep);
}

// Rewrites only the matrices for instances in `cat`, using each one's
// last-known sub-point + altitude and the supplied scale.  Cheap even
// for the largest category (Starlink at ~10 k sats ≈ 5 ms / pass).
function applyScaleToCategory(cat, scale) {
  if (cat === -1 || !categoryEnabled[cat]) return;
  for (let i = 0; i < allSats.length; i++) {
    if (satCat[i] !== cat) continue;
    const st = satState[i];
    if (!st) continue;
    const altFrac = (st.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(st.lat, st.lon, altFrac);
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(scale);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
  }
  instMesh.instanceMatrix.needsUpdate = true;
}

// ---- View-option sliders -------------------------------------------------

function bindSliders() {
  $('sbo-alt').addEventListener('input', e => {
    altScale = parseFloat(e.target.value) || 1;
    $('sbo-alt-val').textContent = altScale.toFixed(1);
    // Altitude affects 3-D position so a slider drag needs a full
    // matrix refresh (cheap — no SGP4, just getCoords + compose).
    rerenderFiltered();
  });
  $('sbo-size').addEventListener('input', e => {
    dotScale = parseFloat(e.target.value) || 1;
    $('sbo-size-val').textContent = dotScale.toFixed(1);
    rerenderFiltered();
  });
}

function updateCategoryCounts() {
  for (let i = 0; i < CATEGORIES.length; i++) {
    const el = $('sbo-cnt-' + i);
    if (!el) continue;
    el.textContent = categoryCount[i].toLocaleString();
    el.closest('.sbo-row').classList.toggle('zero', categoryCount[i] === 0);
  }
}

// =========================================================================
// Operator dossier pop-up
// =========================================================================

let openCompanyIdx = -1;   // category index whose pop-up is open, or -1

function openCompany(idx) {
  const c = CATEGORIES[idx];
  const info = COMPANY_INFO[c.id] || {};
  const modal = $('sbo-modal');
  const body  = $('sbo-modal-body');
  if (!modal || !body) return;
  openCompanyIdx = idx;

  const stat = (k, v) => v
    ? `<div class="sbo-stat"><span class="k">${escHtml(k)}</span><span class="v">${escHtml(v)}</span></div>` : '';
  const live = categoryCount[idx];

  const hist = COMPANY_HISTORY[c.id];
  const histHtml = (hist && hist.length)
    ? `<div class="sbo-history"><span class="k">Company history</span><ul class="sbo-timeline">`
      + hist.map(([yr, ev]) => `<li><span class="yr">${escHtml(yr)}</span><span class="ev">${escHtml(ev)}</span></li>`).join('')
      + `</ul></div>`
    : '';

  body.innerHTML = `
    <div class="sbo-modal-head">
      <span class="sbo-modal-dot" style="background:${c.color};color:${c.color}"></span>
      <div class="sbo-modal-titles">
        <h2 id="sbo-modal-title">${escHtml(info.name || c.label)}</h2>
        <div class="sbo-modal-sub">${escHtml(info.operator || '')}${info.founded ? ' · Founded ' + escHtml(info.founded) : ''}</div>
      </div>
    </div>
    <div class="sbo-stats">
      <div class="sbo-stat hl"><span class="k">On the globe now</span><span class="v" style="color:${c.color}">${live.toLocaleString()}</span></div>
      ${stat('Fleet operated to date', info.fleet)}
      ${stat('Active now', info.active)}
      ${stat('Retired / de-orbited', info.retired)}
    </div>
    ${info.desc ? `<p class="sbo-desc">${escHtml(info.desc)}</p>` : ''}
    ${histHtml}
    ${info.news ? `<p class="sbo-field"><span class="k">Latest</span> ${escHtml(info.news)}</p>` : ''}
    ${info.note ? `<div class="sbo-note"><span class="k">Why the globe may show fewer</span> ${escHtml(info.note)}</div>` : ''}
    <p class="sbo-foot">“On the globe now” is the live count of matching satellites in CelesTrak’s active catalogue.
      Other figures are compiled from open sources (late 2025 – early 2026) and are approximate.</p>
  `;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function closeCompany() {
  const modal = $('sbo-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  openCompanyIdx = -1;
}

(function setupCompanyModal() {
  $('sbo-modal-close')?.addEventListener('click', closeCompany);
  // Click the dimmed backdrop (outside the card) → close.
  $('sbo-modal')?.addEventListener('click', e => {
    if (e.target.id === 'sbo-modal') closeCompany();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openCompanyIdx !== -1) closeCompany();
  });
})();

// =========================================================================
// Chunked SGP4 propagation (same pattern as viz3d)
// =========================================================================

let chunkIdx = 0;
let propNow  = new Date();

function startPropagationTick() {
  if (propagationActive) return;
  propagationActive = true;
  propNow  = new Date();
  chunkIdx = 0;
  for (let i = 0; i < categoryCount.length; i++) categoryCount[i] = 0;
  processChunk();
}

function processChunk() {
  const end = Math.min(chunkIdx + CHUNK_SIZE, allSats.length);
  for (let i = chunkIdx; i < end; i++) {
    const t = allSats[i];
    const r = propagate(t.rec, propNow);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.alt) || r.alt < 0) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      satState[i] = null;
      continue;
    }
    satState[i] = { lat: r.lat, lon: r.lon, alt: r.alt };
    const cat = satCat[i];
    categoryCount[cat]++;
    if (!categoryEnabled[cat]) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      continue;
    }
    // altScale exaggerates the radial spread; dotScale changes
    // sphere size.  Both live-controlled via the View Options sliders.
    const altFrac = (r.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(r.lat, r.lon, altFrac);
    // Cache the scene-space position so the hover pick can project it to
    // screen pixels without re-running getCoords per mousemove.
    satState[i].x = p.x; satState[i].y = p.y; satState[i].z = p.z;
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(dotScale);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, CAT_COLOR[cat]);
  }
  chunkIdx = end;
  if (chunkIdx < allSats.length) {
    // rAF stalls in hidden tabs; fall back to setTimeout(0) there.
    if (document.hidden) setTimeout(processChunk, 0);
    else                 requestAnimationFrame(processChunk);
    return;
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
  updateCategoryCounts();
  const total = categoryCount.reduce((a, b) => a + b, 0);
  setStatus(`${total.toLocaleString()} sats categorised · refreshed ${propNow.toISOString().slice(11, 19)} UTC`);
  propagationActive = false;
  if (hoverId !== -1 && satState[hoverId]) renderTooltip(hoverId);
}

// Cheap second-pass: visibility toggle without re-running SGP4.  Uses
// each instance's last-known position from the matrix buffer, just
// rewrites the scale-to-zero / restore decision per the new filter.
function rerenderFiltered() {
  for (let i = 0; i < allSats.length; i++) {
    const st = satState[i];
    const cat = satCat[i];
    if (!st || !categoryEnabled[cat]) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      continue;
    }
    const altFrac = (st.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(st.lat, st.lon, altFrac);
    st.x = p.x; st.y = p.y; st.z = p.z;
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(dotScale);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, CAT_COLOR[cat]);
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
}

// =========================================================================
// Boot
// =========================================================================

async function boot() {
  setStatus('Loading TLE catalogue…');
  let tleResult;
  try {
    tleResult = await fetchTLEs();
  } catch (e) {
    setStatus('TLE fetch failed: ' + e.message, true);
    return;
  }
  allSats = makeSatrecs(tleResult.tles);
  if (allSats.length > MAX_INSTANCES) {
    console.warn(`More sats (${allSats.length}) than reserved instances (${MAX_INSTANCES}); trimming.`);
    allSats.length = MAX_INSTANCES;
  }
  // One-time pass: categorise every sat by its TLE name and cache its
  // period.  Neither value changes between propagation ticks.
  satCat    = new Array(allSats.length);
  satState  = new Array(allSats.length).fill(null);
  satPeriod = new Array(allSats.length);
  for (let i = 0; i < allSats.length; i++) {
    satCat[i] = categorize(allSats[i].name);
    const rec = allSats[i].rec;
    const no = (rec && (rec.no_kozai ?? rec.no));
    satPeriod[i] = (Number.isFinite(no) && no > 0) ? (2 * Math.PI) / no : null;
  }
  buildCategoryPanel();
  bindSliders();

  const tag = tleResult.source === 'celestrak' ? 'live'
            : tleResult.source === 'cache'    ? 'cached'
            : 'bundled snapshot';
  setStatus(`Catalogue: ${allSats.length.toLocaleString()} sats (${tag}). Propagating…`);
  startPropagationTick();
  setInterval(startPropagationTick, REFRESH_MS);
}

boot();

// =========================================================================
// Hover tooltip — name, altitude, period, category badge
// =========================================================================

const tip = $('sat-tip');
let hoverId = -1;
let pendingMouse = null;
let rafQueued = false;

// --- Screen-space picking -------------------------------------------------
// Project every visible sat's cached scene position to screen pixels and
// take the nearest one within PICK_RADIUS_PX of the cursor.  Far more
// forgiving than raycasting the InstancedMesh, whose 1.6-unit spheres
// project to only a few pixels at default zoom — the old ray-cast pick
// almost never registered a hit, which is why hover details never showed.
const PICK_RADIUS_PX = 12;
const _pickV = new THREE.Vector3();

function pickSat(ev) {
  const cv = document.querySelector('#globe canvas');
  if (!cv) return -1;
  const rect = cv.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  const cam = globe.camera();
  const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
  let best = -1;
  let bestD2 = PICK_RADIUS_PX * PICK_RADIUS_PX;
  for (let i = 0; i < allSats.length; i++) {
    const st = satState[i];
    if (!st || st.x === undefined) continue;
    if (!categoryEnabled[satCat[i]]) continue;
    _pickV.set(st.x, st.y, st.z).project(cam);
    if (_pickV.z > 1 || _pickV.z < -1) continue;   // behind the camera / clipped
    const sx = (_pickV.x *  0.5 + 0.5) * rect.width;
    const sy = (_pickV.y * -0.5 + 0.5) * rect.height;
    const dx = sx - mx, dy = sy - my;
    const d2 = dx * dx + dy * dy;
    if (d2 >= bestD2) continue;
    // Occlusion: skip sats hidden behind the globe.  Closest approach of
    // the camera→sat segment to the origin must stay outside the globe
    // radius (100, with a unit of grace for the surface bump).
    const vx = st.x - cx, vy = st.y - cy, vz = st.z - cz;
    const L2 = vx * vx + vy * vy + vz * vz;
    const tt = -(cx * vx + cy * vy + cz * vz) / L2;
    if (tt > 0 && tt < 1) {
      const px = cx + vx * tt, py = cy + vy * tt, pz = cz + vz * tt;
      if (px * px + py * py + pz * pz < 99 * 99) continue;
    }
    bestD2 = d2;
    best = i;
  }
  return best;
}

function renderTooltip(id) {
  const t  = allSats[id];
  const st = satState[id];
  if (!t || !st) return;
  const cat = CATEGORIES[satCat[id]];
  const period = satPeriod[id];
  const periodStr = period
    ? `${period.toFixed(1)} min <span class="muted">(${(period / 60).toFixed(2)} h)</span>`
    : '<span class="muted">unknown</span>';
  // Mean orbital speed from the circular-orbit approximation
  // v = 2π(R⊕ + h) / T — good to ~1 % for near-circular orbits.
  const speedStr = period
    ? `${(2 * Math.PI * (EARTH_R_KM + st.alt) / (period * 60)).toFixed(2)} km/s`
    : '<span class="muted">unknown</span>';
  // Inline operator badge in the category's own colour — matches the sphere.
  const badge = `<span class="cls" style="background:rgba(255,255,255,0.06);color:${cat.color}">${escHtml(cat.label)}</span>`;
  tip.innerHTML = `
    <b>${escHtml(t.name)}</b> ${badge}
    <div>Operator <strong>${escHtml(cat.label)}</strong></div>
    <div>NORAD ID <strong>${t.noradId}</strong></div>
    <div>Int'l ID <strong>${t.intlId ? escHtml(t.intlId) : '—'}</strong></div>
    <div>Altitude <strong>${st.alt.toFixed(0)} km</strong></div>
    <div>Speed <strong>${speedStr}</strong></div>
    <div>Period <strong>${periodStr}</strong></div>
  `;
}

function processHover() {
  rafQueued = false;
  const ev = pendingMouse;
  if (!ev) return;
  const id = pickSat(ev);
  if (id !== -1) {
    if (id !== hoverId) {
      hoverId = id;
      renderTooltip(id);
    }
    tip.hidden = false;
    const ttW = tip.offsetWidth  || 220;
    const ttH = tip.offsetHeight || 110;
    let x = ev.clientX + 16;
    let y = ev.clientY + 16;
    if (x + ttW > window.innerWidth)  x = ev.clientX - ttW - 12;
    if (y + ttH > window.innerHeight) y = ev.clientY - ttH - 12;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  } else if (hoverId !== -1) {
    hoverId = -1;
    tip.hidden = true;
  }
}

function onMouseMove(e) {
  pendingMouse = e;
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(processHover);
}
function onMouseLeave() {
  pendingMouse = null;
  hoverId = -1;
  tip.hidden = true;
}

(function attachHover() {
  const cv = document.querySelector('#globe canvas');
  if (!cv) { requestAnimationFrame(attachHover); return; }
  cv.addEventListener('mousemove',  onMouseMove);
  cv.addEventListener('mouseleave', onMouseLeave);
})();
