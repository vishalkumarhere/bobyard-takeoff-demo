# Takeoff Accuracy Ops Review

A single page operational analytics dashboard for AI assisted construction takeoff. It looks at one quarter of takeoffs by project type and trade and answers three questions: where is AI takeoff accuracy still below target, how many estimator review hours do those errors actually cost, and how much time would targeted retraining give back.

Built as a candidate work sample for Bobyard's Senior Data Analyst, Operations role. It is framed as the kind of report a first data hire would ship in month one, not a modeling showcase.

## What it shows

- **Stat tiles**: projects processed, project weighted takeoff accuracy, project types below the accuracy target, and review hours saved under the current plan.
- **Error rate by project type**: horizontal bars against an error limit line derived from the accuracy target. A metric toggle switches the same view to review hours per project or takeoff to bid cycle time.
- **Volume against error rate**: a scatter of project count against error rate, sized by review hours, so high volume but low error types are visibly separate from low volume but expensive ones.
- **Ranked table**: project types ordered by review hours at stake (review time spent correcting takeoff errors), with a suggested route: retrain plus senior review, confidence gate, or monitor. Sortable on every column.
- **Findings**: computed from the data on every change, including the Pareto concentration of error cost, the gap between volume rank and opportunity rank, the correlation between error rate and review hours, and the weakest trade inside the top opportunity type.
- **Action plan**: four numbered actions in priority order, with the named project types and hour figures filled in from the current filters.
- **Decision impact**: sliders for how many project types get improved (in ranked order), how much error correction time the improvement removes, and loaded estimator cost. Outputs review hours returned per quarter, estimator FTE, extra bid capacity, and annual value, plus a curve showing diminishing returns as more types are added.

The trade filter and accuracy target slider drive every view at once.

## Data

All data is synthetic. It is shaped like takeoff and estimating data (project type, trade, share of line items within quantity tolerance, estimator review hours, cycle time) and generated deterministically in `app.js` from a small table of per type baselines and per trade effects. It is not Bobyard's data or any customer's data, and the page says so in a visible banner.

Modeling assumptions, stated in the page as well:

- The share of review time spent correcting takeoff errors grows with error rate (7% of review time per point of error, clamped between 10% and 80%). Only that share counts as recoverable.
- One estimator FTE is 520 hours per quarter.
- A bid takes its review hours plus 1.2 hours of setup.

## Stack

Plain HTML, CSS, and JavaScript. No build step, no framework, no chart library. Charts are hand built inline SVG (`charts.js`), with a colorblind safe palette validated against the dark surface. All theme values are CSS variables in `styles.css`.

Run it by opening `index.html` through any static file server, or deploy the folder as a static site.

## Author

Vishal Kumar. [Portfolio](https://vishal-kumar-portfolio-six.vercel.app)
