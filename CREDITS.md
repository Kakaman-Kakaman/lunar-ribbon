# Credits

## Software

Versions are those installed in `node_modules/`; licences are read from each package's own `package.json`.

| Package | Version | Licence | Role |
|---------|---------|---------|------|
| astronomy-engine | 2.1.19 | MIT | dependency |
| react | 19.3.1 | MIT | dependency |
| react-dom | 19.3.1 | MIT | dependency |
| @tailwindcss/vite | 4.3.5 | MIT | dev dependency |
| @types/node | 26.6.6 | MIT | dev dependency |
| @types/react | 19.3.0 | MIT | dev dependency |
| @types/react-dom | 19.3.0 | MIT | dev dependency |
| @vitejs/plugin-react | 6.3.0 | MIT | dev dependency |
| tailwindcss | 4.3.5 | MIT | dev dependency |
| geotiff | 3.0.5 | MIT | dev dependency (terrain pipeline only: reads NASA Goddard GeoTIFF elevation models) |
| typescript | 7.0.2 | Apache-2.0 | dev dependency |
| vite | 8.3.8 | MIT | dev dependency |
| vitest | 5.1.0 | MIT | dev dependency |

## Demo deck (`public/deck/`, served at `/deck/`)

| Item | Source | Licence | Use |
|------|--------|---------|-----|
| Inter typeface | Google Fonts, https://fonts.google.com/specimen/Inter | SIL Open Font License 1.1 | Deck text |
| JetBrains Mono typeface | Google Fonts, https://fonts.google.com/specimen/JetBrains+Mono | SIL Open Font License 1.1 | Deck numbers and labels |
| node-qrcode 1.5.4 | https://github.com/soldair/node-qrcode | MIT | Generated `qr-live-app.svg` once (not shipped as code) |
| Ribbon, deck graphics | `public/deck/ribbon-data.js`, written by `npm run demo-assets` from the engine and the LOLA-derived masks | This project's licence | Every skyline, band, path, and span on the slides |
| App capture | `public/deck/app-two-plans.png`, a screenshot of the live app | This project's licence | Slide 4 |

## Data

| Data | Source | Use | Citation and terms |
|------|--------|-----|--------------------|
| Lunar Orbiter Laser Altimeter gridded data records, products `LDEM_80S_80M` and `LDEM_60S_240M` | NASA Planetary Data System, data set `LRO-L-LOLA-4-GDR-V1.0`; files from https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/ | Terrain behind every skyline | Neumann, G. A. (2011). *LRO Moon Laser Altimeter 4 GDR V1.0* [Data set]. NASA Planetary Data System. https://doi.org/10.17189/1520642. Cited as the PDS asks for PDS3 data: the data set by DOI, the products by ID (https://pds.nasa.gov/datastandards/pds3/citing-pds3-data.shtml). |
| NASA Goddard crossover-adjusted LOLA south-pole elevation model, `LDEM_80S_20MPP_ADJ` (20 m per pixel) | NASA Goddard Planetary Geodesy Data Archive, https://pgda.gsfc.nasa.gov/products/90 | Fine terrain for skylines (version 2) | Barker, M. K., et al. (2023). *Planetary Science Journal* 4, 183. https://doi.org/10.3847/PSJ/acf3e1. Data: https://doi.org/10.60903/gsfcpgda-lola-spole |
| JPL Horizons ephemerides | https://ssd.jpl.nasa.gov/horizons/ | Reference tables for testing Sun and Earth directions (`tests/fixtures/horizons/`) | NASA/JPL Solar System Dynamics. Data retrieved on 2026 November 14. Horizons System. https://ssd.jpl.nasa.gov (the citation form given at https://ssd.jpl.nasa.gov/about/) |
| NASA Moon Trek (Solar System Treks, NASA JPL) | https://trek.nasa.gov/moon/ | Elevation values and NASA Goddard's average Sun and Earth visibility maps, used to check terrain and skylines (`tests/fixtures/trek/`) | Accessed 2026 November 14. No citation form or data-use terms were found on the portal. |
| NASA Goddard average Sun and Earth visibility maps | Served by NASA Moon Trek | Reference for the skyline validation | Method: Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. *Icarus* 211, 1066–1081. https://doi.org/10.1016/j.icarus.2010.10.030 |
| NASA Goddard PGDA south-pole landing-site products | https://pgda.gsfc.nasa.gov/ (each site's product page is in `src/data/sites.json`) | Positions of the five NASA Goddard study sites | Benchmark figures: Barker, M. K., Mazarico, E., Neumann, G. A., Smith, D. E., et al. (2021). Improved LOLA elevation maps for south pole landing sites: Error estimates and their impact on illumination conditions. *Planetary and Space Science* 203, 105119. https://doi.org/10.1016/j.pss.2020.105119 |
| Site coordinates | See the `source` field of each entry in `src/data/sites.json` | Landing and candidate site positions | See each entry's source |

## References

| Reference | Use |
|-----------|-----|
| De Rosa, D., Bussey, B., Cahill, J. T., et al. (2012). Characterisation of potential landing sites for the European Space Agency's Lunar Lander project. *Planetary and Space Science* 74, 224–246. https://doi.org/10.1016/j.pss.2012.08.002 | Convention that the Sun counts as up when at least half its disc is above the skyline |
| NASA (2022). NASA Identifies Candidate Regions for Landing Next Americans on Moon. https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/ | The 6.5-day short-stay profile |
| NASA (2024). NASA Provides Update on Artemis III Moon Landing Regions. https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/ | Candidate regions, including Malapert Massif |
| Foust, J. / SpaceNews (2024-07-17). NASA cancels VIPER lunar rover. https://spacenews.com/nasa-cancels-viper-lunar-rover/ | The 9-to-12-month wait for lighting after a slip |
| Espenak, F. Lunar eclipses 2021-2030, NASA Goddard. https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html | Reference dates for the eclipse check |
| The Spokesman-Review (2025-03-17), reporting Firefly Aerospace's statement on Blue Ghost Mission 1. https://www.spokesman.com/stories/2025/mar/17/fireflys-moon-lander-ends-successful-mission | 346 hours of daylight operations, used to check the predicted sunset |
