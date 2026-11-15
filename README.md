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

- the real skyline, computed from NASA terrain every 0.1° of azimuth out to 200 km, with ridges
  in front of it drawn by distance and a pale strip showing how much it changes within the site's
  position uncertainty;
- the Sun's band (everywhere the Sun can be over the coming months) and the Sun's path for this
  landing, with a tick for each day, fainter where terrain hides part of the disc;
- Earth's region, the small patch of sky where Earth wobbles;
- dark spans, labelled in hours or days, wherever terrain hides the Sun.

Near the Moon's south pole the Sun never climbs high. It circles the horizon about 12° a day,
always right to left on the strip, so the width of a ridge is the number of days it hides the
Sun. The strip reads as a calendar.

Two landing plans are compared by stacking two strips. Each gets a verdict that covers the Sun,
Earth, the battery and contact through NASA's Deep Space Network, names the cause, direction and
distance of any terrain that blocks the Sun or Earth, and gives the number of hours the landing
can slip and the next landing date that works. Around the comparison:

- **Power and contact through the stay:** panel output, battery charge and contact with each Deep
  Space Network complex (Goldstone, Canberra, Madrid), hour by hour.
- **Landing dates:** every landing time over the next year, coloured by what fails.
- **Plan A's site in 3D:** the terrain at true scale on the curved Moon, lit and shadowed by the
  computed Sun, from above or from the lander.
- **Around plan A's site:** a 10 km map of 10,000 points with the share of time in sunlight or
  with Earth in view; click a point to make it plan B, or draw a rover route.
- **Every site, every landing day:** all real-terrain south-pole sites against every day of the
  year.
- **North pole:** 13 IAU-named craters and the highest point near each.
- **Save:** a one-page report or the hourly numbers as CSV. Every setting lives in the link.
- **Tour:** six steps for a first-time reader.

Three mission profiles (6.5-day stay, one lunar day, 100-day rover) and four observer heights
(1, 2, 5 and 10 m) set the rules; every rule and the panel and battery sizes can be changed, and
the app says which numbers are NASA's and which are this tool's assumptions.

The app opens on a real case at the highest point of Malapert Massif. Plan A, landing
2027-03-15 18:00 UTC, works and can slip 24 hours. Plan B lands three days later: 4.7 days in,
ground 0.5 km to the north hides Earth for the last 44 hours of the stay, so contact through the
Deep Space Network is lost. The next landing that works is 19 June 2027, 92.5 days later.

## How it was checked

- Sun and Earth directions against NASA JPL Horizons, six cases, 6,610 rows per body: largest
  difference 0.0078° (Sun) and 0.0034° (Earth).
- The Moon seen from the three Deep Space Network complexes against JPL Horizons: largest
  elevation difference 0.0008°.
- Eclipses: all ten lunar eclipses in NASA's 2027-2030 table found, each within 1 minute of
  NASA's time, with none extra.
- Sun and Earth date by date at Malapert Massif against ACT's Artemis III Geotechnical maps (2 m,
  every 6 hours, December 2025): at ground level the Sun verdict agrees in 97.7% of 25,425
  point-and-time cases, Earth in 98.7%.
- Long-term sunlight against NASA Goddard's average-visibility maps, ground level: south pole,
  23 sites, correlation 0.93 (Sun) and 0.96 (Earth), median difference 1.4 and 0.2 percentage
  points. Ours runs about 6 points darker on average, most at ridge crests, because the 20 m grid
  sees relief near the ground that NASA's 60 to 240 m maps smooth over (version 1's 80 m terrain
  gave 0.975 and 0.995). North pole, 24 points: correlation 0.975 (Sun) and 0.998 (Earth).
- The Shackleton-de Gerlache connecting ridge against Barker et al. (2021): 64.8% of the Sun's
  disc on average at 1 m and 89.6% at 5 m, against the published 67-71% and 83-89%.
- Blue Ghost Mission 1: sunset 347.8 hours after landing, against the 346 hours of daylight
  operations Firefly reported.

The app's Validation section has the full results (`src/data/validation.json`).

## Limits

- Relief smaller than the terrain grid (20 m near the south pole) is invisible. IM-2 Athena came
  to rest in a crater smaller than that.
- Typed points use a 480 m grid inside 80°S, so hills under about half a kilometre are missing;
  the app labels these skylines indicative. Elsewhere outside the terrain the Moon is a smooth
  sphere, and the app says so.
- Contact is a line of sight to the Deep Space Network, not a link budget: antenna scheduling,
  relay satellites and terrain at the stations are not modelled.
- The power model is generic, not a particular lander's.
- Lighting in the 3D view is computed, not photographed.

## Run it locally

```
npm install
npm run dev
npm test
```

`npm run deploy` runs the tests and the build, then publishes `dist/` to the `gh-pages` branch,
which GitHub Pages serves.

## Data pipeline

The generated terrain tiles (`public/tiles`, `public/tiles-north`) and area maps (`public/area`),
about 450 MB, are not committed; the pipeline rebuilds them from the raw NASA files, and the
build copies them into `dist/`. The skyline files (`public/masks-v2`) are committed.

```
npm run fixtures                         # Sun/Earth reference tables from JPL Horizons
node pipeline/build-masks-v2.ts          # skylines, both poles (public/masks-v2)
node pipeline/build-tiles.ts             # terrain tiles, south (public/tiles)
node pipeline/build-tiles.ts --north     # terrain tiles, north (public/tiles-north)
node pipeline/build-area-maps.ts --n 100 --spacing 100   # area maps (public/area)
node pipeline/build-validation.ts        # src/data/validation.json
node pipeline/export-deck-v2.ts          # the deck's data (public/deck/ribbon-data.js)
```

The pipeline reads raw files from `data-raw/`, which is not committed:

- `data-raw/pgda/LDEM_80S_20MPP_ADJ.TIF`, NASA Goddard's 2023 south-pole model:
  https://pgda.gsfc.nasa.gov/products/90
- `data-raw/lola/`, LOLA polar grids with their `.LBL` labels, from
  https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/: `LDEM_60S_240M`, `LDEM_80S_80M`,
  `LDEM_80S_20M`, `LDEM_85S_10M`, `LDEM_60N_240M`, `LDEM_80N_80M`, `LDEM_80N_20M`,
  `LDEM_85N_10M`
- `data-raw/illumination/`, NASA Goddard's north visibility maps (checks only):
  https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/
- `data-raw/a3gt/`, ACT's Malapert Massif cubes (checks only), listed in `CREDITS.md`

## Credits

Data and software credits: `CREDITS.md`

## Licence

Apache License 2.0. See `LICENSE`.
