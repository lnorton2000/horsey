# Horsey: Unified Speed Figures

Horsey converts speed figures from different past-performance products into one number, the **Unified Figure (UF)**. The UF uses a Beyer-equivalent scale: higher is better, and a UF of 100 reads like a 100 Beyer.

Supported products:

| Product | Scale | Default conversion (rule of thumb) |
|---|---|---|
| Beyer (DRF PPs) | higher = better | anchor: UF = Beyer |
| Ragozin Sheets | lower = better, ~1 pt per length | Rag 0 ≈ 120; ~3 UF per point at 6f, ~2 at 9f |
| Thoro-Graph | lower = better, ~1 pt per length | TG 0 ≈ 118; distance-scaled like Ragozin |
| Brisnet Speed | higher = better | ≈ Beyer + 5 |
| TimeformUS | higher = better, wider scale | TFUS 120 ≈ 100 |
| Equibase Speed | higher = better | ≈ Beyer + 2 |
| TrackMaster Speed | higher = better | identity (off by default) |
| ThoroManager PPs | higher = better | identity until you fit it |

**The defaults are only a starting point.** Use **Calibration → Fit from my data** to replace them with conversions estimated from your own figures. ThoroManager in particular has no published scale to start from.

## Running it

**Hosted (recommended):** open the published page on claude.ai. Everything you import and every calibration change saves to your Claude account automatically, so it is there on any device and survives clearing your browser. The dot under the title shows the save state.

**Local:** open `index.html` in a browser, or run:

```bash
npm start
```

Then go to http://localhost:8000. Run locally, data is saved in that browser only. Use **Download backup** to keep a copy.

To rebuild the single-file hosted version after changing the code:

```bash
npm run build:artifact
```

## Importing without duplicates

Upload as often as you like. A horse runs at most once a day, so **horse + date identifies a race**:

- Re-importing a file you already loaded changes nothing.
- Separate files for the same card merge into the same rows. For example, a DRF file with Beyers, a Ragozin file and a Thoro-Graph file each fill in their own column.
- A newer file with a corrected figure overwrites the old value. Blank cells never erase anything.
- Horse names match regardless of case, punctuation or country suffix (`Copper Comet` = `COPPER COMET (IRE)`).
- Dates match across formats: `2026-08-13`, `8/13/26`, `13Aug26` and `Aug 13, 2026` are the same day.

You can select several files at once in the import dialog.

## How it works

### 1. Converting each figure

```
UF = intercept + slope × figure × distFactor
```

`distFactor` is `8 ÷ furlongs` for length-based sheet figures (Ragozin, Thoro-Graph) and `1` for everything else. Sheet points are roughly lengths, and a length is worth more speed-figure points in a sprint than in a route. Without this factor, every sprint-vs-route comparison between Sheets and Beyers would be skewed.

### 2. Blending one race

The UF for a race is the weighted mean of every converted figure you have for that run. Each race also gets:

- **Spread:** the max minus the min of the converted figures, i.e. how much the products disagree about the same run. A large spread usually means one product saw something the others didn't (wide trip, wind, weight, track variant), and it is worth checking.
- **Confidence:** higher when more products agree.

### 3. Rating each horse

A horse's rating is a recency- and confidence-weighted average of its last N race UFs. The defaults are N = 6 and a decay of 0.8 per race back. The Rankings tab also shows each horse's last, best and top-2-of-last-3 figures, plus a trend (last race vs. the average of the three before it).

### 4. Calibration (the important part)

Load races where you have two or more products for the same run, then click **Fit from my data**. Horsey regresses each product against the consensus of all the *other* products, repeats this until the values settle, and reports the sample size, correlation (r) and RMSE for each product. Beyer stays fixed as the anchor of the scale.

The fit uses reduced-major-axis regression rather than ordinary least squares. Both sides of the fit are noisy measurements of the same performance, and ordinary least squares would systematically flatten the slopes.

A product needs at least 5 paired races to be fitted. In practice, a few dozen races across sprints and routes gives stable numbers.

## Data format

Use one row per race run. Import a CSV or TSV file, paste rows in, or type them into the Figures tab. Column names are flexible:

| Field | Accepted headers |
|---|---|
| horse | `horse`, `name` |
| date | `date` (ISO `2026-08-13` sorts best) |
| track, race, surface | `track`/`trk`, `race`, `surface`/`surf` |
| distance | `distance`/`dist`: `6f`, `6 1/2f`, `7½f`, `1m`, `1 1/16m`, `1m70y`, `8.5` |
| Beyer | `beyer`, `bsf`, `drf` |
| Ragozin | `ragozin`, `rag`, `sheets` |
| Thoro-Graph | `thorograph`, `tg` |
| Brisnet | `brisnet`, `bris` |
| TimeformUS | `timeform`, `tfus` |
| Equibase | `equibase`, `eqb` |
| TrackMaster | `trackmaster`, `tm` |
| ThoroManager | `thoromanager`, `tmgr` |

Blank cells are fine; each race uses whichever products it has.

Sheet notation is understood. Leading flag letters are ignored (`F7` is read as 7). For trailing symbols, `-` means −¼, `+` means +¼, and `"` or `½` means +½. Publishers' legends differ, so if your sheets use these symbols differently, change `parseFigure` in `lib/figures.js`.

**Export CSV** writes every row back out with its unified figure, spread and the number of sources used.

## Project layout

```
index.html          UI shell
app.js              UI logic (tabs, tables, import/export, account/browser storage)
scripts/            build-artifact.js bundles everything into one page for hosting
style.css           styles (light and dark)
lib/figures.js      conversion, blending, calibration, ratings, CSV, merging; no dependencies
lib/sample-data.js  fictional demo horses (not real figures)
test/               node:test unit tests
```

`lib/figures.js` works in both the browser and Node, so you can script it:

```js
const F = require('./lib/figures.js');
const sources = F.cloneSources();
F.convertAcross(sources, 'ragozin', '8"', '1 1/16m'); // Rag 8½ in every other scale
```

Run the tests:

```bash
npm test
```

## Caveats

- The products don't measure exactly the same thing. Ragozin and Thoro-Graph adjust for weight, wind and ground loss; Beyers do not. No linear mapping removes that difference. The spread column is there so you can see it rather than average it away.
- Turf and synthetic figures often relate to each other differently than dirt figures do. If you have enough data, consider fitting them separately: import a surface subset, fit, and note the numbers.
- The sample data is fictional and generated only to demonstrate the workflow.
