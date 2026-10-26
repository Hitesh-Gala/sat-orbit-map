# compendium_notes.py — the editorial layer behind the PRC Orbital Catalog.
#
# gen_compendium.py supplies the facts a catalogue can settle on its own:
# name, NORAD and COSPAR id, launch and decay date, apogee/perigee,
# inclination, owner and launch site.  What it cannot supply is what a
# satellite is FOR, which for most of the interesting Chinese programmes is
# not announced and has to be read off orbit, launch vehicle, cadence and
# whatever the analyst community has published.
#
# So every assessment here carries its ground.  Where an attribution is
# inferred rather than confirmed, it says so — "assessed", "reported",
# "consistent with" — and where the open sources disagree, the remark says
# that too rather than picking a side.  A catalogue that states a guess as a
# fact is worse than one that admits the gap.
#
# Named open sources used, and what each is good for:
#   Jonathan McDowell, GCAT / "Space Activities" annual (planet4589.org)
#       — orbital reality, class attributions for TJS and other cover names.
#   Gunter's Space Page (space.skyrocket.de)  — bus lineage, series grouping.
#   SpaceNews, Andrew Jones                   — launch reporting and context.
#   ISR University (isruniversity.com)        — GEO manoeuvre and RPO watch.
#   WMO OSCAR (space.oscar.wmo.int)           — instrument specs, data policy.
#   eoPortal (ESA)                            — civil/dual-use mission detail.
#   USCC, "China's Space and Counterspace Capabilities" (uscc.gov)
#       — the institutional picture: who tasks what.
#   CelesTrak SATCAT                          — the catalogue itself.

MIL = "<span class='flag flag-mil'>MIL</span>"
DUAL = "<span class='flag flag-dual'>DUAL</span>"
CIV = "<span class='flag flag-civ'>CIV</span>"
COM_ = "<span class='flag flag-com'>COM</span>"

