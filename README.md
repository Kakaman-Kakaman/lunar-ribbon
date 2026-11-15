# Ribbon

Ribbon is a lunar landing-site navigator. At the Moon's south pole, the skyline is the calendar.

Entry for the NASA Space Apps Challenge 2026, challenge "Lunar Landing Site Navigator".

Team Falcate: Muhammad Asif, Muhammad Ahmad Qidwai, Syed Muzammil Hassan, Mohammad Hassan, Rameesha Sheeraz, Aqsa Awan.

- Live app: https://kakaman-kakaman.github.io/lunar-ribbon/
- Demo deck (seven slides): https://kakaman-kakaman.github.io/lunar-ribbon/deck/

## What it does

Ribbon answers a lunar mission planner's question, "the landing date moved: is the site still
good?", with one picture.

It unrolls the full circle of horizon around a landing site into a strip: south, west, north in
the middle, east, south again, as a panorama from the lander would look. On it Ribbon draws:

- the real skyline, computed from NASA LOLA terrain;
- the Sun's band (everywhere the Sun can be over the coming months) and the Sun's path for this
  landing, with a tick for each day;
- Earth's region, the small patch of sky where Earth wobbles;
- dark spans, labelled in hours or days, wherever terrain hides the Sun.

Near the Moon's south pole the Sun never climbs high. It circles the horizon about 12° a day,
always right to left on the strip, so the width of a ridge is the number of days it hides the
Sun. The strip reads as a calendar.

Two landing plans are compared by stacking two strips. Each gets a verdict that names the cause,
direction, and distance of any terrain that blocks the Sun or Earth, plus the number of days the
landing can slip and still work, and the next landing date that works. A landing-date strip
colours every landing time over the next year. Three mission profiles (6.5-day stay, one lunar
day, 100-day rover) and two observer heights (2 m and 10 m) change the rules.

Any point can be typed as latitude and longitude, or picked on a shaded-relief map of the pole. Inside 80°S its skyline is computed in the
browser from a 480 m NASA LOLA grid and labelled indicative; elsewhere the Moon is treated as a
smooth sphere. Three real landings can be replayed (IM-1 Odysseus, IM-2 Athena, Blue Ghost
Mission 1), each with what the app shows kept apart from what happened.

The app opens on a real case at Malapert Massif. Plan A works. Plan B lands three days later,
and the Sun goes behind a ridge 2.3 to 4.6 km to the west for 36 hours of the 6.5-day stay. The
next landing that works is about 26 days later.

## How it was checked

- Sun and Earth directions against NASA JPL Horizons, six cases, 6,610 rows per body: largest
  difference 0.0078° (Sun) and 0.0034° (Earth).
- Terrain heights against NASA Moon Trek at five NASA Goddard study sites: largest difference
  16 m.
- Skylines against NASA Goddard's average Sun and Earth visibility maps at 23 sites: correlation
  0.975 (Sun) and 0.995 (Earth). On ridge crests Ribbon runs about 7.5 points sunnier than NASA's
  maps on average, because the 80 m grid cannot see smaller relief.
- Blue Ghost Mission 1: sunset 347.8 hours after landing, against the 346 hours of daylight operations Firefly reported.
- Eclipses: the engine finds Earth crossing the Sun on 8 of the 10 lunar eclipse dates in NASA's
  2027-2030 table, with nothing extra, and full cover at all three total eclipses. The two it
  misses are shallow penumbral eclipses. A stay that includes an eclipse says so in its verdict.

The app's Validation section has the full results (`src/data/validation.json`).

## Limits

- Craters and boulders smaller than the 80 m terrain grid are invisible.
- Sites north of 60°S have no terrain, only a smooth sphere, and are labelled.
- Typed points use a 480 m grid inside 80°S, so hills under about half a kilometre are missing;
  the app labels these skylines indicative.
- "Earth in view" is a line of sight, not a radio link budget.
- Two of the three Earth-in-view thresholds are this tool's defaults, not NASA figures; the app
  says which.

## Run it locally

```
npm install
npm run dev
npm test
```

Live app: https://kakaman-kakaman.github.io/lunar-ribbon/

`npm run deploy` runs the tests and the build, then publishes `dist/` to the `gh-pages` branch,
which GitHub Pages serves.

## Data pipeline

```
npm run fixtures     # fetch Sun/Earth reference tables from NASA JPL Horizons into tests/fixtures/horizons/
npm run masks        # build terrain skyline masks
npm run coarse-dem   # build the coarse terrain model
```

The mask and terrain steps read raw LOLA files from `data-raw/lola/`, which is not committed. Download these files, together with their `.LBL` labels, from the LRO LOLA PDS archive:

- https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.IMG
- https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_60S_240M.IMG

## Credits

Data and software credits: `CREDITS.md`

## Licence

Apache License 2.0. See `LICENSE`.
