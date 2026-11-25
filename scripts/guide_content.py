# -*- coding: utf-8 -*-
"""The prose of docs/NAZAR-Field-Guide.pdf.

Kept apart from gen_guide_pdf.py so the layout machinery and the writing can be
edited without tripping over each other.  compose() is handed the generator's
module globals and calls its builders (P, H2, CODE, NOTE, TABLE, FAQ, STEP).

Everything factual here is checked against the repository, not remembered:
cron lines from .github/workflows/, cache lifetimes and endpoints from
tle-loader.js, feed counts and caps from news-core.js, library versions from
the script tags.  If you change one of those, change it here too - a guide that
has drifted from the code is worse than no guide.

WinAnsi only (built-in fonts): write '->' not an arrow, '<=' not an inequality,
and no emoji.  Paragraph text is parsed as markup, so escape &amp; &lt; &gt;.
"""


def compose(g):
    P, BULLETS, GAP = g['P'], g['BULLETS'], g['GAP']
    H2, H3, PART = g['H2'], g['H3'], g['PART']
    CODE, NOTE, TABLE, FAQ, STEP = g['CODE'], g['NOTE'], g['TABLE'], g['FAQ'], g['STEP']
    Paragraph, Spacer, PageBreak = g['Paragraph'], g['Spacer'], g['PageBreak']
    NextPageTemplate, TableOfContents = g['NextPageTemplate'], g['TableOfContents']
    story, S = g['story'], g['S']

    # ---------------------------------------------------------------- cover
    story.append(Spacer(1, 1))
    story.append(NextPageTemplate('plain'))
    story.append(PageBreak())

    # ------------------------------------------------------- how to read it
    story.append(Paragraph('How to read this guide', g['ParagraphStyle'](
        'intro', fontName='Helvetica-Bold', fontSize=19, leading=23,
        textColor=g['INK'], spaceAfter=12)))
    P('This document explains a working website called NAZAR: what it does, how every '
      'part of it is built, where its data comes from, and how you could build one '
      'like it yourself. It assumes you have never written a line of code and have '
      'never used GitHub. Where a technical word is unavoidable it is explained the '
      'first time it appears, and the glossary at the very end collects them all.', 'lead')
    P('The guide is in six parts, and <b>each part has its own colour</b> - on the '
      'divider page, on the band at the top of every page, on the section headings and '
      'on the page number. If you only want one thing, the colour tells you when you '
      'have arrived.')
    GAP(2)

    TABLE(['Part', 'What it covers', 'Read it if'],
          [['1 &middot; The big picture',
            'What the site is and the single idea that makes it possible.',
            'You want to understand the shape of the thing before the detail.'],
           ['2 &middot; Where the data comes from',
            'Every outside source, what a satellite orbit file actually is, and the '
            'robots that fetch fresh data on a timetable.',
            'You want to know what is real-time, what is a snapshot, and how often.'],
           ['3 &middot; How the pieces are built',
            'The globe, the maps, the Google Earth link, the news ticker, the '
            'passwords, the analytics - one section each.',
            'You are curious how a particular feature works.'],
           ['4 &middot; Build one yourself',
            'A numbered path from no account at all to a live website with live data '
            'refreshing itself.',
            'You want to make one. Start here and ignore the rest.'],
           ['5 &middot; Questions and answers',
            'The questions this site most often prompts, answered in one place.',
            'You have a specific question.'],
           ['6 &middot; Reference',
            'Every page, data file and script in a table, plus a glossary.',
            'You are looking something up.']],
          [34, 76, 55])

    NOTE('plain',
         'Three kinds of box appear throughout. <b>In plain words</b> restates something '
         'technical in ordinary language. <b>Why it is done this way</b> gives the '
         'reasoning behind a decision that might otherwise look arbitrary. '
         '<b>A trap to avoid</b> is a mistake that was actually made while building '
         'this site, recorded so you do not repeat it.',
         'ABOUT THE COLOURED BOXES')

    story.append(PageBreak())

    # ----------------------------------------------------------------- TOC
    story.append(Paragraph('Contents', g['ParagraphStyle'](
        'toch', fontName='Helvetica-Bold', fontSize=19, leading=23,
        textColor=g['INK'], spaceAfter=14)))
    toc = TableOfContents()
    toc.levelStyles = [S['toc0'], S['toc1']]
    toc.dotsMinLevel = 1
    story.append(toc)

    # ======================================================================
    PART(1, 'What the site is, and the single idea that makes a project '
            'like this possible without a penny of running cost.')
    # ======================================================================

    H2('1.1', 'What NAZAR is')
    P('NAZAR is a website that shows where satellites are. It began as a tool for '
      'watching Chinese spacecraft and grew into something broader: live three-dimensional '
      'globes carrying the whole catalogue of active satellites, a tracker for orbital '
      'debris, an atlas of the world’s launch sites, reference catalogues of the '
      'Chinese and Indian space industries, a rolling archive of space news, and a set '
      'of analytical tools for questions like <i>which satellites can see this patch of '
      'ground in the next hour</i>.')
    P('It currently runs to <b>36 pages</b>. You can open it at '
      '<b>hitesh-gala.github.io/sat-orbit-map</b> and every line of its source is public '
      'at <b>github.com/Hitesh-Gala/sat-orbit-map</b>.')

    H2('1.2', 'The one idea: a website with no computer behind it')
    P('Most websites you use work like a restaurant. You ask for a page, a computer '
      'somewhere - a <b>server</b> - receives your request, looks things up in a '
      'database, cooks up a page specially for you and sends it back. That computer has '
      'to be rented, kept running, kept patched and kept paid for, every hour of every '
      'day, whether anyone visits or not.')
    P('NAZAR works like a library instead. Every page is a finished file sitting on a '
      'shelf. When you visit, copies of those files are handed to your browser, and '
      '<b>your own computer does all the work</b> - including the orbital mathematics '
      'for sixteen thousand satellites, several times a second. Nothing is computed on '
      'a server, because there is no server to compute it on.')

    NOTE('plain',
         'A <b>static site</b> is a website made only of finished files - pages, '
         'pictures, scripts, data - with no program running behind it. GitHub will '
         'host one for you at no charge, forever, under a service called '
         '<b>GitHub Pages</b>. That is the whole trick. NAZAR costs nothing to run, '
         'and it cannot be hacked in the usual sense, because there is nothing running '
         'to break into.')

    P('This single decision shapes everything else in this guide. It explains why the '
      'satellite positions are calculated in your browser rather than looked up; why '
      'fresh data arrives on a timetable rather than on demand; why the password '
      'protection works the way it does and what it can and cannot promise; and why '
      'there is no database anywhere in the project.')

    H3('What it costs')
    TABLE(['Item', 'Cost'],
          [['GitHub account', 'Free'],
           ['Hosting (GitHub Pages)', 'Free, unmetered for a site this size'],
           ['The scheduled robots that fetch fresh data (GitHub Actions)',
            'Free for public repositories'],
           ['Satellite data (CelesTrak, Space-Track)',
            'Free. Space-Track needs a free account; CelesTrak needs nothing'],
           ['Map and globe software (globe.gl, three.js, satellite.js)',
            'Free and open-source'],
           ['Visitor analytics (a Google Sheet)', 'Free'],
           ['Contact form relay (Web3Forms)', 'Free tier'],
           ['<b>Total</b>', '<b>Nothing</b>']],
          [110, 55])

    H2('1.3', 'What happens when you open a page')
    P('It is worth following the sequence once, because almost every page works this '
      'way. Suppose you open the main globe.')
    BULLETS([
        '<b>Your browser asks GitHub for the page.</b> GitHub sends back '
        '<font face="Courier">index.html</font> - a text file describing what is on the '
        'page. This takes a fraction of a second and is the only thing GitHub does.',
        '<b>The page asks for its helpers.</b> Inside that file are references to a '
        'stylesheet (which decides how things look), and to several scripts - small '
        'programs written in JavaScript, the language browsers speak.',
        '<b>The scripts ask for satellite data.</b> One of them, '
        '<font face="Courier">tle-loader.js</font>, goes out to CelesTrak and asks for '
        'the current orbital elements of every active satellite. That is about 2.6 '
        'megabytes of plain text.',
        '<b>Your computer does the mathematics.</b> Another script turns each of those '
        'orbit descriptions into a position above the Earth, for this exact instant, '
        'using a standard algorithm called SGP4. Sixteen thousand of them.',
        '<b>The globe is drawn.</b> A three-dimensional Earth appears with a dot at '
        'each position, drawn by your graphics card.',
        '<b>And it repeats.</b> Every few seconds the positions are recalculated and '
        'the dots move. Nothing is fetched again; the same orbit descriptions are '
        'simply evaluated for a later moment.',
    ])
    NOTE('why',
         'Notice what is <i>not</i> happening. Nobody is sending you satellite positions. '
         'You were sent a <i>description of each orbit</i>, once, and your own machine '
         'works out where that orbit puts the satellite at any moment you like - now, '
         'an hour ago, or next Tuesday. That is why the site can offer time travel, '
         'animation and prediction without any server: the maths is local, so the '
         'future is as cheap as the present.')

    H2('1.4', 'The anatomy of the repository')
    P('All the files live in one folder on GitHub, called a <b>repository</b>. The '
      'arrangement is deliberately plain - there is no build step, no bundler, no '
      'compilation. What is in the repository is exactly what the browser receives.')
    TABLE(['What', 'What it is'],
          [['<font face="Courier">index.html</font> and 35 other '
            '<font face="Courier">.html</font> files',
            'One per page. The structure and text of that page.'],
           ['A matching <font face="Courier">.js</font> file per page',
            'The behaviour of that page. <font face="Courier">app.js</font> drives '
            '<font face="Courier">index.html</font>, '
            '<font face="Courier">debris.js</font> drives '
            '<font face="Courier">debris.html</font>, and so on.'],
           ['<font face="Courier">styles.css</font>',
            'One shared stylesheet for the whole site - colours, spacing, type.'],
           ['<font face="Courier">tle-loader.js</font>',
            'The shared data layer. Every page that needs satellites loads this and '
            'nothing else has to know where the data comes from.'],
           ['<font face="Courier">data/</font>',
            'Roughly 25 megabytes of bundled data - catalogue snapshots, reference '
            'catalogues, photographs, map outlines.'],
           ['<font face="Courier">scripts/</font>',
            'Python programs that are <b>never</b> sent to the browser. They run on '
            'GitHub’s machines to build the files in '
            '<font face="Courier">data/</font>.'],
           ['<font face="Courier">.github/workflows/</font>',
            'Three timetables telling GitHub when to run those Python programs.'],
           ['<font face="Courier">docs/</font>',
            'Documents like the one you are reading.']],
          [52, 113])
    NOTE('plain',
         'The split between <font face="Courier">scripts/</font> and everything else is '
         'the most important line in the project. Anything in '
         '<font face="Courier">scripts/</font> runs <b>on GitHub’s computers, on a '
         'schedule</b>, and may use passwords. Everything else runs <b>in the visitor’s '
         'browser</b> and is readable by anyone. A secret may never cross that line.')

    H2('1.5', 'How the pages fit together')
    P('The pages fall into four families, and knowing which family a page belongs to '
      'tells you immediately where its data comes from.')
    TABLE(['Family', 'Examples', 'Where its data comes from'],
          [['<b>Live trackers</b>',
            'Main globe, God Mode, Sats by Operator, Debris Tracker, Mirror Globe, '
            'Dog-Fights',
            'Fetched from CelesTrak when you open the page, then calculated in your '
            'browser, continuously.'],
           ['<b>Analytical tools</b>',
            'Cone Waffles, One Hour Lead, Traffic-Conjunctions, Orbit Maker, 2D Views',
            'The same catalogue, but the page runs a search or a simulation over it '
            'rather than just displaying it.'],
           ['<b>Reference catalogues</b>',
            'PRC Orbital Catalog, Indi-Space, Rocket Models, Launch Atlas, Debris '
            'Statistics',
            'A finished data file in <font face="Courier">data/</font>, prepared in '
            'advance by a Python script. Nothing is fetched live.'],
           ['<b>Meta pages</b>',
            'About, Site Analytics, News Archive',
            'The site’s own records - visitor log, news archive - rather than '
            'satellite data.']],
          [30, 58, 77])

    # ======================================================================
    PART(2, 'Every outside source the site touches, what satellite orbit data '
            'actually is, and the three robots that keep it fresh.')
    # ======================================================================

    H2('2.1', 'The outside world, in one table')
    P('NAZAR is static, but it is not sealed. Data arrives from outside in two quite '
      'different ways, and the distinction matters: either <b>your browser fetches it '
      'while you are looking at the page</b>, or <b>a robot fetched it earlier and '
      'committed the result into the repository</b>.')
    TABLE(['Source', 'What it gives', 'Fetched by', 'How often'],
          [['<b>CelesTrak</b><br/>celestrak.org',
            'Orbital elements for every active satellite; the master catalogue of every '
            'cataloged object; debris groups',
            'Your browser, and a robot',
            'Browser: on page load, cached 6 h.<br/>Robot: every 6 h'],
           ['<b>Space-Track</b><br/>space-track.org',
            'The US government catalogue - more complete than CelesTrak, and it carries '
            'brand-new launches first. Needs a free login.',
            'Robot only',
            'Daily'],
           ['<b>CelesTrak SOCRATES</b>',
            'Predicted close approaches between satellites over the coming week',
            'Robot only',
            'Daily'],
           ['<b>35 news sources</b><br/>26 RSS feeds + 9 Google News topic searches',
            'SpaceNews, ESA, LeoLabs, Breaking Defense, US Space Force and others',
            'Your browser',
            'At most twice an hour'],
           ['<b>The Space Devs</b><br/>Launch Library',
            'Launch-vehicle facts and photographs',
            'Robot, one-off',
            'When asked'],
           ['<b>Wikimedia Commons</b>',
            'Freely licensed photographs of rockets and spaceports',
            'Robot, one-off',
            'When asked'],
           ['<b>Natural Earth</b>',
            'Country outlines for the political globe and flat maps',
            'Downloaded once',
            'Never changes'],
           ['<b>Esri World Imagery</b>',
            'Satellite photography tiles in the launch-site pop-up',
            'Your browser',
            'On demand'],
           ['<b>ipwho.is / geojs.io</b>',
            'Approximate city and country of a visitor, for the analytics log',
            'Your browser',
            'Once per visit'],
           ['<b>Google Sheets</b>',
            'Stores the visitor log',
            'Your browser writes to it',
            'Per visit'],
           ['<b>Web3Forms</b>',
            'Relays the feedback form to the owner’s email',
            'Your browser',
            'On submit']],
          [33, 60, 32, 40])

    H2('2.2', 'What a TLE is, and what SGP4 does with it')
    P('This is the single most useful thing to understand about the whole site.')
    P('A satellite’s orbit can be described by a handful of numbers: how big the '
      'orbit is, how elliptical, how tilted relative to the equator, which way it '
      'points, and where the satellite was along it at one known moment. Package those '
      'numbers in a fixed format that fits on two 69-character lines and you have a '
      '<b>Two-Line Element set</b>, universally called a <b>TLE</b>. It looks like this:')
    CODE('NVS-03\n'
         '1 A1228U 26245A   26308.24702222 -.00000277  00000-0  00000-0 0  9999\n'
         '2 A1228  30.2704 254.0064 0047432 164.7557 195.3378  0.99648460   100',
         'A real TLE from the catalogue: India’s NVS-03 navigation satellite. Three '
         'lines - a name and the two numbered lines that give the format its name.')
    P('Reading a few of the fields makes it concrete. On line 2, '
      '<font face="Courier">30.2704</font> is the <b>inclination</b> - the orbit is '
      'tilted 30.27 degrees to the equator. <font face="Courier">0047432</font> is the '
      '<b>eccentricity</b>, 0.0047432, so the orbit is very nearly a circle. '
      '<font face="Courier">0.99648460</font> is the <b>mean motion</b>: the satellite '
      'goes round 0.9965 times per day, which is to say roughly once a day, which is '
      'what a navigation satellite in that family does. On line 1, '
      '<font face="Courier">26308.24702222</font> is the <b>epoch</b> - day 308 of '
      '2026, about six in the morning - the moment all these numbers were true.')

    NOTE('plain',
         'A TLE is not a position. It is a <b>recipe for working out the position at any '
         'time you choose</b>. That is why it is so small, and why a 2.6-megabyte file '
         'can drive a globe that animates smoothly for hours.')

    P('The recipe is executed by an algorithm called <b>SGP4</b> - Simplified General '
      'Perturbations, model 4. It is public, standardised, and dates from the 1960s and '
      '70s. Give it a TLE and a moment in time and it returns where the satellite is. '
      'NAZAR uses a JavaScript implementation called <b>satellite.js</b>, which runs '
      'inside your browser.')
    P('SGP4 is approximate by design - it accounts for the Earth’s bulge and '
      'atmospheric drag, but not for everything. Over a few days its error is typically '
      'a kilometre or so, which is excellent for showing where things are and quite '
      'insufficient for deciding whether two satellites will collide. The site says so '
      'wherever the distinction matters.')
    NOTE('gotcha',
         'SGP4 describes <b>one unperturbed orbit</b>. If a satellite fires its engine, '
         'no TLE from before the burn can tell you where it went - running that TLE '
         'forward gives you where the satellite <i>would</i> have been had it never '
         'manoeuvred. This is not a subtlety: on the Dog-Fights page, a famous October '
         '2026 rendezvous between Cosmos 2612 and ICEYE-X36 computed to <b>471 km</b> '
         'from a TLE published ten days later, against a true closest approach of '
         '<b>39 metres</b>. The fix was to keep every TLE ever published for those '
         'objects and always use the freshest one that precedes the moment being asked '
         'about. That is what <font face="Courier">data/tle-history.json</font> is for.')

    H2('2.3', 'CelesTrak, and the rate limit that shapes the design')
    P('<b>CelesTrak</b> is a long-running, public, free service run by Dr T.S. Kelso '
      'that republishes the US catalogue in convenient forms. It needs no account. '
      'NAZAR asks it for one thing above all:')
    CODE('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&amp;FORMAT=tle')
    P('That returns a TLE for every active satellite - about 16,000 objects. The site '
      'also uses CelesTrak’s master catalogue (the <b>SATCAT</b>), which carries '
      'names, owners, launch dates and status for every object ever catalogued.')
    NOTE('gotcha',
         'CelesTrak rate-limits aggressively. Ask too often from one address and it '
         'returns <b>403 Forbidden</b>, sometimes after only a handful of page reloads '
         'during development. Any serious use has to assume the request will fail '
         'sometimes. Note also the difference between its <i>dynamic</i> endpoints '
         '(<font face="Courier">gp.php</font>, '
         '<font face="Courier">records.php</font>), which are rate-limited, and its '
         '<i>static</i> files (<font face="Courier">/pub/satcat.csv</font>), which are '
         'not. Where a static file will do, NAZAR uses it.')
    P('The answer is a three-stage fallback, and it is worth copying in any project that '
      'depends on someone else’s free service:')
    BULLETS([
        '<b>First, look in the browser’s own storage.</b> If this browser fetched '
        'the catalogue less than <b>6 hours</b> ago, that copy is still good enough. '
        'Use it and make no network request at all.',
        '<b>Otherwise, ask CelesTrak.</b> If it answers, use that and save it in browser '
        'storage with a timestamp.',
        '<b>If CelesTrak refuses, use the snapshot in the repository.</b> '
        '<font face="Courier">data/active.tle</font> is a copy of the whole catalogue, '
        'never more than six hours old because a robot refreshes it. The page works '
        'perfectly; the satellites are simply at the positions implied by slightly '
        'older orbit descriptions.',
    ], dash=True)
    P('The function always reports which of the three it used, and the pages display '
      'that - <i>live</i>, <i>cache</i> or <i>bundled</i> - so the reader is never '
      'misled about how fresh the picture is.')

    H2('2.4', 'Space-Track, and how a password lives in a public project')
    P('<b>Space-Track.org</b> is the US Space Force’s own catalogue. It is free but '
      'requires an account, and it is the authoritative source: more complete than '
      'CelesTrak, and crucially it carries newly launched objects first.')
    P('This creates an obvious problem. The repository is public. How can a program in '
      'it log in to Space-Track without publishing the password?')
    NOTE('plain',
         'GitHub provides <b>repository secrets</b>. You paste a value into a settings '
         'page; GitHub stores it encrypted; the scheduled robots can read it as if it '
         'were an environment variable; and <b>nobody can read it back out</b>, not even '
         'you. It never appears in the repository, never reaches a visitor’s '
         'browser, and GitHub automatically blanks it out of the logs if a program '
         'tries to print it.')
    P('NAZAR stores two: <font face="Courier">SPACETRACK_USER</font> and '
      '<font face="Courier">SPACETRACK_PASSWORD</font>. Only '
      '<font face="Courier">scripts/fetch_spacetrack.py</font> uses them, only on '
      'GitHub’s machines, once a day. What it writes into the repository is the '
      '<i>data</i>, which is public anyway - never the credentials.')

    H3('Why bother, if CelesTrak is easier?')
    P('Because of a real gap. CelesTrak does not publish orbital elements for the newest '
      'payloads for weeks after launch. India’s NVS-03 launched on 30 October 2026; '
      'CelesTrak’s own master catalogue listed it as an active payload immediately, '
      'but its element endpoint answered <i>No GP data found</i> for the satellite’s '
      'catalogue number, its launch designator and its name alike - and was still doing '
      'so four weeks later. Space-Track had it with elements the whole time. So the '
      'Sats-by-Operator page tops up the CelesTrak catalogue from the daily Space-Track '
      'bundle, adding about 980 operational satellites that CelesTrak cannot yet draw.')

    H2('2.5', 'The refresh clock: three robots')
    P('<b>GitHub Actions</b> is a free service that runs programs on GitHub’s own '
      'computers on a schedule you set. NAZAR uses three. Each wakes up, fetches '
      'something, rebuilds a data file, and - if anything actually changed - commits the '
      'result back into the repository, which republishes the site automatically.')
    TABLE(['Robot', 'Runs', 'What it does'],
          [['<font face="Courier">refresh-data.yml</font>',
            '<b>Every 6 hours</b><br/><font face="Courier">17 */6 * * *</font>',
            'Downloads CelesTrak’s master catalogue and rebuilds the active-payload '
            'list; recomputes the debris statistics; refreshes the bundled TLE snapshot '
            'and the debris snapshot.'],
           ['<font face="Courier">refresh-spacetrack.yml</font>',
            '<b>Daily, 06:27 UTC</b><br/><font face="Courier">27 6 * * *</font>',
            'Logs in to Space-Track; rebuilds the full payload and debris bundles; '
            'promotes newly launched objects; appends today’s elements to the TLE '
            'vault.'],
           ['<font face="Courier">refresh-conjunctions.yml</font>',
            '<b>Daily, 05:41 UTC</b><br/><font face="Courier">41 5 * * *</font>',
            'Fetches CelesTrak’s SOCRATES close-approach predictions and rebuilds '
            'the conjunctions file.']],
          [45, 38, 82])
    P('Those <font face="Courier">* * *</font> patterns are <b>cron</b> expressions, a '
      'standard way of writing a timetable. The five fields are minute, hour, day of '
      'month, month, day of week. So <font face="Courier">17 */6 * * *</font> means '
      '<i>at 17 minutes past every sixth hour</i>, and '
      '<font face="Courier">27 6 * * *</font> means <i>at 06:27 every day</i>. The odd '
      'minute numbers are deliberate: everyone schedules things on the hour, and '
      'GitHub’s queues are busiest then.')

    NOTE('why',
         'Every one of these robots refuses to write a file that looks wrong. If the '
         'catalogue download comes back with fewer than 10,000 records, or the TLE file '
         'with fewer than 30,000 lines, the job <b>aborts without committing</b>. A '
         'truncated response or an error page served in place of data would otherwise '
         'overwrite a perfectly good snapshot with rubbish, and the site would get worse '
         'rather than staying still. Staying still is the correct behaviour when the '
         'source is having a bad day.')

    NOTE('gotcha',
         'Three robots pushing to one repository will eventually collide. If a job '
         'checks out the repository, spends fifty minutes computing, and then tries to '
         'save, another robot may have saved in the meantime - and the save is rejected. '
         'This happened to the conjunctions robot for a fortnight in November 2026: it '
         'fetched correctly every single day, generated a correct file every single day, '
         'and threw it away every single day. The fix is to fetch the others’ '
         'changes, replay your own on top, and try again - a few lines in the robot’s '
         'final step. If you build something like this, write that in from the start.')

    H2('2.6', 'How the satellite repository is maintained')
    P('"The repository" here means the catalogue of satellites the site knows about. It '
      'is maintained on four levels at once, which is why the site stays useful when any '
      'one of them fails.')
    TABLE(['Level', 'Lives in', 'Lifetime', 'Purpose'],
          [['Live request',
            'Nowhere - straight from CelesTrak',
            'The moment',
            'The freshest possible picture.'],
           ['Browser cache',
            'Your browser’s local storage',
            '6 hours (catalogue)<br/>24 hours (master list)',
            'Stops the site hammering CelesTrak, and makes the second visit instant.'],
           ['Bundled snapshot',
            '<font face="Courier">data/active.tle</font>, 2.6 MB',
            'Refreshed every 6 hours by robot',
            'The site still works when CelesTrak is down or has blocked you.'],
           ['Historical store',
            '<font face="Courier">data/tle-vault.json</font><br/>'
            '<font face="Courier">data/tle-history.json</font>',
            'Kept indefinitely',
            'Lets the site reconstruct where something was <i>before</i> it manoeuvred.']],
          [26, 46, 38, 55])

    H3('Why history has to be kept separately')
    P('Every ordinary data file in the project keeps only the <b>newest</b> element set '
      'for each object and discards the previous one. That is the right choice for a '
      'file that is rewritten daily - but it means a manoeuvre that happened last week '
      'cannot be reconstructed from it at all. So two files exist purely to remember:')
    BULLETS([
        '<b>The vault</b> keeps the last <b>20</b> element sets for each of 433 watched '
        'objects - mostly intelligence and radar satellites, plus any object someone has '
        'added by hand. It is appended to daily and costs no extra queries, because it '
        'reads the bundle the Space-Track robot already downloaded.',
        '<b>The history file</b> keeps <i>every</i> element set ever published for a '
        'handful of objects across a chosen window. It currently covers four objects, '
        'among them 44 sets for Cosmos 2612 and 65 for ICEYE-X36 across 10-27 October '
        '2026 - enough to see the phasing and departure burns in the numbers themselves.',
    ], dash=True)
    NOTE('why',
         'The vault stores its element sets <b>oldest first and appends to the end</b>, '
         'which looks backwards if you want to show the newest first. The reason is '
         'version control: inserting at the front would shift every entry in every array '
         'on every run, and the daily save would be a fresh 1.7-megabyte file with no '
         'recognisable relationship to yesterday’s. Appending leaves yesterday’s '
         'content untouched, so the daily change is tiny. The page reverses the list when '
         'it displays it, which costs nothing.')

    H3('Alpha-5: when catalogue numbers ran out')
    P('Satellites have catalogue numbers, and the format allowed five digits - up to '
      '99,999. We passed that. Rather than break every program in the world that expects '
      'five characters, the convention called <b>Alpha-5</b> replaces the first digit '
      'with a letter: A means 10, B means 11, and so on up to Z, skipping I and O because '
      'they look like 1 and 0. So <font face="Courier">A1228</font> is 101,228. NVS-03 in '
      'the TLE printed earlier carries exactly that. Any program reading modern '
      'catalogues has to decode it, or it will silently mis-identify new objects.')

    # ======================================================================
    PART(3, 'The globe, the maps, the Google Earth link, the news ticker, the '
            'passwords and the analytics - how each one actually works.')
    # ======================================================================

    H2('3.1', 'How the globe is made')
    P('The three-dimensional Earth is the most-asked-about part of the site, and it is '
      'built from three free libraries stacked on top of one another.')
    TABLE(['Library', 'Version', 'What it does'],
          [['<b>three.js</b>', 'r157',
            'The foundation: a general-purpose 3-D engine for the browser. It talks to '
            'your graphics card through WebGL. It knows nothing about planets - only '
            'shapes, materials, lights and cameras.'],
           ['<b>globe.gl</b>', '2.32.0',
            'A layer on top of three.js that knows about planets. It makes the sphere, '
            'wraps it in Earth imagery, handles drag-to-rotate and scroll-to-zoom, and '
            'converts latitude and longitude into 3-D positions.'],
           ['<b>satellite.js</b>', '5.0.0',
            'The orbital mathematics - the SGP4 implementation. Nothing to do with '
            'drawing.']],
          [26, 18, 121])
    P('The globe itself is a sphere with a photograph of the Earth wrapped around it. '
      'NAZAR uses NASA’s Blue Marble imagery, plus a second image called a '
      '<b>bump map</b> that makes mountains catch the light, a starfield behind, and a '
      'thin blue halo for the atmosphere. Setting it up is genuinely about this short:')
    CODE('globe = Globe()(document.getElementById(\'globe\'))\n'
         '  .globeImageUrl(BLUE)       // the Earth photograph\n'
         '  .bumpImageUrl(TOPO)        // terrain relief\n'
         '  .backgroundImageUrl(NIGHT) // the starfield\n'
         '  .showAtmosphere(true)\n'
         '  .atmosphereColor(\'#5aa9ff\');\n'
         '\n'
         '// put the camera somewhere sensible\n'
         'globe.pointOfView({ lat: 25, lng: 10, altitude: 2.4 }, 0);')
    P('Placing something on it is a matter of handing globe.gl a latitude, a longitude '
      'and an altitude, and it returns the corresponding point in 3-D space. Altitude is '
      'expressed as a fraction of the Earth’s radius, so a satellite 400 km up sits '
      'at roughly 0.063.')

    H2('3.2', 'Drawing sixteen thousand satellites without melting the browser')
    P('Putting one dot on a globe is easy. Putting 16,000 on it, and moving all of them '
      'several times a second, is not - and the obvious approach fails completely.')
    NOTE('plain',
         'Each separate object a 3-D scene draws costs the browser a <b>draw call</b> - '
         'a round trip of instructions to the graphics card. A few hundred is fine. '
         'Sixteen thousand, sixty times a second, is close to a million round trips a '
         'second, and the page freezes.')
    P('The solution is a three.js feature called an <b>InstancedMesh</b>. You describe '
      'the shape <i>once</i> - a small sphere - and then hand the graphics card a list '
      'of 16,000 positions and colours. The card draws all of them in <b>one</b> draw '
      'call. The shape is shared; only the position and colour differ per satellite. '
      'This is precisely what graphics hardware is built to do, and it turns an '
      'impossible page into an easy one.')
    P('There is a second problem: even just <i>calculating</i> 16,000 SGP4 solutions '
      'takes long enough to make the page stutter if done all at once. So the work is '
      'sliced. Each page defines a chunk size and processes that many satellites, then '
      'hands control back to the browser so it can draw a frame and respond to the '
      'mouse, then picks up where it left off.')
    CODE('const CHUNK_SIZE  = 1500;    // satellites per slice\n'
         'const REFRESH_MS  = 4000;    // start a fresh pass every 4 seconds\n'
         '\n'
         'function processChunk() {\n'
         '  const end = Math.min(chunkIdx + CHUNK_SIZE, allSats.length);\n'
         '  for (let i = chunkIdx; i &lt; end; i++) {\n'
         '      const r = propagate(allSats[i].rec, now);   // SGP4 for one satellite\n'
         '      const p = globe.getCoords(r.lat, r.lon, r.alt / EARTH_R_KM);\n'
         '      instMesh.setMatrixAt(i, matrixFrom(p));     // place instance i\n'
         '  }\n'
         '  chunkIdx = end;\n'
         '  if (chunkIdx &lt; allSats.length)\n'
         '      requestAnimationFrame(processChunk);        // continue next frame\n'
         '}',
         'The chunked propagation loop, simplified. Every globe page in NAZAR uses this '
         'shape, with chunk sizes between 1,000 and 2,000 and refresh intervals between '
         '3 and 12 seconds.')
    NOTE('gotcha',
         'Chunking introduces a subtle bug that took a while to find. A running total '
         'that is reset at the start of a pass and refilled chunk by chunk is '
         '<b>half-finished</b> in the middle of a pass. On the Sats-by-Operator page a '
         'pop-up read those live totals and reported "tracked right now: 0" for an '
         'operator whose 30 satellites were visibly on the screen - they simply sat late '
         'in the list and the pass had not reached them. The fix is to count into a '
         'scratch total and publish it only when a pass <i>completes</i>, so a reader '
         'never sees a number that is still being made.')

    H2('3.3', 'Flat maps and ground tracks')
    P('Not everything is better on a globe. A satellite’s <b>ground track</b> - the '
      'path its shadow traces across the Earth - is much easier to read flattened out.')
    P('The flat maps are hand-drawn <b>SVG</b>, a format for describing shapes with '
      'coordinates rather than pixels. The projection is the simplest one there is: '
      'longitude becomes the horizontal axis, latitude the vertical, with no correction. '
      'Cartographers call it <i>equirectangular</i>. It distorts the poles badly and is '
      'perfectly honest about distance along the equator, which is where satellites '
      'spend most of their time.')
    P('Because the drawing is described in degrees rather than pixels, panning and '
      'zooming are a single change to the visible rectangle - no redrawing, no tiles, no '
      'map server. Markers are then rescaled so they stay the same size on screen as you '
      'zoom.')
    P('One page uses a quite different projection. <b>One Hour Lead</b> plots an '
      'observer’s sky on an <i>azimuthal equidistant</i> map centred on the '
      'observer, so that distance from the centre of the picture is true ground distance '
      'from the site in every direction - which is the thing that matters when you are '
      'asking who can see you.')

    H2('3.4', 'The Google Earth walkthrough')
    P('On the Global Launch Sites atlas, clicking a marker opens a pop-up with a close '
      'satellite photograph of the place and a button reading <i>Fly there in Google '
      'Earth</i>. People assume this is a deep integration. It is two tricks, neither '
      'of which needs an account, a key or a payment.')
    H3('The satellite photograph')
    P('The small map inside the pop-up is drawn with <b>Leaflet</b> (version 1.9.4), a '
      'free mapping library, pulling imagery tiles from <b>Esri World Imagery</b>, which '
      'publishes them for public use with attribution. The attribution is printed in the '
      'corner, as the licence requires.')
    CODE('L.tileLayer(\'https://server.arcgisonline.com/ArcGIS/rest/services/\'\n'
         '          + \'World_Imagery/MapServer/tile/{z}/{y}/{x}\',\n'
         '  { maxZoom: 18, attribution: \'Imagery (c) Esri, Maxar, Earthstar Geographics\' })\n'
         '  .addTo(flyMap);')
    H3('The fly-through itself')
    P('Google Earth’s web version takes the whole camera position in the URL. So the '
      'button is simply a link, assembled from the site’s own latitude, longitude '
      'and elevation at the moment you click it:')
    CODE('document.getElementById(\'lm-fly-ge\').href =\n'
         '  \'https://earth.google.com/web/@\'\n'
         '  + lat + \',\' + lon + \',\' + elevation + \'a,\'\n'
         '  + \'3500d,\'   // camera 3500 m from the target\n'
         '  + \'35y,\'     // 35-degree field of view\n'
         '  + \'0h,\'      // heading: due north\n'
         '  + \'55t,\'     // tilt: 55 degrees from vertical, so you see the horizon\n'
         '  + \'0r\';      // no roll')
    NOTE('plain',
         'There is no connection between NAZAR and Google Earth beyond a cleverly '
         'constructed web address. Google Earth opens in a new tab, reads the numbers out '
         'of the address, and flies the camera there. You could type the same address by '
         'hand. This is worth remembering generally: a surprising number of services '
         'accept their entire state in the URL, and a link is the cheapest integration '
         'there is.')

    H2('3.5', 'Cones, and the one-hour lead')
    P('Two pages answer a question that sounds simple and is not: <i>which satellites '
      'can see this spot on the ground?</i>')
    P('A sensor’s field of view is modelled as a <b>cone</b> with its point at the '
      'site on the ground, opening upward, and tiltable away from straight up. A '
      'satellite counts as being inside it if the angle between the cone’s axis and '
      'the direction to the satellite is less than the cone’s half-angle - and if '
      'the satellite is above the local horizon, which has to be tested separately or the '
      'cone would happily "see" straight through the planet.')
    P('<b>One Hour Lead</b> then asks the same question for every satellite in the '
      'catalogue, at every instant over the coming hour. Done naively that is '
      '16,000 satellites times 3,600 seconds - 58 million SGP4 solves, which no browser '
      'will survive. Three ideas make it fast:')
    BULLETS([
        '<b>Sample coarsely first.</b> Step through the hour in one-minute jumps rather '
        'than one-second ones. Sixty times less work.',
        '<b>Rule out the hopeless cheaply.</b> Before doing the expensive geometry, check '
        'whether the satellite is even in the neighbourhood, using a conservative '
        'distance bound - half the step plus 60 km. If it cannot possibly reach the cone '
        'before the next sample, skip it entirely.',
        '<b>Refine only where it matters.</b> Where a minute looks promising, go back and '
        'walk it second by second, then narrow the exact crossing by repeatedly halving '
        'the interval.',
    ], dash=True)
    P('The scan also yields control back to the browser every 30 milliseconds or so, so '
      'the page stays responsive while it runs rather than appearing to hang.')
    NOTE('why',
         'Both pages share one file, <font face="Courier">cone-geometry.js</font>. That '
         'is not tidiness - it is correctness. The satellites marked inside the cone on '
         'the globe and the satellites listed in the table on the other page have to '
         'agree, and they agree <b>because they run the same code</b>, not because two '
         'copies were carefully kept in step. Two copies always drift.')

    H2('3.6', 'Conjunctions: finding a close approach')
    P('The Traffic-Conjunctions page shows predicted close approaches between satellites. '
      'The predictions come from <b>SOCRATES</b>, a CelesTrak service that screens the '
      'whole catalogue against itself and publishes the most threatening encounters of '
      'the coming week. A robot fetches that list daily and the page animates each '
      'encounter.')
    NOTE('gotcha',
         'You cannot find a close approach by watching a clock run. At 1,000x speed each '
         'frame of animation advances about 17 seconds of orbit - roughly 125 km of '
         'travel - so an encounter that spends a few seconds inside a kilometre falls '
         'between two frames and is never seen. Finding one requires a deliberate search: '
         'step through the window, find every local minimum in the separation, and refine '
         'each one. The Dog-Fights page has a button that does exactly this.')
    P('The page is also careful about what it claims. Real collision screening uses '
      'precise orbits that are not public; SGP4 on public TLEs is accurate to about a '
      'kilometre. So the page presents the encounter as a faithful <i>visual</i> of what '
      'happens, not as an operational miss distance, and points at Space-Track for the '
      'authoritative figures.')

    H2('3.7', 'The news ticker and its archive')
    P('The scrolling headlines on the front page, and the full archive behind them, come '
      'from <b>35 sources</b> - 26 RSS feeds (SpaceNews, ESA, LeoLabs, Breaking Defense, '
      'the US Space Force and others) and 9 Google News topic searches. All of it is '
      'fetched by your browser. There is no news server.')
    H3('The problem with fetching news in a browser')
    P('Browsers enforce a rule called <b>CORS</b>: a page served from one website may not '
      'simply read content from another unless that other site explicitly permits it. '
      'Most news sites do not. The workaround is a <b>CORS proxy</b> - a public service '
      'that fetches the feed on your behalf and returns it with permission attached. '
      'NAZAR tries three in turn and takes the first that yields anything:')
    BULLETS(['<font face="Courier">api.allorigins.win</font> - returns raw XML',
             '<font face="Courier">api.rss2json.com</font> - returns tidy JSON, '
             'about 10 items',
             '<font face="Courier">api.codetabs.com</font> - raw XML again'], dash=True)
    P('These are free services under heavy load and they fail often, frequently all at '
      'once. On a typical pull somewhere between a third and two-thirds of the 35 sources '
      'answer. The design simply accepts this.')
    NOTE('why',
         'The archive is <b>cumulative</b> and lives in your browser’s storage, '
         'keyed by article address so nothing is stored twice. A feed that fails at ten '
         'o’clock lands at half past instead of never, and a partial pull is never '
         'allowed to wipe what was already collected. Because the tail of a long list is '
         'what gets dropped on a bad day, the pull order <b>rotates</b> by seven places '
         'each refresh - otherwise the same feeds at the end would be permanently '
         'invisible. Twelve feeds are pinned at the front and never rotate, because they '
         'are the ones the site exists for.')
    P('The archive is capped at 900 articles, and when it overflows the defence and '
      'space-surveillance stories are kept first - so a busy week of routine launch '
      'notices can never push a satellite break-up out of the record.')
    NOTE('gotcha',
         'Choosing search words is harder than it looks. A query containing the bare word '
         '<font face="Courier">ASAT</font> matched a person’s surname and pulled a '
         'human-rights story into a space archive. And a filter looking for the word '
         '"debris" tagged a funding round, a conference panel and a university study as '
         'satellite break-ups. The rule that fixed it: match <b>nouns coupled to '
         'something happening</b> - "broke apart", "debris cloud", "43 fragments" - not '
         'the nouns alone.')

    H2('3.8', 'The reference pages')
    P('Several pages are not live at all. They display a finished data file that a Python '
      'script in <font face="Courier">scripts/</font> prepared in advance. The pattern is '
      'the same every time: a script reads an authoritative source, applies judgement '
      'that lives in a separate, editable file, and writes compact JSON into '
      '<font face="Courier">data/</font>.')
    TABLE(['Page', 'Built from', 'Holds'],
          [['PRC Orbital Catalog',
            'CelesTrak’s static master catalogue, via '
            '<font face="Courier">gen_compendium.py</font>',
            '2,224 Chinese payloads ever catalogued, plus 131 launched for other '
            'countries'],
           ['Indi-Space',
            'A published volume plus a 2026 industry deck, plus a check of each '
            'company’s own website',
            '105 Indian private space companies'],
           ['Analogues',
            '<font face="Courier">gen_analogues.py</font>',
            '138 global companies mapped to Indian counterparts in 288 pairings'],
           ['Rocket Models',
            'The Space Devs Launch Library, plus Wikimedia photographs',
            '531 launch vehicles in 66 families'],
           ['Launch Atlas',
            'Hand-built plus generator scripts for ground stations',
            '215 markers - pads, agency headquarters, tracking dishes, GNSS ground '
            'segment'],
           ['Debris Statistics',
            '<font face="Courier">gen_debris_history.py</font>',
            'A 5 KB precompute of debris by year, country, altitude and inclination']],
          [34, 66, 65])
    NOTE('why',
         'The PRC catalogue is the cautionary tale. It began as 207 rows typed by hand '
         'into the page. An audit found that <b>153 of those 207 catalogue numbers '
         'pointed at the wrong object</b> - Russian satellites, spent rocket stages, '
         'other people’s debris. Rebuilding it from the catalogue produced 2,224 '
         'correct rows. Only the hand-written <i>prose</i> was carried over, matched back '
         'by name. The lesson is simple: facts should come from a source a program can '
         're-read, and human effort should go into judgement, not transcription.')

    H2('3.9', 'The password gates')
    P('Eighteen pages are behind a password - seventeen share one gate script, and the '
      'Site Analytics page has its own. On a static site this is necessarily a limited '
      'promise, and the site is honest about it.')
    P('The password itself appears nowhere in the repository. What is published is its '
      '<b>SHA-256 hash</b> - a fixed-length fingerprint that is easy to compute from the '
      'password and effectively impossible to reverse. When you type the password, your '
      'browser hashes it and compares fingerprints.')
    CODE('// Not the real hash.\n'
         'const SHA256 = \'3b7a4e...\';\n'
         '\n'
         'async function check(entered) {\n'
         '  const bytes  = new TextEncoder().encode(entered);\n'
         '  const digest = await crypto.subtle.digest(\'SHA-256\', bytes);\n'
         '  const hex    = [...new Uint8Array(digest)]\n'
         '                   .map(b =&gt; b.toString(16).padStart(2, \'0\')).join(\'\');\n'
         '  return hex === SHA256;\n'
         '}')
    P('Unlock once and a flag is set for that browser tab, so the other pages in the same '
      'group open without asking again. Different groups stay locked independently.')
    NOTE('gotcha',
         'This hides <b>pages</b>, not <b>data</b>. The data files under '
         '<font face="Courier">data/</font> remain publicly fetchable by anyone who knows '
         'their address, because GitHub Pages serves them to anyone who asks - the gate '
         'is a decision your browser makes after everything has already been downloaded. '
         'It is a courtesy barrier, not security. Never put anything behind it that would '
         'actually matter if it leaked. Real access control requires a server, and the '
         'moment you need one, the free-hosting advantage is gone.')

    H2('3.10', 'Site analytics without an analytics company')
    P('The page you reached this document from is a visitor log the site keeps for '
      'itself, with no third-party tracker involved. The storage is a '
      '<b>Google Sheet</b>, and the bridge to it is a <b>Google Apps Script</b> - a small '
      'program that lives in a Google account and can be published as a web address that '
      'accepts data.')
    BULLETS([
        '<b>On every page</b>, a script notes a session identifier and a random visitor '
        'identifier, and counts the seconds the page is actually in the foreground.',
        '<b>When you leave</b>, it posts one small message containing the pages you saw, '
        'the time spent, your approximate city and country (from a public address-lookup '
        'service), and your device, operating system and browser.',
        '<b>The Apps Script</b> adds or updates a row in the Sheet, keyed by session, so '
        'messages arriving out of order cannot double-count a visit.',
        '<b>The dashboard</b> asks for the owner’s password, passes it to the Apps '
        'Script, and the Apps Script returns the log only if the fingerprint matches.',
    ])
    P('The owner’s own visits are never logged at all, and older rows from before '
      'that rule existed are folded out of the table into a single summary line.')
    NOTE('gotcha',
         'An Apps Script published at a web address keeps running <b>the version it was '
         'deployed with</b>. Editing the code changes nothing until you publish a new '
         'deployment version. Changing the password in three files and forgetting the '
         'deployment produces a login that cannot possibly succeed and no clue why - so '
         'the dashboard now detects that case and says precisely that.')

    H2('3.11', 'Comments and feedback')
    P('A form on the front page sends a message to the owner’s inbox. With no server '
      'there is nothing to receive a form submission, so a free relay called '
      '<b>Web3Forms</b> does it: the page posts the message to their address along with a '
      'public access key, and they send the email.')
    P('Nothing is stored on the site - there is no comments database and no moderation '
      'panel, by choice. The owner’s record of all feedback is their inbox.')

    # ======================================================================
    PART(4, 'From no accounts and no code to a live website with live data, '
            'refreshing itself on a schedule. Nothing to pay, nothing to install.')
    # ======================================================================

    H2('4.1', 'Before you start')
    P('This part assumes nothing. If you have never written code, never used GitHub and '
      'are not sure what a repository is, you are the reader this was written for. Work '
      'through it in order and you will finish with a real website at a real address, '
      'showing real satellites, keeping itself up to date.')
    P('You need a computer with a web browser, an email address, and about two hours. '
      'You do not need to install anything - every step below can be done in the browser '
      '- though a text editor on your own machine makes life pleasanter later.')
    TABLE(['Term', 'What it means'],
          [['<b>Repository</b> (repo)',
            'A folder of files that GitHub stores for you and keeps every past version '
            'of.'],
           ['<b>Commit</b>',
            'Saving a set of changes, with a short note about what you changed. A '
            'repository is a chain of commits.'],
           ['<b>GitHub Pages</b>',
            'A free GitHub service that publishes a repository as a website.'],
           ['<b>Branch</b>',
            'A line of development. You will only ever use the default one, called '
            '<font face="Courier">main</font>.'],
           ['<b>Action / workflow</b>',
            'A program GitHub runs for you, on a schedule or when you ask.'],
           ['<b>Secret</b>',
            'A password stored by GitHub that your Actions can use but nobody can read '
            'back.']],
          [36, 129])

    H2('4.2', 'Build it, step by step')

    STEP(1, 'Create a GitHub account',
         ['Go to <b>github.com</b> and sign up. Choose a username carefully - it becomes '
          'part of your website address. Pick the free plan. Confirm your email address, '
          'because publishing will not work until you do.'])

    STEP(2, 'Create your repository',
         ['Click the <b>+</b> at the top right, then <b>New repository</b>.',
          'Give it a name - this also becomes part of the address. Set it to '
          '<b>Public</b>: free Pages hosting and free scheduled Actions both require it. '
          'Tick <b>Add a README file</b> so the repository is not empty.',
          'Your site will eventually live at '
          '<font face="Courier">https://&lt;username&gt;.github.io/&lt;repository&gt;/</font>.'])

    STEP(3, 'Turn on GitHub Pages',
         ['In the repository, open <b>Settings</b>, then <b>Pages</b> in the left-hand '
          'list. Under <i>Source</i> choose <b>Deploy from a branch</b>, pick branch '
          '<font face="Courier">main</font> and folder <font face="Courier">/ (root)</font>, '
          'and save.',
          'Wait a minute or two and your address will appear at the top of that page. '
          'Nothing is there yet.'])

    STEP(4, 'Make your first page',
         ['Back on the repository’s main screen, click <b>Add file</b>, then '
          '<b>Create new file</b>. Name it exactly <font face="Courier">index.html</font> '
          '- that is the name a web server looks for when someone visits the bare '
          'address. Paste this in and click <b>Commit changes</b>.'],
         code='&lt;!doctype html&gt;\n'
              '&lt;html&gt;\n'
              '  &lt;head&gt;\n'
              '    &lt;meta charset="utf-8"&gt;\n'
              '    &lt;title&gt;My satellite tracker&lt;/title&gt;\n'
              '  &lt;/head&gt;\n'
              '  &lt;body style="background:#06101a; color:#dbe9f5; font-family:sans-serif"&gt;\n'
              '    &lt;h1&gt;It works&lt;/h1&gt;\n'
              '    &lt;p&gt;Satellites to follow.&lt;/p&gt;\n'
              '  &lt;/body&gt;\n'
              '&lt;/html&gt;',
         note=('try', 'Open your address in a browser. You should see <i>It works</i> on '
                      'a dark background. You now have a live website. Everything from '
                      'here is addition.'))

    STEP(5, 'Add a globe',
         ['Replace the contents of <font face="Courier">index.html</font> with the '
          'following. The two <font face="Courier">script</font> lines fetch the globe '
          'libraries from a public distribution network, so there is nothing to install.'],
         code='&lt;!doctype html&gt;\n'
              '&lt;html&gt;\n'
              '&lt;head&gt;\n'
              '  &lt;meta charset="utf-8"&gt;\n'
              '  &lt;title&gt;My satellite tracker&lt;/title&gt;\n'
              '  &lt;style&gt;\n'
              '    html, body { margin:0; height:100%; background:#000; overflow:hidden }\n'
              '    #globe { width:100vw; height:100vh }\n'
              '  &lt;/style&gt;\n'
              '&lt;/head&gt;\n'
              '&lt;body&gt;\n'
              '  &lt;div id="globe"&gt;&lt;/div&gt;\n'
              '\n'
              '  &lt;script src="https://unpkg.com/three@0.157.0/build/three.min.js"&gt;&lt;/script&gt;\n'
              '  &lt;script src="https://unpkg.com/globe.gl@2.32.0/dist/globe.gl.min.js"&gt;&lt;/script&gt;\n'
              '  &lt;script&gt;\n'
              '    const IMG = \'https://unpkg.com/three-globe/example/img/\';\n'
              '    const globe = Globe()(document.getElementById(\'globe\'))\n'
              '      .globeImageUrl(IMG + \'earth-blue-marble.jpg\')\n'
              '      .bumpImageUrl(IMG + \'earth-topology.png\')\n'
              '      .backgroundImageUrl(IMG + \'night-sky.png\')\n'
              '      .showAtmosphere(true);\n'
              '    globe.pointOfView({ lat: 20, lng: 78, altitude: 2.4 }, 0);\n'
              '  &lt;/script&gt;\n'
              '&lt;/body&gt;\n'
              '&lt;/html&gt;',
         note=('try', 'Commit, wait half a minute, and reload. A photographic Earth you '
                      'can drag and zoom. Twenty-odd lines.'))

    STEP(6, 'Put real satellites on it',
         ['Now add the orbital mathematics. Insert this '
          '<font face="Courier">script</font> line with the other two:',
          '<font face="Courier">&lt;script src="https://unpkg.com/satellite.js@5.0.0/'
          'dist/satellite.min.js"&gt;&lt;/script&gt;</font>',
          'Then add the following inside your own script block. It fetches the live '
          'catalogue, converts each TLE, and moves the dots every three seconds.'],
         code='const URL = \'https://celestrak.org/NORAD/elements/\'\n'
              '          + \'gp.php?GROUP=active&amp;FORMAT=tle\';\n'
              'const EARTH_R = 6371;                    // km\n'
              '\n'
              'async function loadSats() {\n'
              '  const text  = await (await fetch(URL)).text();\n'
              '  const lines = text.split(/\\r?\\n/);\n'
              '  const sats  = [];\n'
              '  for (let i = 0; i + 2 &lt; lines.length; i += 3) {\n'
              '    try {\n'
              '      const rec = satellite.twoline2satrec(lines[i+1], lines[i+2]);\n'
              '      if (rec &amp;&amp; !rec.error) sats.push({ name: lines[i].trim(), rec });\n'
              '    } catch (e) { /* skip anything malformed */ }\n'
              '  }\n'
              '  return sats;\n'
              '}\n'
              '\n'
              'function positions(sats, when) {\n'
              '  const gmst = satellite.gstime(when);\n'
              '  const out  = [];\n'
              '  for (const s of sats) {\n'
              '    const pv = satellite.propagate(s.rec, when);          // SGP4\n'
              '    if (!pv || !pv.position) continue;\n'
              '    const gd = satellite.eciToGeodetic(pv.position, gmst);\n'
              '    out.push({\n'
              '      name: s.name,\n'
              '      lat:  satellite.degreesLat(gd.latitude),\n'
              '      lng:  satellite.degreesLong(gd.longitude),\n'
              '      alt:  gd.height / EARTH_R,        // globe.gl wants Earth radii\n'
              '    });\n'
              '  }\n'
              '  return out;\n'
              '}\n'
              '\n'
              'loadSats().then(sats =&gt; {\n'
              '  globe.pointsData(positions(sats, new Date()))\n'
              '       .pointAltitude(\'alt\').pointRadius(0.18)\n'
              '       .pointColor(() =&gt; \'#4fd1ff\').pointLabel(\'name\');\n'
              '  setInterval(() =&gt; {\n'
              '    globe.pointsData(positions(sats, new Date()));\n'
              '  }, 3000);\n'
              '});',
         note=('try', 'Commit and reload. Thousands of live satellites, in their real '
                      'places, moving. You are now doing the same thing NAZAR’s '
                      'front page does. For a few hundred points '
                      '<font face="Courier">pointsData</font> is fine; past a few '
                      'thousand you will want the InstancedMesh approach from section '
                      '3.2.'))

    NOTE('gotcha',
         'If the globe appears but no satellites do, open your browser’s developer '
         'console (F12) and look for a red error. By far the likeliest is '
         '<b>403 Forbidden</b> from CelesTrak, which means you have reloaded too often '
         'and been rate-limited for a while. This is exactly the problem that justifies '
         'the next two steps.')

    STEP(7, 'Keep a snapshot so the page survives a bad day',
         ['Download the catalogue once in your browser, save it, and add it to the '
          'repository as <font face="Courier">data/active.tle</font> (use <b>Add file -&gt; '
          'Upload files</b>; typing <font face="Courier">data/</font> in the filename '
          'creates the folder).',
          'Then make the live fetch fall back to it:'],
         code='async function loadCatalogue() {\n'
              '  try {\n'
              '    const r = await fetch(URL);\n'
              '    if (r.ok) return { text: await r.text(), source: \'live\' };\n'
              '  } catch (e) { /* offline, blocked, or rate-limited */ }\n'
              '  const r = await fetch(\'data/active.tle\');\n'
              '  return { text: await r.text(), source: \'bundled\' };\n'
              '}',
         note=('why', 'Always tell the reader which one they got. A page that silently '
                      'shows day-old positions as though they were live is worse than '
                      'one that says "bundled snapshot" in the corner. NAZAR prints the '
                      'source on every tracking page.'))

    STEP(8, 'Add a browser cache so you stop being rate-limited',
         ['Before fetching at all, check whether this browser already has a recent copy. '
          'Six hours is plenty - orbital elements are not republished more often than '
          'that in practice.'],
         code='const KEY = \'mysite.tle\', TTL = 6 * 3600 * 1000;   // 6 hours\n'
              '\n'
              'function cached() {\n'
              '  try {\n'
              '    const raw = localStorage.getItem(KEY);\n'
              '    if (!raw) return null;\n'
              '    const { t, v } = JSON.parse(raw);\n'
              '    return (Date.now() - t &lt; TTL) ? v : null;\n'
              '  } catch (e) { return null; }      // private mode, quota, corrupt entry\n'
              '}\n'
              '\n'
              'function remember(text) {\n'
              '  try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), v: text })); }\n'
              '  catch (e) { /* storage full - not fatal, just carry on */ }\n'
              '}',
         note=('gotcha', 'Wrap <i>every</i> use of browser storage in a try/catch. It '
                         'throws in private-browsing mode, when the quota is full, and '
                         'when the user has blocked site data. An unguarded read is one '
                         'of the most common ways a page breaks for a minority of '
                         'visitors and works perfectly for you.'))

    STEP(9, 'Make a robot refresh your snapshot',
         ['This is the step that turns a demonstration into something that stays alive. '
          'Create a file at exactly '
          '<font face="Courier">.github/workflows/refresh.yml</font> with the contents '
          'below, and commit it. GitHub will start running it on the timetable.'],
         code='name: Refresh satellite snapshot\n'
              '\n'
              'on:\n'
              '  schedule:\n'
              '    - cron: \'23 */6 * * *\'      # 23 past every 6th hour\n'
              '  workflow_dispatch:             # ...and a Run button\n'
              '\n'
              'permissions:\n'
              '  contents: write                # allow it to save back\n'
              '\n'
              'jobs:\n'
              '  refresh:\n'
              '    runs-on: ubuntu-latest\n'
              '    timeout-minutes: 15\n'
              '    steps:\n'
              '      - uses: actions/checkout@v4\n'
              '\n'
              '      - name: Download the catalogue\n'
              '        run: |\n'
              '          set -euo pipefail\n'
              '          curl -fsS --connect-timeout 20 --max-time 120 \\\n'
              '               --retry 4 --retry-delay 10 \\\n'
              '            "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&amp;FORMAT=tle" \\\n'
              '            -o fresh.tle\n'
              '\n'
              '      - name: Refuse to save anything that looks wrong\n'
              '        run: |\n'
              '          lines=$(wc -l &lt; fresh.tle)\n'
              '          echo "got $lines lines"\n'
              '          if [ "$lines" -lt 30000 ]; then\n'
              '            echo "::error::only $lines lines - keeping the old snapshot"\n'
              '            exit 1\n'
              '          fi\n'
              '          mv fresh.tle data/active.tle\n'
              '\n'
              '      - name: Save it back\n'
              '        run: |\n'
              '          if [ -z "$(git status --porcelain data/active.tle)" ]; then\n'
              '            echo "no change"; exit 0\n'
              '          fi\n'
              '          git config user.name  "github-actions[bot]"\n'
              '          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"\n'
              '          git add data/active.tle\n'
              '          git commit -m "Refresh snapshot ($(date -u +\'%Y-%m-%d %H:%M UTC\'))"\n'
              '          for i in 1 2 3; do\n'
              '            git push &amp;&amp; exit 0\n'
              '            git pull --rebase origin main      # someone else pushed first\n'
              '          done\n'
              '          exit 1\n')
    P('Four details in that file are worth more than the rest put together, and all four '
      'are there because of a real failure:')
    BULLETS([
        '<b><font face="Courier">timeout-minutes</font></b> - without it, a connection '
        'that opens and then stalls will hang until GitHub’s six-hour ceiling kills '
        'it. NAZAR burned six runner-hours a day for a fortnight learning this.',
        '<b>Timeouts on <font face="Courier">curl</font> too</b> - '
        '<font face="Courier">--retry</font> alone does not bound how long a single '
        'attempt may stall.',
        '<b>The sanity check</b> - never overwrite good data with a truncated response '
        'or an error page. Failing loudly and keeping yesterday’s file is the right '
        'outcome.',
        '<b>The pull-and-retry around the push</b> - the moment you have more than one '
        'robot, they will collide, and the loser silently throws away work it already '
        'did correctly.',
    ], dash=True)
    NOTE('try',
         'You do not have to wait six hours. Open the <b>Actions</b> tab, choose your '
         'workflow and press <b>Run workflow</b> - that is what '
         '<font face="Courier">workflow_dispatch</font> is for. Watch the log as it runs. '
         'Scheduled runs on GitHub are also often delayed by several hours when their '
         'queues are busy, so never assume a cron time is exact.')

    STEP(10, 'Use a password-protected source (optional)',
         ['If you want Space-Track data, register free at '
          '<b>space-track.org</b>. Then in your repository go to <b>Settings -&gt; Secrets '
          'and variables -&gt; Actions -&gt; New repository secret</b> and add '
          '<font face="Courier">SPACETRACK_USER</font> and '
          '<font face="Courier">SPACETRACK_PASSWORD</font>.',
          'Your workflow reads them like this, and they never appear anywhere public:'],
         code='      - name: Fetch from Space-Track\n'
              '        env:\n'
              '          ST_USER: ${{ secrets.SPACETRACK_USER }}\n'
              '          ST_PASS: ${{ secrets.SPACETRACK_PASSWORD }}\n'
              '        run: python3 scripts/fetch_spacetrack.py',
         note=('gotcha', 'Never put a password in a page, a script the browser '
                         'downloads, or any file in the repository - even briefly, even '
                         'in a branch you mean to delete. Git keeps everything forever, '
                         'and a public repository is scraped within minutes. If you '
                         'commit a secret by accident, change the password at the source '
                         'immediately; removing the commit is not enough.'))

    STEP(11, 'Learn the cache-busting habit now, not later',
         ['When you change a JavaScript file, visitors’ browsers will often keep '
          'using the copy they already have, and your change appears not to work. The '
          'fix is to change the address slightly so the browser treats it as a new file. '
          'Put a version number on every script link and increase it whenever you edit '
          'that file.'],
         code='&lt;script src="app.js?v=7"&gt;&lt;/script&gt;      &lt;!-- edit app.js -&gt; make it v=8 --&gt;',
         note=('gotcha', 'GitHub Pages also puts a roughly ten-minute cache on the HTML '
                         'itself, so even the <i>page</i> can lag behind your commit. If '
                         'you are checking whether something deployed, add a nonsense '
                         'query to the address - '
                         '<font face="Courier">?x=123</font> - to force a genuinely fresh '
                         'copy. Hours have been lost to debugging code that was not the '
                         'code being served.'))

    STEP(12, 'Work on your own machine',
         ['Editing in the browser is fine for one file and painful for twenty. When you '
          'outgrow it, install <b>Git</b> and copy the repository to your computer. Any '
          'text editor will do; <b>Visual Studio Code</b> is free and the usual choice.',
          'To see your site locally before publishing, run a tiny web server in the '
          'folder - Python has one built in. Opening the file directly with '
          '<font face="Courier">file://</font> will not work, because browsers forbid '
          'data fetches from such pages.'],
         code='git clone https://github.com/&lt;username&gt;/&lt;repository&gt;.git\n'
              'cd &lt;repository&gt;\n'
              'python -m http.server 8090         # then visit http://localhost:8090\n'
              '\n'
              '# after editing:\n'
              'git add -A\n'
              'git commit -m "Describe what you changed"\n'
              'git push')

    H2('4.3', 'Where to go next')
    P('With the twelve steps above you have the whole machine: a published site, live '
      'data with a cache and a fallback, and a robot keeping a snapshot fresh. '
      'Everything NAZAR does beyond that is an elaboration of the same parts.')
    BULLETS([
        '<b>More pages.</b> Copy <font face="Courier">index.html</font> to a new name and '
        'link to it. There is no routing or configuration - a file is a page.',
        '<b>Filters and colour-coding.</b> Satellite names are strongly patterned, so a '
        'modest list of text patterns will sort a catalogue into operators and '
        'constellations. NAZAR has 108 such rules.',
        '<b>Prepared data files.</b> When a page needs facts rather than orbits, write a '
        'Python script that produces a compact file in '
        '<font face="Courier">data/</font> and have the page read that. Keep the '
        'judgement in a separate, editable module.',
        '<b>Charts.</b> Chart.js is free and needs only a '
        '<font face="Courier">script</font> tag.',
        '<b>Flat maps.</b> Natural Earth publishes public-domain country outlines; an '
        'equirectangular SVG map is perhaps fifty lines.',
    ])
    NOTE('why',
         'One habit matters more than any technique here: <b>write down why, not what</b>. '
         'The code already says what it does. What it cannot say is that this filter '
         'exists because an apogee test alone could not catch Mars Express, or that the '
         'list is stored oldest-first to keep the daily change small. NAZAR’s source '
         'is full of such comments, and they are the reason it can still be changed '
         'safely months later.')

    # ======================================================================
    PART(5, 'The questions this site most often prompts, collected and answered '
            'in one place.')
    # ======================================================================

    H2('5.1', 'About the site')
    FAQ('Is this real data, or a simulation?',
        'Real. The orbital elements come from the US catalogue, republished by CelesTrak '
        'and Space-Track, and the positions are computed with SGP4, the standard public '
        'algorithm. The limits are the ones inherent in public data: positions are '
        'typically accurate to about a kilometre, and a satellite that has manoeuvred '
        'recently may be shown where it would have been had it not.')
    FAQ('How often is the data updated?',
        'Live tracking pages fetch the catalogue when you open them, reusing a copy for '
        'up to six hours. The bundled snapshot is refreshed by robot <b>every six '
        'hours</b>; the Space-Track bundles and the TLE vault <b>daily at 06:27 UTC</b>; '
        'close-approach predictions <b>daily at 05:41 UTC</b>. Reference catalogues are '
        'rebuilt when their source changes. News is pulled by your browser at most twice '
        'an hour.')
    FAQ('Is the site live, or showing me a recording?',
        'Live, in the sense that the satellite positions are computed for the current '
        'instant every few seconds. But the <i>orbit descriptions</i> those positions '
        'come from may be a few hours old. Every tracking page prints which source it '
        'used - live, cache or bundled - so you can always tell.')
    FAQ('What does it cost to run?',
        'Nothing. Hosting, the scheduled robots, the satellite data, the mapping '
        'libraries and the analytics are all free for a public project of this size.')
    FAQ('What happens if CelesTrak goes down?',
        'The site keeps working from the bundled snapshot, which is never more than six '
        'hours stale, and says that is what it is doing. This is not hypothetical - '
        'celestrak.org was returning <i>503 Service Unavailable</i> on every path for a '
        'stretch of 25 November 2026.')
    FAQ('Why is there no database?',
        'Because a database needs a server, and a server needs paying for and '
        'maintaining. Everything that would live in one lives in files instead: prepared '
        'JSON in the repository for reference data, and the visitor’s own browser '
        'storage for the news archive and caches.')

    H2('5.2', 'About the technology')
    FAQ('How is the globe made?',
        'A sphere drawn by <b>three.js</b> with NASA’s Blue Marble imagery wrapped '
        'round it, managed by <b>globe.gl</b>, which handles the camera, the dragging and '
        'the conversion from latitude and longitude into 3-D space. Satellite positions '
        'come from <b>satellite.js</b>. All three are free, loaded from a public CDN, and '
        'the setup is about ten lines - see section 3.1.')
    FAQ('How can a browser draw sixteen thousand moving satellites?',
        'Two techniques. An <b>InstancedMesh</b> describes the dot shape once and hands '
        'the graphics card a list of positions, so all 16,000 are drawn in a single '
        'instruction instead of 16,000. And the orbital calculations are <b>sliced</b> '
        'into chunks of one or two thousand, with control handed back to the browser '
        'between slices so the page never freezes.')
    FAQ('How is the Google Earth walkthrough connected?',
        'It is not connected at all, in the sense people expect. Google Earth’s web '
        'version accepts the entire camera position in its web address, so the button is '
        'a link assembled from the site’s latitude, longitude and elevation plus a '
        'distance, field of view, heading and tilt. The satellite photograph in the '
        'pop-up beside it is a <b>Leaflet</b> map using <b>Esri World Imagery</b> tiles, '
        'credited on the map. No account, no key, no payment. See section 3.4.')
    FAQ('Where does the news come from, and why is some of it missing?',
        '35 sources - 26 RSS feeds and 9 Google News topic searches - fetched by your '
        'browser through public CORS proxies. Those proxies are free, heavily loaded and fail often, so '
        'typically only a third to two-thirds of the sources answer any single pull. The '
        'archive is cumulative and the pull order rotates, so a source missed at one '
        'refresh is picked up at the next.')
    FAQ('Why does the site ask for a password on some pages, and is it secure?',
        'Eighteen pages are behind one owner password. Only its SHA-256 fingerprint is '
        'published, so the password itself is not in the repository. But this hides '
        '<b>pages, not data</b>: the underlying files remain publicly fetchable, because '
        'the check happens in your browser after everything is downloaded. It is a '
        'courtesy barrier, not security, and nothing sensitive is behind it.')
    FAQ('Do you track me?',
        'The site keeps its own visitor log in a Google Sheet: time, duration, '
        'approximate city and country from your IP address, device, operating system, '
        'browser, screen size, language, time zone, which pages you saw and where you '
        'came from. No third-party advertising or tracking service is involved and '
        'nothing is sold or shared. The About page carries the full list.')

    H2('5.3', 'About satellites and the data')
    FAQ('What exactly is a TLE?',
        'A <b>Two-Line Element set</b>: a satellite’s orbit compressed into two '
        '69-character lines - size, shape, tilt, orientation, and where the satellite was '
        'at one known moment. It is not a position but a recipe for computing the '
        'position at any time. Section 2.2 takes a real one apart field by field.')
    FAQ('Why do some catalogue numbers contain letters?',
        'Catalogue numbers were five digits and we passed 99,999. <b>Alpha-5</b> replaces '
        'the leading digit with a letter: A is 10, B is 11, up to Z, skipping I and O. '
        'So <font face="Courier">A1228</font> means 101,228.')
    FAQ('Why would a brand-new satellite be missing?',
        'CelesTrak may list an object in its master catalogue while publishing no orbital '
        'elements for it, sometimes for weeks. India’s NVS-03, launched 30 October '
        '2026, was still in that state four weeks later. Space-Track has elements '
        'immediately, which is why the Sats-by-Operator page tops up the catalogue from '
        'the Space-Track bundle - about 980 extra operational satellites.')
    FAQ('How is the satellite repository maintained?',
        'On four levels: a live request to CelesTrak; a six-hour cache in your browser; a '
        'bundled snapshot in the repository refreshed by robot every six hours; and two '
        'historical stores that keep <i>old</i> element sets, which everything else '
        'discards. See section 2.6.')
    FAQ('Can the site tell me whether two satellites will collide?',
        'No, and it says so. It shows CelesTrak’s SOCRATES predictions and animates '
        'the encounter faithfully, but real conjunction assessment uses precise orbit '
        'data that is not public. Treat what you see as a picture of the geometry, not an '
        'operational miss distance.')
    FAQ('Why can a satellite that manoeuvred be shown in the wrong place?',
        'SGP4 propagates one unperturbed orbit. Run a TLE from before a burn forward '
        'through it and you get where the satellite <i>would</i> have gone. In one '
        'documented case this gave 471 km for an encounter whose true closest approach '
        'was 39 metres. The site keeps a full element-set history for a few objects so it '
        'can always use the freshest set that precedes the moment in question.')

    H2('5.4', 'About building one')
    FAQ('Do I need to know how to program?',
        'To follow Part 4 and end up with a live globe showing real satellites, no - you '
        'can copy the blocks as they stand. To change it meaningfully you will need some '
        'JavaScript, and the fastest way to learn is to alter one number in working code '
        'and see what moves.')
    FAQ('Do I need to pay for anything?',
        'No, provided your repository is public. Public repositories get free GitHub '
        'Pages hosting and free scheduled Actions. The data sources and libraries are '
        'free.')
    FAQ('Do I need a server?',
        'No - that is the entire point. You need one only for things a browser cannot be '
        'trusted with: real access control, or keeping a secret at the moment a visitor '
        'acts. NAZAR avoids both. Where it genuinely needs a small amount of server '
        'behaviour - storing the visitor log - it borrows a Google Apps Script rather '
        'than renting a machine.')
    FAQ('How long does it take to publish a change?',
        'GitHub Pages rebuilds within about 30 to 60 seconds of a commit. Your own '
        'browser may then show you the old version for up to ten minutes because of '
        'caching - see step 11.')
    FAQ('My scheduled job did not run on time. Is it broken?',
        'Probably not. GitHub delays scheduled runs when its queues are busy, often by '
        'hours. NAZAR’s jobs are set for 05:41 and 06:27 UTC and routinely start '
        'after 13:00. Schedule for frequency, never for a precise moment.')
    FAQ('What is the single most useful habit to copy?',
        'Make every automated job refuse to save output that looks wrong, and make it '
        'say so loudly. A pipeline that quietly delivers nothing is far more damaging '
        'than one that fails: NAZAR’s conjunction page showed a stale week for '
        'sixteen days while every run appeared to complete, and the page went on calling '
        'the expired data "valid" the whole time.')

    # ======================================================================
    PART(6, 'Every page, data file and script in one place, and a glossary of '
            'the terms used in this guide.')
    # ======================================================================

    H2('6.1', 'Every page')
    TABLE(['Page', 'What it is'],
          [['<font face="Courier">index.html</font>',
            'The main globe - live satellites, clocks, observer city, news ticker'],
           ['<font face="Courier">orbits.html</font>',
            'Three-dimensional orbit tracks with a soundtrack'],
           ['<font face="Courier">orbit-maker.html</font>',
            'Educational Kepler-orbit builder with six sliders - no real data'],
           ['<font face="Courier">2d-views.html</font>',
            'Single-satellite ground track on a flat map, plus two small globes'],
           ['<font face="Courier">viz3d.html</font>',
            'God Mode - every active satellite at true altitude'],
           ['<font face="Courier">sats-by-ops.html</font>',
            'The catalogue coloured by 108 operators and constellations'],
           ['<font face="Courier">game-of-cones.html</font>, '
            '<font face="Courier">cone-waffles.html</font>',
            'Sensor-cone geometry: who can see what'],
           ['<font face="Courier">one-hour-lead.html</font>',
            'Every satellite overflying a site in the next hour, plus quiet windows'],
           ['<font face="Courier">dogfights.html</font>',
            'Rendezvous and proximity operations between two chosen satellites'],
           ['<font face="Courier">tle-vault.html</font>',
            'The rolling element-set store, 20 sets per watched object'],
           ['<font face="Courier">mirror-globe.html</font>',
            'The home globe rebuilt on Space-Track instead of CelesTrak'],
           ['<font face="Courier">traffic-conjunctions.html</font>',
            'Predicted close approaches, animated'],
           ['<font face="Courier">data-comparison.html</font>',
            'Western versus Chinese element sets for ISR objects'],
           ['<font face="Courier">sat-stats.html</font>',
            'Catalogue statistics, charts and the TLE refresh log'],
           ['<font face="Courier">debris.html</font>, '
            '<font face="Courier">debris-stats.html</font>',
            'Every catalogued fragment by break-up event; statistics dashboard'],
           ['<font face="Courier">chinrepo.html</font>, '
            '<font face="Courier">compendium.html</font>',
            'Active PRC payloads with launch-site map; the full 2,224-row catalogue'],
           ['<font face="Courier">china-sat-series.html</font>',
            'Printable field guide to Chinese satellite series'],
           ['<font face="Courier">indi-space.html</font>, '
            '<font face="Courier">analogues.html</font>',
            '105 Indian space companies; their global counterparts as spider webs'],
           ['<font face="Courier">launch-map.html</font>, '
            '<font face="Courier">launch-map-2d.html</font>',
            'Global launch-site atlas on a globe and flattened'],
           ['<font face="Courier">rocket-models.html</font>, '
            '<font face="Courier">rocket-gallery.html</font>',
            '531 launch vehicles; the photograph gallery'],
           ['<font face="Courier">launch-gallery.html</font>',
            'Freely licensed spaceport photographs'],
           ['<font face="Courier">news-archive.html</font>',
            'Every headline collected, with a defence and space-surveillance band'],
           ['<font face="Courier">geoid.html</font>',
            'Geoid globe - a mirrored copy of a separate project'],
           ['<font face="Courier">about.html</font>, '
            '<font face="Courier">site-analytics.html</font>',
            'About the site and its tour film; the visitor dashboard'],
           ['<font face="Courier">space-stuff.html</font>, '
            '<font face="Courier">space-launched.html</font>, '
            '<font face="Courier">sat-steroids.html</font>, '
            '<font face="Courier">overpass.html</font>',
            'Section shelves and further tools']],
          [52, 113])

    H2('6.2', 'The main data files')
    TABLE(['File', 'Size', 'Refreshed', 'What it holds'],
          [['<font face="Courier">active.tle</font>', '2.6 MB', 'Every 6 h',
            'TLEs for every active satellite - the tracking fallback'],
           ['<font face="Courier">satcat-active.json</font>', '2.9 MB', 'Every 6 h',
            'CelesTrak master catalogue, active payloads only'],
           ['<font face="Courier">spacetrack-gp.json</font>', '5.1 MB', 'Daily',
            'Every on-orbit payload from Space-Track'],
           ['<font face="Courier">spacetrack-other.json</font>', '3.5 MB', 'Daily',
            'Everything that is not a payload'],
           ['<font face="Courier">spacetrack-debris.tle</font>', '2.0 MB', 'Daily',
            'All catalogued debris - the Debris Tracker’s primary source'],
           ['<font face="Courier">debris.tle</font>', '440 KB', 'Every 6 h',
            'CelesTrak’s four historic break-up clouds'],
           ['<font face="Courier">tle-vault.json</font>', '1.6 MB', 'Daily',
            'Last 20 element sets for 433 watched objects'],
           ['<font face="Courier">tle-history.json</font>', '63 KB', 'On demand',
            'Full published history for a few objects'],
           ['<font face="Courier">conjunctions.json</font>', '9 KB', 'Daily',
            'SOCRATES close-approach predictions'],
           ['<font face="Courier">compendium.json</font>', '1.5 MB', 'On demand',
            '2,224 Chinese payloads'],
           ['<font face="Courier">indi-space.json</font>', '474 KB', 'Hand-built',
            '105 Indian company profiles'],
           ['<font face="Courier">rockets.json</font>', '237 KB', 'On demand',
            '531 launch vehicles'],
           ['<font face="Courier">launch-map.json</font>', '83 KB', 'Hand-built',
            '215 world markers'],
           ['<font face="Courier">countries-110m.geojson</font>', '-', 'Static',
            'Natural Earth outlines, with India’s official boundary'],
           ['<font face="Courier">debris-history.json</font>', '5 KB', 'Every 6 h',
            'Precomputed debris statistics']],
          [53, 18, 24, 70])

    H2('6.3', 'Glossary')
    TABLE(['Term', 'Meaning'],
          [['<b>Alpha-5</b>',
            'Catalogue numbering past 99,999, with a letter for the leading digit.'],
           ['<b>Apogee / perigee</b>',
            'The furthest and nearest points of an orbit from Earth.'],
           ['<b>Commit</b>', 'One saved set of changes in a repository.'],
           ['<b>CORS</b>',
            'The browser rule that stops a page reading another site’s content '
            'without permission.'],
           ['<b>Cron</b>',
            'A five-field timetable format: minute, hour, day, month, weekday.'],
           ['<b>Eccentricity</b>',
            'How elliptical an orbit is. 0 is a circle.'],
           ['<b>Epoch</b>',
            'The moment at which a TLE’s numbers were true.'],
           ['<b>GEO</b>',
            'Geostationary orbit, about 35,786 km up, where a satellite keeps pace with '
            'the Earth’s rotation and appears to hang still.'],
           ['<b>GitHub Actions</b>',
            'Programs GitHub runs for you on a schedule or on demand.'],
           ['<b>GitHub Pages</b>',
            'Free publishing of a repository as a website.'],
           ['<b>Inclination</b>',
            'The tilt of an orbit relative to the equator, in degrees.'],
           ['<b>InstancedMesh</b>',
            'A 3-D technique drawing many copies of one shape in a single instruction.'],
           ['<b>JSON</b>',
            'A plain-text format for structured data, readable by people and programs.'],
           ['<b>LEO</b>',
            'Low Earth orbit, roughly 160 to 2,000 km up, where most satellites are.'],
           ['<b>localStorage</b>',
            'A small store a website may keep inside your browser, on your machine only.'],
           ['<b>NORAD number</b>',
            'The catalogue number assigned to every tracked object.'],
           ['<b>Repository</b>',
            'A project folder stored on GitHub with its full history.'],
           ['<b>RPO</b>',
            'Rendezvous and proximity operations - one satellite deliberately '
            'approaching another.'],
           ['<b>SATCAT</b>',
            'The satellite catalogue: names, owners, launch dates and status.'],
           ['<b>SGP4</b>',
            'The standard public algorithm turning a TLE into a position.'],
           ['<b>SHA-256</b>',
            'A fingerprint of a piece of text: easy to compute, impossible to reverse.'],
           ['<b>SOCRATES</b>',
            'CelesTrak’s published predictions of upcoming close approaches.'],
           ['<b>SSA / SDA</b>',
            'Space Situational / Domain Awareness - knowing what is in orbit and what '
            'it is doing.'],
           ['<b>Static site</b>',
            'A website of finished files with no program running behind it.'],
           ['<b>SVG</b>',
            'A format describing graphics as shapes and coordinates rather than pixels.'],
           ['<b>TLE</b>',
            'Two-Line Element set - a satellite’s orbit in two lines of text.'],
           ['<b>WebGL</b>',
            'The browser interface that lets a web page use the graphics card.'],
           ['<b>Workflow</b>',
            'One automated job definition in <font face="Courier">.github/workflows/</font>.']],
          [34, 131])

    GAP(8)
    P('<i>This guide is generated by <font face="Courier">scripts/gen_guide_pdf.py</font> '
      'from <font face="Courier">scripts/guide_content.py</font>, so it can be rebuilt '
      'whenever the site changes. The source of everything described here is public at '
      'github.com/Hitesh-Gala/sat-orbit-map.</i>', 'caption')