# ---------------------------------------------------------------------------
# SERIES — matched against the catalogue name in order, first hit wins.
#   pattern : regex, matched case-insensitively against the full object name
#   series  : the label shown under the satellite name
#   func    : ISR NAV COM MET RPO SCI EW OCN ENV BRD
#   note    : the remark every member of the series carries unless it has an
#             individual one in SATS below
# ---------------------------------------------------------------------------
SERIES = [
    # ---- the two megaconstellations -------------------------------------
    dict(pattern=r"^HULIANWANG DIGUI", series="Guowang (SatNet) GW", func="BRD", note=(
        DUAL + "China's state megaconstellation, catalogued under the literal Chinese "
        "<i>hulianwang digui</i> (internet, low orbit) rather than its programme name. Run by "
        "China SatNet (中国星网), a central SOE created in 2021 and reporting to SASAC, not to CASC. "
        "Two ITU-filed shells: <b>GW-A59</b>, 6,080 satellites at 500–600 km, and <b>GW-2</b>, 6,912 at "
        "~1,145 km — 12,992 in all. Deployment is batched by rocket: Long March 5B carries 10 per "
        "flight, Long March 8A and Long March 12 nine, Long March 6A five from Taiyuan. The 2026 "
        "groups have gone to two inclinations, ~50° and ~86.5°, though published tracking does not "
        "map groups to shells cleanly. Stated ramp is 310 satellites in 2026, 900 in 2027 and 3,600 a "
        "year from 2028; the counted cadence is running behind that. No broadband service had opened "
        "to subscribers as of October 2026 — the system is still in test. Military relevance is "
        "structural rather than declared: a sovereign, state-owned broadband layer is resilient "
        "communications infrastructure whoever the subscribers turn out to be.")),

    dict(pattern=r"^HULIANWANG JISHU SHIYAN", series="Guowang technology test", func="BRD", note=(
        DUAL + "Internet technology-test satellites — the Guowang programme's prototypes and "
        "in-orbit demonstrators rather than production spacecraft. They fly ahead of, and alongside, "
        "the <i>Hulianwang Digui</i> production batches and are the vehicles on which bus, "
        "inter-satellite link and payload choices for the operational shells are proven.")),

    # The newest Guowang batches are catalogued under the programme name
    # rather than the literal Chinese, so both spellings have to be caught or
    # the latest launches fall out of the series.
    dict(pattern=r"^GUOWANG", series="Guowang (SatNet) GW", func="BRD", note=(
        DUAL + "A Guowang production satellite, catalogued under the programme name rather than "
        "the <i>hulianwang digui</i> spelling the earlier batches carry — the same constellation, "
        "a later cataloguing convention. Run by China SatNet against ITU filings for 12,992 "
        "satellites across a 500–600 km shell and a ~1,145 km shell.")),

    dict(pattern=r"^HULIANWAN GAOGUI", series="Guowang high-orbit (GW-2)", func="BRD", note=(
        DUAL + "<i>Hulianwan gaogui</i> — internet, <b>high</b> orbit, against the <i>digui</i> "
        "(low orbit) of the main batches. These are the prototypes for Guowang's upper shell, the "
        "~1,145 km GW-2 layer, where a smaller number of satellites covers the same ground at the "
        "cost of latency.")),

    dict(pattern=r"^(QIANFAN|THOUSAND SAILS|SPACESAIL)", series="Qianfan (Thousand Sails) G60",
         func="BRD", note=(
        COM_ + "Thousand Sails (千帆), the Shanghai-backed commercial answer to Starlink, run by "
        "Spacesail (Shanghai Yuanxin Satellite Technology) out of the G60 science-and-technology "
        "corridor and funded substantially by the Shanghai municipal government. Filed for ~15,000 "
        "satellites; the flat-panel stackable bus is built on a production line explicitly modelled "
        "on Starlink's. Distinct from Guowang in ownership and intent — Spacesail has signed "
        "overseas distribution agreements (Brazil, Kazakhstan, Malaysia among them), which makes it "
        "the outward-facing half of China's LEO broadband push. The satellites are notably bright, "
        "and the constellation has drawn the same astronomical objections as its Western analogue.")),

    # ---- the cover-name programmes --------------------------------------
    dict(pattern=r"^TJS", series="TJS (Tongxin Jishu Shiyan)", func="EW", note=(
        MIL + "<i>Tongxin Jishu Shiyan</i> (通信技术试验卫星, 'communications technology experiment "
        "satellite') — a cover designation, not a mission description. CASC announces each one with "
        "near-identical boilerplate about communications, broadcasting and data-transmission "
        "technology verification, and releases nothing further. The analyst consensus, led by "
        "Jonathan McDowell's GCAT and Gunter's Space Page, is that TJS bundles at least three "
        "distinct programmes: a <b>Qianshao-3</b> SIGINT class, a <b>Huoyan-1</b> missile "
        "early-warning class, and an unclassified remainder. Attribution to a class is inferred from "
        "orbit, launch vehicle and cadence, never confirmed — Gunter's notes that satellites grouped "
        "together on those grounds may turn out to have different missions.")),

    dict(pattern=r"^(SHIJIAN|SJ)[\s-]", series="Shijian (Practice)", func="RPO", note=(
        DUAL + "<i>Shijian</i> (实践, 'practice') is China's long-running technology-demonstration "
        "line, and the label covers everything from benign materials experiments to the most "
        "closely watched spacecraft in the catalogue. Several Shijian vehicles have performed "
        "documented rendezvous and proximity operations in GEO; commercial trackers "
        "(ExoAnalytic, COMSPOC) and ISR University follow them because an inspection capability and "
        "a co-orbital counterspace capability are the same hardware pointed at different targets.")),

    dict(pattern=r"^SHIYAN", series="Shiyan (Experiment)", func="RPO", note=(
        DUAL + "<i>Shiyan</i> (试验, 'experiment') — the second of China's two generic "
        "technology-test labels. Announced purposes are given as space-environment survey and "
        "new-technology verification. The series is heterogeneous and poorly documented; orbit is "
        "usually the only clue to what an individual vehicle is doing.")),

    dict(pattern=r"^(CHUANGXIN|CX)[\s-]", series="Chuangxin (Innovation)", func="RPO", note=(
        DUAL + "<i>Chuangxin</i> (创新, 'innovation') small technology-test satellites, run largely "
        "by the Chinese Academy of Sciences' Innovation Academy for Microsatellites. Used for "
        "store-and-forward communications trials and component qualification.")),

    # ---- imaging ---------------------------------------------------------
    dict(pattern=r"^YAOGAN", series="Yaogan (Remote Sensing)", func="ISR", note=(
        MIL + "<i>Yaogan</i> (遥感, 'remote sensing') is the PLA's principal imaging-reconnaissance "
        "line, announced only as scientific experiments and land survey. Western analysis has read "
        "the series by orbit since its 2006 start: SSO sun-synchronous singles are optical or SAR "
        "imagers of the JB-series, while the triplet clusters at ~63.4° in formation are naval "
        "electronic-intelligence packages — the direct analogue of the US NOSS ocean-surveillance "
        "constellation, locating ships by time-difference-of-arrival across the three spacecraft. "
        "Yaogan is the largest single named PRC payload family in the catalogue.")),

    dict(pattern=r"^GAOFEN", series="Gaofen (CHEOS)", func="ISR", note=(
        DUAL + "<i>Gaofen</i> (高分, 'high resolution') is the space segment of CHEOS, the China "
        "High-resolution Earth Observation System, managed by SASTIND. The series splits cleanly at "
        "number 8: <b>Gaofen-1 to -7 are genuinely civil</b>, documented in eoPortal and WMO OSCAR "
        "with published instruments and open data, serving agriculture, disaster response and "
        "mapping. <b>Gaofen-8 and above have had no technical detail released at all</b>, which is "
        "itself the evidence analysts rely on — SpaceNews notes the information blackout above GF-7, "
        "and the USCC's counterspace assessment describes PRC space assets as assigned military or "
        "dual-use and mobilisable in a crisis. The civil branding is real; so is the military "
        "customer behind the higher numbers.")),

    dict(pattern=r"^(JILIN|CHANG GUANG)", series="Jilin-1 (Chang Guang)", func="ISR", note=(
        COM_ + "Jilin-1, operated by Chang Guang Satellite Technology — a spin-out of the CAS "
        "Changchun Institute and China's largest commercial imaging constellation, with video as "
        "well as still capability. Chang Guang has stated a 300-satellite goal. Commercially sold "
        "imagery with a declared revisit rate fine enough to be operationally useful, which is why "
        "the constellation appears in military-utility assessments despite its private ownership.")),

    dict(pattern=r"^(GAOJING|SUPERVIEW|SIWEI)", series="SuperView / Gaojing", func="ISR", note=(
        COM_ + "SuperView (Gaojing, 高景) — sub-metre commercial optical imaging operated by China "
        "Siwei / SpaceView. Marketed internationally against Maxar and Airbus imagery.")),

    dict(pattern=r"^(PIESAT|HONGTU)", series="PIESAT / Hongtu", func="ISR", note=(
        COM_ + "PIESAT (Hongtu, 宏图) commercial SAR, flown in close formation so the cluster can "
        "work as a distributed interferometric aperture — the configuration used for high-precision "
        "terrain deformation and digital elevation products rather than single-image spotting.")),

    dict(pattern=r"^(TIANHUI|TH)[\s-]", series="Tianhui (Space Mapping)", func="ENV", note=(
        DUAL + "<i>Tianhui</i> (天绘, 'space mapping') — stereo photogrammetric survey satellites "
        "for topographic mapping, run by the PLA's mapping and surveying establishment. Precision "
        "geodesy is a civil product and a targeting input at the same time.")),

    dict(pattern=r"^(ZIYUAN|ZY)[\s-]", series="Ziyuan (Resources)", func="ENV", note=(
        CIV + "<i>Ziyuan</i> (资源, 'resources') — land-resource survey satellites, including the "
        "long-running CBERS series built jointly with Brazil. Hyperspectral and stereo instruments; "
        "data shared internationally through the CBERS agreement.")),

    dict(pattern=r"^(HUANJING|HJ)[\s-]", series="Huanjing (Environment)", func="ENV", note=(
        CIV + "<i>Huanjing</i> (环境, 'environment') — environmental protection and disaster-"
        "monitoring satellites carrying multispectral, hyperspectral, infrared and in the later "
        "pairs SAR instruments.")),

    dict(pattern=r"^LUDI TANCE", series="Ludi Tance (L-SAR)", func="ENV", note=(
        CIV + "<i>Ludi Tance</i> (陆地探测, 'land exploration') — L-band SAR pair flown in formation "
        "for interferometric measurement of ground deformation: earthquake precursors, landslides, "
        "subsidence and infrastructure monitoring. L-band penetrates vegetation, which also makes it "
        "the band of choice for foliage-penetration applications.")),

    # ---- navigation ------------------------------------------------------
    dict(pattern=r"^(BEIDOU|BDS)", series="BeiDou (北斗)", func="NAV", note=(
        DUAL + "BeiDou is China's global navigation system and the strategic point of the whole "
        "programme: ending dependence on GPS, a system the US can degrade regionally at will. "
        "<b>BDS-3</b> was declared complete in July 2020 with a 30-satellite core — 24 in MEO at "
        "~21,500 km, 3 in inclined geosynchronous orbit (IGSO) and 3 in GEO. The IGSO and GEO "
        "components are what distinguish BeiDou's architecture from GPS: they concentrate signal "
        "strength and availability over China and the Asia-Pacific, including in urban canyons and at "
        "high latitudes where a pure MEO constellation thins out. BeiDou also carries a short-message "
        "two-way service GPS has no equivalent of. Earlier <b>BDS-2</b> spacecraft remain in the "
        "catalogue, some operational, some drifting as spares or retired; replenishment BDS-3 "
        "launches have continued past the 2020 completion date, so the catalogue count runs well "
        "above the 30-satellite nominal constellation.")),

    # LEO-PNT is its own category: BeiDou is a MEO/IGSO/GEO timing-and-
    # ranging system, CentiSpace is a low-orbit augmentation layer that rides
    # on top of it.  Grouping them hid the difference.
    dict(pattern=r"^CENTISPACE", series="CentiSpace (LEO-PNT)", func="PNT", note=(
        COM_ + "CentiSpace — a commercial LEO navigation-augmentation constellation from Beijing "
        "Future Navigation. LEO augmentation sharpens GNSS convergence time and accuracy, and a "
        "LEO signal is far harder to jam than a MEO one because it arrives much stronger.")),

    # ---- communications --------------------------------------------------
    dict(pattern=r"^(ZHONGXING|CHINASAT|CHINA SAT|APSTAR|ASIASAT)", series="ChinaSat / APSTAR GEO",
         func="COM", note=(
        DUAL + "Commercial geostationary communications satellites operated by China Satcom and "
        "APT. Published as civil broadcast and broadband capacity; the same transponders serve "
        "government and military traffic, and several of the fleet are standard dual-use "
        "assumptions in Western assessments.")),

    dict(pattern=r"^TIANLIAN", series="Tianlian (TDRS)", func="COM", note=(
        DUAL + "<i>Tianlian</i> (天链, 'space link') — China's data-relay constellation, the "
        "analogue of NASA's TDRSS. Gives continuous contact with crewed missions and with LEO "
        "spacecraft outside ground-station coverage, which is the enabling layer for near-real-time "
        "tasking and downlink of reconnaissance data.")),

    dict(pattern=r"^TIANTONG", series="Tiantong (mobile comms)", func="COM", note=(
        DUAL + "<i>Tiantong</i> (天通) — geostationary L-band mobile satellite communications, "
        "China's own Inmarsat-equivalent, providing handheld satellite telephony across China and "
        "progressively across the Belt and Road footprint and the Indian Ocean.")),

    dict(pattern=r"^(TIANQI|XINGYUN)", series="Tianqi / Xingyun IoT", func="COM", note=(
        COM_ + "Narrowband LEO constellations for machine-to-machine and internet-of-things "
        "traffic — short bursts from unattended sensors, pipelines, shipping and vehicles rather "
        "than broadband. Tianqi is operated by Guodian Gaoke, Xingyun by CASIC.")),

    dict(pattern=r"^GEESAT", series="Geespace (Geely)", func="COM", note=(
        COM_ + "Geespace, the constellation of the carmaker Geely — built for high-precision "
        "positioning and connectivity for autonomous vehicles, and one of the clearest examples of "
        "Chinese industrial capital entering the LEO business for a non-space end market.")),

    # ---- weather, ocean, science -----------------------------------------
    dict(pattern=r"^(FENGYUN|FY)[\s-]", series="Fengyun (Wind & Cloud)", func="MET", note=(
        CIV + "<i>Fengyun</i> (风云, 'wind and cloud') — China's operational meteorological "
        "satellites, in two families: odd numbers in sun-synchronous polar orbit, even numbers in "
        "geostationary. Fengyun data is distributed internationally through the WMO and is a "
        "genuine public good. The series also carries the programme's worst moment: the destruction "
        "of Fengyun-1C in the January 2007 ASAT test.")),

    dict(pattern=r"^(HAIYANG|HY)[\s-]", series="Haiyang (Ocean)", func="OCN", note=(
        DUAL + "<i>Haiyang</i> (海洋, 'ocean') — ocean colour, sea-surface temperature, salinity "
        "and sea-state satellites. The HY-2 series carries radar altimeters and microwave "
        "scatterometers; altimetry over the ocean is a civil oceanography product and a submarine- "
        "and surface-operations input at once.")),

    dict(pattern=r"^YUNHAI", series="Yunhai", func="MET", note=(
        DUAL + "<i>Yunhai</i> (云海) — atmospheric, marine and space-environment survey, announced "
        "as civil meteorology with a disaster-mitigation role. Yunhai 1-02 was struck by debris from "
        "a Russian Zenit upper stage in March 2021, one of the few confirmed in-orbit collisions.")),

    dict(pattern=r"^(TIANMU|YUNYAO)", series="Tianmu / Yunyao (GNSS-RO)", func="MET", note=(
        COM_ + "Commercial meteorological constellations built on GNSS radio occultation — "
        "profiling the atmosphere by measuring how navigation signals bend as they graze the limb. "
        "A cheap, dense way to feed numerical weather prediction, and the same technique the US "
        "buys commercially from Spire and PlanetiQ.")),

    dict(pattern=r"^(SHENZHOU|SZ)[\s-]", series="Shenzhou (crewed)", func="SCI", note=(
        CIV + "<i>Shenzhou</i> (神舟, 'divine vessel') — China's crewed spacecraft, now flying "
        "rotation missions to the Tiangong station.")),

    dict(pattern=r"^(TIANGONG|TIANHE|WENTIAN|MENGTIAN|TIANZHOU)", series="Tiangong station",
         func="SCI", note=(
        CIV + "The Tiangong space station and its elements — Tianhe core module, the Wentian and "
        "Mengtian laboratory modules, and the Tianzhou cargo freighters that resupply them.")),

    dict(pattern=r"^(CHANGE|CHANG'E|QUEQIAO|YUTU)", series="Chang'e (lunar)", func="SCI", note=(
        CIV + "<i>Chang'e</i> (嫦娥) lunar programme and its Queqiao relay satellites, which make "
        "farside operations possible by holding station beyond the Moon.")),

    dict(pattern=r"^(FSW|JIAN BING)", series="FSW (recoverable)", func="ISR", note=(
        MIL + "<i>Fanhui Shi Weixing</i> — the recoverable film-return reconnaissance capsules that "
        "were China's imaging intelligence capability from 1975 until electro-optical downlink "
        "replaced them. Of historical rather than current interest, and almost all long decayed.")),

    dict(pattern=r"^(KUAIZHOU|KZ)[\s-]", series="Kuaizhou", func="RPO", note=(
        MIL + "Payloads of the Kuaizhou ('fast vessel') solid-fuel launcher, a CASIC system derived "
        "from missile technology and built for responsive launch — the ability to put a replacement "
        "or augmentation satellite up quickly is itself the capability being demonstrated.")),

    dict(pattern=r"^(ZHUHAI|OHS|OVS)", series="Zhuhai-1 (Orbita)", func="ISR", note=(
        COM_ + "Zhuhai-1, operated by Orbita Aerospace — commercial hyperspectral and video "
        "imaging. Hyperspectral data supports material identification rather than shape "
        "recognition, which is why it appears in agricultural and in camouflage-detection contexts "
        "alike.")),

    dict(pattern=r"^(DAMPE|HXMT|INSIGHT|EINSTEIN|SVOM|TAIJI|QUESS|MICIUS|MOZI|XUNTIAN)",
         series="Science mission", func="SCI", note=(
        CIV + "A dedicated science spacecraft rather than an applications satellite. China's "
        "science line includes dark-matter particle detection (DAMPE), X-ray astronomy (Insight-"
        "HXMT, Einstein Probe), gamma-ray burst work with France (SVOM) and the Micius quantum-"
        "communications experiment, which demonstrated satellite-relayed quantum key distribution "
        "for the first time.")),

    # ---- the unclassified rows that turned out to have a story ----------
    dict(pattern=r"^PRC TEST SPACECRAFT", series="Reusable experimental spacecraft", func="RPO",
         note=(
        MIL + "China's <b>reusable experimental spacecraft</b> — an uncrewed spaceplane, launched "
        "on a Long March 2F from Jiuquan and landed horizontally, and the closest analogue to the "
        "US X-37B. Catalogued only as a test spacecraft because China announces nothing beyond "
        "verifying reusable technology and conducting space experiments. The third flight stayed up "
        "<b>267 days</b> (14 December 2023 to September 2024) and raised itself from about 300 km "
        "to 600 km in January. US tracking picked up an object alongside it, which Jonathan "
        "McDowell noted could be a deployed subsatellite or simply hardware ejected before de-orbit "
        "— no source settles which. A fourth flight launched on 7 February 2026. "
        "<a href='https://spacenews.com/chinas-secretive-reusable-spaceplane-lands-after-267-days-in-orbit/' "
        "target='_blank' rel='noopener noreferrer'>SpaceNews</a>")),

    dict(pattern=r"^DRO-", series="DRO (Earth-Moon navigation)", func="SCI", note=(
        CIV + "The Chinese Academy of Sciences' <b>distant retrograde orbit</b> experiment: DRO-A "
        "and DRO-B far beyond the Moon, with DRO-L in low Earth orbit as the third node, testing "
        "autonomous navigation across cislunar space by inter-satellite ranging rather than from "
        "the ground. It nearly did not happen — the Yuanzheng-1S upper stage failed on 13 March "
        "2024 and left the pair tumbling in the wrong orbit. Controllers stopped the spin using "
        "DRO-B's attitude thrusters, then flew a series of perigee kicks over four months; by "
        "August 2024 tracking showed both in the intended orbit. CAS reported the three-satellite "
        "network operating in March 2026. The salvage is the most impressive piece of flying in "
        "this catalogue. "
        "<a href='https://spacenews.com/mission-team-details-complex-rescue-of-chinese-lunar-spacecraft/' "
        "target='_blank' rel='noopener noreferrer'>SpaceNews</a>")),

    dict(pattern=r"^LONGJIANG", series="Longjiang (HIT)", func="SCI", note=(
        CIV + "Harbin Institute of Technology microsatellites. Longjiang-1 and -2 rode with the "
        "Queqiao lunar relay in May 2018 as a radio-astronomy and amateur-radio pair bound for "
        "lunar orbit; Longjiang-1 was lost on the way, Longjiang-2 reached the Moon and returned "
        "amateur-received imagery before being de-orbited onto the surface. Longjiang-3 (2023) is "
        "a separate Earth-orbiting technology satellite that shares only the name.")),

    dict(pattern=r"^LKW", series="LKW (Ludi Kance)", func="ISR", note=(
        MIL + "<i>Ludi Kance Weixing</i> (陆地勘查卫星, 'land survey satellite') — a short optical "
        "reconnaissance series flown to sun-synchronous orbit in 2017–18 and announced only as land "
        "survey. Treated in Western analysis as military imaging under a civil label, the same "
        "pattern as the higher Gaofen numbers.")),

    dict(pattern=r"^(XW-|CAS-\d)", series="XW / CAS (CAMSAT amateur radio)", func="SCI", note=(
        CIV + "CAMSAT's amateur-radio satellites, carrying linear transponders and telemetry "
        "beacons open to licensed operators worldwide. Each also holds an international OSCAR "
        "designation (CAS-n / XW-n). Genuinely open hardware in a catalogue where most of the "
        "interesting objects are not.")),

    dict(pattern=r"^(TIANYAN|XINGSHIDAI|HONGHU|DONGPO|SCS-|GJZ)", series="Commercial smallsat",
         func="OTH", note=(
        COM_ + "A Chinese commercial smallsat — the Tianyan, Xingshidai, Honghu, Dongpo, SCS and "
        "GJZ names belong to private and provincially-backed operators flying remote sensing, IoT "
        "relay and technology demonstrations. Little is published about any individual spacecraft; "
        "they are catalogued and tracked, and that is most of what is known.")),

    dict(pattern=r"^XJS", series="XJS (new-technology test)", func="RPO", note=(
        MIL + "<i>Xinjishu Shiyan</i> (新技术试验, 'new technology test') — a second cover line "
        "alongside TJS, flown to SSO rather than GEO. Announced only as technology verification; "
        "no payload detail has been released for any member of the series.")),

    dict(pattern=r"^TIANPING", series="Tianping (calibration)", func="RPO", note=(
        MIL + "<i>Tianping</i> (天平, 'balance') — radar calibration targets. Spheres and simple "
        "bodies of precisely known radar cross-section, used to calibrate ground radars and refine "
        "atmospheric-drag models. Unglamorous and quietly important: the accuracy of a space "
        "surveillance network is set by what it has to calibrate against.")),

    dict(pattern=r"^(TIANYI|XIAOXIANG)", series="Tianyi / Xiaoxiang (Spacety)", func="RPO", note=(
        COM_ + "Commercial smallsat technology demonstrators from Spacety (Changsha Tianyi), "
        "flown as rideshare testbeds for third-party payloads. Spacety was <b>sanctioned by the US "
        "Treasury in January 2023</b> for supplying SAR imagery of Ukraine to the Wagner Group — "
        "the first time a Chinese commercial space company was sanctioned over a conflict.")),

    dict(pattern=r"^HEAD", series="HEAD Aerospace", func="COM", note=(
        COM_ + "HEAD Aerospace's constellation, carrying AIS ship-tracking and ADS-B aircraft-"
        "tracking receivers alongside IoT relay — maritime and air domain awareness sold as a "
        "commercial data product.")),

    dict(pattern=r"^STTW", series="STTW (first comms satellites)", func="COM", note=(
        CIV + "<i>Shiyan Tongxin Weixing</i> — China's first communications satellites, from the "
        "1980s. Historical interest: these are the spacecraft that made a domestic satellite "
        "broadcast network possible and opened the geostationary programme.")),

    dict(pattern=r"^NINGXIA", series="Ningxia-1", func="ISR", note=(
        COM_ + "Ningxia-1, a commercial remote-sensing cluster operated out of the Ningxia "
        "autonomous region. The series is poorly documented and has attracted analyst attention "
        "mainly because its stated civil purpose sits oddly with its launch profile.")),

    dict(pattern=r"^OBJECT [A-Z]", series="Unnamed catalogue object", func="OTH", note=(
        "<span class='flag flag-unk'>UNK</span>Catalogued by the US Space Force without a name "
        "being released or identified. Objects sit in this state for two quite different reasons: "
        "they are recent deployments from a megaconstellation batch that the catalogue has not yet "
        "matched to its programme designation, or they are payloads whose operator has never "
        "announced them. Orbit and launch association are the only evidence available; the COSPAR "
        "id's launch field is the fastest way to tie one back to its flight.")),
]

