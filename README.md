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

## Race card

The **Race card** tab lists today's horses by race and post position, like a traditional PP. Claude picks up each horse's race number, post (program number), morning line and any printed run style from the PP headers when it reads your files. You can also import a CSV with `track, date, race, post, horse` columns (plus `ml` if you have it).

For each horse:

- **Rating:** the unified figure (Beyer scale), plus its rank in the field, and last, best and trend figures.
- **Product columns:** the horse's most recent figure from each product.
- **Agree (0 to 1, where 1 = total agreement):** how closely the products' figures matched on the same runs. For each run, the score is `1 / (1 + (gap / 6)²)`, where *gap* is the average difference, in Beyer points, between each pair of products. That works out to 1.00 for identical figures, 0.80 at 3 points apart, 0.50 at 6 and 0.20 at 12. The horse's score is the average over its last 6 runs that have two or more products. Green means the products agree (0.8 or higher); red means they conflict (below 0.5).
- **Style:** worked out from the first-call position in the last 6 running lines.
  - **E** (early): on the lead or within 1 length
  - **P** (presser): within 5 lengths
  - **C** (closer): further back

  When there are no running lines, a style printed in the PPs is used instead (Brisnet's E and E/P count as E, and S counts as C).

- **PSR:** ThoroManager's Projected Speed Rating for the race, read from its PDF PPs, with each horse's PSR rank in the field. It's ThoroManager's own forecast, so it sits beside the rating and is not blended into it. First-time starters have none. Entry CSVs can carry a `psr` column.

For each race:

- **Order agreement:** whether the products rank the field in the same order. It is Kendall's tau between each pair of products, rescaled to 0 to 1.
- **Early speed:** how many E types are in the field.
- **PSR vs Rating:** whether ThoroManager's top PSR horse is also the top-rated horse.

**Download PDF report** builds a landscape PDF of the whole card in the page itself. It can include each horse's last 6 races. Viewing cards and making PDFs never uses Claude; only reading new files does.

## Dropping in raw PPs and sheets

On the hosted page you don't need to format anything. Drop files on the **Figures** tab:

- PDFs straight from DRF, Brisnet, TimeformUS, Equibase, TrackMaster, ThoroManager, Ragozin or Thoro-Graph
- photos or scans of sheets
- text copied out of a PP (paste it into **Paste rows**)

Claude reads each page on your Claude account (it uses some of your usage) and lists every past race with its figure. Nothing is saved until you check the list and click **Save**. Text-based PDFs are read from their text layer, keeping the column layout. Scanned pages and photos are sent as images, with tall pages split into strips so small print stays readable. Reading the same file again within 24 hours reuses the earlier answer.

Sheets often show only the month of a race. When exactly one known race for that horse matches the month (and the track, if both show one), the day is filled in from it, so the sheet figure joins the DRF row. Otherwise the row is flagged **needs a date** and left unchecked.

CSV files with figure columns still import directly, without Claude.

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

**Automatic calibration** is on by default. Whenever your saved races change, every product with at least 20 races that also have another product's figure is fitted from them, so products that run hot or cold line up before they are blended or compared. Without this, a product that runs 10 points above Beyer (ThoroManager and Equibase both do) makes every horse look like a disagreement. Turn it off on the Calibration tab to set intercepts and slopes by hand; the fitted values are kept as your starting point.

Load races where you have two or more products for the same run, then click **Fit from my data**. Horsey regresses each product against the consensus of all the *other* products, repeats this until the values settle, and reports the sample size, correlation (r) and RMSE for each product. Beyer stays fixed as the anchor of the scale.

The fit uses reduced-major-axis regression rather than ordinary least squares. Both sides of the fit are noisy measurements of the same performance, and ordinary least squares would systematically flatten the slopes.

A product needs at least 5 paired races to be fitted. In practice, a few dozen races across sprints and routes gives stable numbers.

## Combining runs from different products

Rows for the same horse on the same date are one race. Every import also tidies up what that rule alone can't, in this order:

1. **Products you don't use.** When you use DRF plus exactly one other past-performance product (ThoroManager, say), any figure the reader filed under a PP product you don't use is moved to that one. ThoroManager pages read as "Equibase" or "TrackMaster" were the cause. The reader is also told which products you use, so this shouldn't recur. Choose your products in the **I use** column on the Calibration tab.
2. **Wrong years.** A date read with the wrong year lands in the future (2026-12-26 when today is 2026-10-29); it is moved back a year.
3. **One horse under two names.** Two similar names (one contains the other, or they're 2 letters apart) whose runs fall on the same dates at least twice, from different products ("Disaster" and "R Disaster"), become one horse. The name on a race card wins; otherwise, the name with more rows.
4. **Repeats.** An undated row that repeats a saved run (same product, same figure, nothing contradicting) is a second read that missed the date. It is dropped, and any details it adds are kept.
5. **Undated runs.** An undated run joins the row that is the same run from another product: same track (BAQ and AQU count as one), and at least two of distance, finish, first-call position, race number and field size agreeing with none contradicting. If one detail contradicts, at least four others must agree, because one side sometimes misreads a distance. Products record details slightly differently, so first-call positions within 2, field sizes within 1 and distances within 0.15 furlongs don't count as contradictions. When several rows fit, the one whose calibrated figure is clearly closest wins (within 3 points, with the next at least 5 points further). Otherwise nothing is joined.

Data saved before these rules existed gets a **Clean up** banner that does all of this in one click.

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
lib/extract.js      PDF text layout, prompt and answer checking for raw-file import
lib/card.js         race cards: entries, agreement scores, running style
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