# ---------------------------------------------------------------------------
# SATS — individual remarks, keyed by catalogue name (upper-case, exact).
# These override the series note.  Kept for the satellites that are
# individually significant, individually reported, or individually odd.
# ---------------------------------------------------------------------------
SATS = {
    # ---- TJS, one by one where open sources say something specific -------
    "TJS-1": MIL + "First of the cover-name series, October 2015, to GEO. Retrospectively read as "
             "the start of the Huoyan-1 missile early-warning line rather than a communications "
             "test.",
    "TJS-2": MIL + "January 2017. Widely assessed as the first <b>Qianshao-3</b> class SIGINT "
             "platform — a geostationary electronic-intelligence collector, the role the US fills "
             "with its Advanced Orion/Mentor spacecraft.",
    "TJS-3": MIL + "December 2018, and the most-watched of the series: TJS-3 released a "
             "<b>subsatellite</b>, and the pair have since been observed manoeuvring in GEO in ways "
             "consistent with inspection or decoy behaviour. McDowell and Gunter's both place it "
             "outside the Qianshao/Huoyan classes, in an unidentified third category.",
    "TJS-5": MIL + "January 2020 to GEO. Assessed as Qianshao-3 class SIGINT.",
    "TJS-6": MIL + "February 2021. Early-warning class on orbital grounds — the Huoyan-1 "
             "infrared line, whose job is detecting missile launches from geostationary stare.",
    "TJS-10": MIL + "Launched on a Long March 7A. Public attribution is unsettled; the LM-7A "
              "profile places it in GEO with the rest of the series.",
    "TJS-11": MIL + "February 2024. Gunter's Space Page groups it tentatively with TJS-20 and "
              "TJS-23 and notes it may in fact be a SIGINT mission — the grouping is by launch "
              "vehicle and orbit, and the page is explicit that satellites grouped this way may "
              "turn out to have different missions.",
    "TJS-14": MIL + "Launched 23 January and stationed at <b>18.4°E</b> — a slot over Africa, well "
              "west of China. McDowell's 2026 survey records it as possibly a <b>Huoyan</b> "
              "early-warning satellite; a westward slot suits watching launch areas that are not on "
              "China's own doorstep.",
    "TJS-20": MIL + "23 October 2025, on a <b>Long March 5</b> from Wenchang. The heavy-lift "
              "vehicle is the tell: McDowell assesses the CZ-5-launched TJS satellites as likely "
              "SIGINT, possibly replacing the Qianshao-3 class with a larger-aperture successor. A "
              "bigger antenna is the whole point of paying for a bigger rocket.",
    "TJS-21": MIL + "21 November 2025, Long March 3B from Xichang. CASC gave the standard "
              "communications-test boilerplate, but the launch went to a <b>high inclination</b> "
              "and SpaceNews reported it as heading for a <b>Molniya-type</b> orbit rather than the "
              "geostationary belt the series normally occupies. A Molniya orbit buys long dwell "
              "over high latitudes — the regime used for northern early warning and for "
              "communications above the GEO horizon.",
    "TJS-23": MIL + "Long March 5 from Wenchang. Grouped with TJS-20 as a probable large SIGINT "
              "platform on launch-vehicle and orbit evidence.",
    "TJS-25": MIL + "11 June 2026, Long March 5. The fourth of the heavy-lift TJS flights, "
              "consistent with a continuing build-out of the larger SIGINT class.",

    # ---- Gaofen, where the series splits at number 8 ---------------------
    "GAOFEN-1": CIV + "First CHEOS satellite, April 2013. 2 m panchromatic / 8 m multispectral "
                "plus a 16 m wide-field camera giving a four-day revisit — the combination that set "
                "the civil pattern for the series. Fully documented in eoPortal; data distributed "
                "for agriculture, land use and disaster response.",
    "GAOFEN-2": CIV + "August 2014. <b>0.8 m panchromatic</b> — China's first civil sub-metre "
                "optical imager, and the point at which Chinese open imagery became competitive "
                "with the Western commercial providers.",
    "GAOFEN-3": DUAL + "August 2016. C-band synthetic-aperture radar with twelve imaging modes "
                "down to 1 m in spotlight — all-weather, day-and-night. Chinese researchers have "
                "published <b>SAR ground-moving-target indication</b> results from its dual-channel "
                "mode: detecting and measuring moving vehicles and ships from orbit, which is a "
                "civil traffic-monitoring technique and a targeting technique in the same breath.",
    "GAOFEN-4": DUAL + "December 2015, and the odd one out: a <b>geostationary</b> optical imager "
                "at 50 m resolution. Coarse by the series' standards, but a GEO stare never leaves "
                "its hemisphere, so it gives persistent minute-by-minute watch of a whole region "
                "rather than a twice-daily strip — the orbit choice is the capability.",
    "GAOFEN-5 01": CIV + "Hyperspectral observation with atmospheric trace-gas instruments; built "
                   "for pollution monitoring and mineral survey, with published WMO instrument "
                   "specifications.",
    "GAOFEN-6": CIV + "June 2018. Wide-field agricultural monitoring, paired in orbit with "
                "Gaofen-1 to tighten the revisit.",
    "GAOFEN-7": CIV + "November 2019. Stereo mapping to 1:10,000 scale with a laser altimeter for "
                "height control. <b>The last Gaofen with openly published technical detail</b>.",
    "GAOFEN-8": DUAL + "June 2015 — and the point the series goes dark. No resolution, no "
                "instrument description and no imagery have been released for Gaofen-8 or for any "
                "higher number. SpaceNews has noted the blackout above GF-7 explicitly; the silence "
                "is the evidence, not a published claim.",
    "GAOFEN-11 01": DUAL + "July 2018. Optical, and assessed as the sharpest in the Chinese "
                    "inventory — a Chinese geodesy journal has been cited as crediting it with "
                    "imagery on the order of <b>10 cm</b>. That is reconnaissance resolution, and "
                    "nothing about the satellite has been released officially.",
    "GAOFEN-13 01": DUAL + "October 2020, to <b>geostationary</b> orbit at about 15 m resolution. "
                    "WMO OSCAR lists it for high-resolution land observation and disaster "
                    "monitoring and tags its data access as <b>dual-use (military-civilian)</b> — "
                    "one of the few places the dual-use label is applied in an official database "
                    "rather than inferred. Its imagery is not openly distributed.",
    "GAOFEN-14 01": DUAL + "December 2020. Stereo mapping with dual line-array cameras, a "
                    "hyperspectral camera and a ranging laser, at roughly 0.6 m panchromatic, "
                    "described in a 2023 technical paper as built for high-precision positioning "
                    "and 1:10,000-scale mapping. Precision geodesy of foreign terrain is the input "
                    "a cruise missile's terrain-matching guidance runs on.",

    # ---- the RPO spacecraft that matter ----------------------------------
    "SHIJIAN-17 (SJ-17)": DUAL + "Shijian-17, 2016, to GEO. One of the first Chinese spacecraft observed making "
             "deliberate close approaches to other satellites in the geostationary belt, tracked by "
             "commercial SSA operators. Officially an electric-propulsion and space-debris "
             "observation technology test.",
    "SHIJIAN-20 (SJ-20)": DUAL + "Shijian-20 — the DFH-5 heavy GEO bus demonstrator, China's largest "
             "communications platform, flown to prove the bus that later commercial and government "
             "payloads would use.",
    "SHIJIAN-21 (SJ-21)": DUAL + "Shijian-21, January 2022, and the single most consequential RPO event in the "
             "catalogue: it <b>docked with the defunct BeiDou-2 G2</b> satellite and towed it from "
             "the geostationary belt into a graveyard orbit several hundred kilometres above, then "
             "returned. Presented as debris mitigation, and it genuinely is one — but a vehicle "
             "that can grapple and move another country's satellite without consent is a "
             "counterspace capability, and it is cited as such in every serious assessment since.",
    "SHIJIAN-23 (SJ-23)": DUAL + "Shijian-23, launched with two smaller companions. Subsequent manoeuvres in "
             "GEO have been followed closely by commercial trackers.",
    "SHIJIAN-25 (SJ-25)": DUAL + "Shijian-25, launched January 2025 to demonstrate <b>on-orbit refuelling and "
             "life extension</b>. Through 2025 it was observed closing on Shijian-21 in GEO in a "
             "long, carefully staged approach — the first Chinese satellite-servicing rendezvous "
             "between two of its own spacecraft, and watched by Western trackers for exactly the "
             "dual-use reason that refuelling hardware and grappling hardware are the same hardware.",

    # ---- historically important, kept even though gone -------------------
    "FENGYUN 1C": MIL + "<b>Destroyed on 11 January 2007</b> by a Chinese SC-19 direct-ascent "
                  "anti-satellite missile, at about 865 km — the single worst debris-generating "
                  "event in the history of spaceflight. More than 3,000 catalogued fragments, the "
                  "majority still in orbit two decades later and expected to remain for centuries. "
                  "The test is the origin point of modern counterspace policy debate and of the "
                  "international norm-setting effort against destructive ASAT testing; it is kept "
                  "in this catalogue although the satellite no longer exists, because the debris "
                  "field it created is still the defining feature of that altitude band. NAZAR's "
                  "Debris Tracker carries the fragments and a long-read on the test.",
    "SHENZHOU-5 (SZ-5)": CIV + "19 October 2003 — Yang Liwei's flight, which made China the third nation "
                  "to launch a human into orbit on its own.",
    "DFH 1": CIV + "China's first satellite, 24 April 1970, which broadcast the song it "
                        "was named after. Still in orbit; long silent.",
    "TIANGONG-1": CIV + "China's first space laboratory, 2011. Control was lost in 2016 and it made "
                  "an <b>uncontrolled re-entry</b> over the South Pacific in April 2018, an episode "
                  "that drew sustained international criticism over re-entry notification.",
    "TIANGONG-2": CIV + "Second space laboratory, 2016, and the counter-example to Tiangong-1: "
                  "deliberately de-orbited under control in July 2019.",
    "YAOGAN-50 02": MIL + "Broke up in orbit in September 2026. CelesTrak published no fragment "
                 "element sets for the event, and the debris appears in NAZAR's Debris Tracker only "
                 "through the Space-Track catalogue.",
    "YUNHAI-1 02": DUAL + "<b>Struck by debris</b> in March 2021 — a fragment from a Russian Zenit-2 "
                   "upper stage launched in 1996 — in one of the very few confirmed, identified "
                   "satellite-debris collisions on record. The satellite survived and continued "
                   "operating.",
    "QSS (MOZI)": CIV + "Quantum Experiments at Space Scale (QUESS), 2016. Demonstrated satellite-to-"
              "ground quantum key distribution and entanglement distribution over 1,200 km — the "
              "first spacecraft to do so, and the basis of China's claim to a lead in quantum "
              "communications. Catalogued as QSS (Mozi, 墨子) after the ancient philosopher; it "
              "re-entered on 25 January 2026 after nine and a half years.",

    # ---- BeiDou specifics -------------------------------------------------
    "BEIDOU-2 G2": DUAL + "Failed after launch in 2009 and drifted uncontrolled through the "
                   "geostationary belt for over a decade — until <b>Shijian-21 docked with it in "
                   "January 2022</b> and towed it to a graveyard orbit. The clean-up target in the "
                   "most-studied RPO operation China has conducted.",
}

# Flags for the status column, by what the catalogue can prove.
FLAG_CSS = {
    "MIL": "Military / PLA-tasked",
    "DUAL": "Dual-use",
    "CIV": "Civil",
    "COM": "Commercial",
}
