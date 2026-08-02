# CI Bill Doctor methodology and limits

**Release:** v0.2.0 beta
**Pricing catalog reviewed:** 2026-08-01
**Metric:** gross-equivalent cost signal at public GitHub-hosted runner list rates

CI Bill Doctor is a preventive comparison tool. It does not reconstruct a
GitHub invoice and does not claim guaranteed savings. Every output must preserve
that distinction.

## Static cost signal

For each analyzable job, the core classifies its runner and estimates its static
matrix fan-out. The workflow signal is:

```text
job signal = public runner price per minute × static matrix copies
workflow signal = sum of all job signals
```

The comparison reports base, proposed, and delta values in USD per workflow
runtime minute. This means “one minute of every statically expanded job,” not
one wall-clock minute and not one month of usage.

The versioned catalog currently covers standard GitHub-hosted runners:

| Family | Public list rate used by v0.2.0 |
|---|---:|
| Linux | US$0.006/minute |
| Windows | US$0.010/minute |
| macOS | US$0.062/minute |

The authoritative snapshot is
[`catalog/github-hosted-standard.json`](../catalog/github-hosted-standard.json).
Its source is the official
[GitHub Actions runner pricing documentation](https://docs.github.com/en/billing/reference/actions-runner-pricing).

## Unknown values

Unknown is never treated as zero.

A complete static rate remains unavailable when a job has:

- a dynamic runner expression;
- a larger or custom GitHub-hosted runner not present in the catalog;
- a self-hosted runner without an explicit trusted price;
- a reusable workflow whose runners are defined elsewhere;
- a dynamic matrix that cannot be expanded safely;
- an invalid job structure.

The findings and known job-level evidence remain available even when the total
cannot be calculated.

## Static matrix estimation

- A matrix with only literal array dimensions uses the exact Cartesian product.
- `matrix.include` without other dimensions uses the number of include entries
  with medium confidence.
- A matrix containing `include` or `exclude` alongside dimensions reports the
  base Cartesian product with low confidence because the final expansion may
  differ.
- Expressions or non-array dimensions remain unknown.

Approximate matrix evidence may produce a finding, but it cannot support a
proposed monthly projection.

## Historical collection

History is disabled by default. When `history: "true"`, the Action reads only
metadata for completed workflow runs and jobs. It never requests logs,
artifacts, source code, billing data, secrets, or environment variables.

User inputs are bounded:

| Input | Default | Allowed range |
|---|---:|---:|
| `history-window-days` | 30 | 7–90 |
| `history-sample-runs` | 10 | 3–20 |

The window is divided into as many as five non-overlapping time buckets. The
global run sample is allocated approximately in proportion to the completed-run
count in each bucket. This avoids selecting only the most recent executions and
reduces over-weighting of low-volume periods.

For every selected run, the adapter requests jobs with `filter=all`, so previous
retry attempts remain part of observed consumption. Jobs are paginated to a
maximum of 200 records per run. More than 200 jobs, inconsistent totals, or an
incomplete response mark the run as truncated.

The Action processes historical data for no more than five changed workflows
and enforces a global budget of 120 historical API requests per execution.

## Observed run cost

A job with valid positive elapsed time is priced as:

```text
job cost = (completed_at - started_at) × runner list rate
```

Retries are included. A complete run containing no jobs, or only skipped jobs,
is a valid zero-cost observation. A cancelled job without positive observed
duration contributes zero; a cancelled job with valid positive duration is
priced normally.

A run is excluded when any required priced job has:

- unknown or unpriced runner labels;
- invalid or missing timestamps;
- incomplete pagination;
- duplicated or inconsistent records;
- an arithmetic overflow or other invalid value.

The tool never extrapolates missing job costs from a partial run.

## Monthly gross-equivalent scenario

For a valid sample:

```text
monthly frequency = completed runs in window / window days × 30.4375
expected base monthly cost = mean observed cost per run × monthly frequency
static ratio = proposed static signal / base static signal
expected proposed monthly cost = expected base monthly cost × static ratio
expected monthly delta = expected proposed monthly cost - expected base monthly cost
```

The report also calculates nearest-rank p50 and p95 observed cost per run. The
`atRunP50` and `atRunP95` monthly columns answer “what if every run cost the
observed p50 or p95?” They are sensitivity scenarios, not percentiles of
aggregate monthly spend, worst cases, confidence intervals, or SLAs.

The expected scenario uses the mean because the arithmetic expectation of total
cost depends on mean cost per run. Internal monetary accumulation uses integer
micro-USD before presentation rounding.

## When monthly output is withheld

Monthly base, proposed, and delta scenarios require complete coverage of the
selected sample. A single excluded run makes the monthly scenarios unavailable;
the tool may still show observed partial statistics and diagnostics.

The historical baseline may remain visible while the proposed amount and delta
are withheld when:

- the workflow trigger configuration changes structurally;
- either static side has an approximate matrix;
- a job is invalid;
- the base or proposed static rate is unavailable;
- insufficient comparable evidence exists.

A trigger change invalidates the assumption that future frequency matches the
observed period. CI Bill Doctor does not silently reuse that frequency.

## Confidence

During the beta, historical projections cannot exceed `medium` confidence.

- **Medium:** complete projection, complete sample, at least five valid runs,
  and a window of at least seven days.
- **Low:** fewer than five runs, incomplete evidence, changed triggers,
  approximate static comparison, or unavailable proposed scenario.
- **High:** intentionally unavailable until longitudinal backtesting passes.

Confidence is an explained evidence category, not a probability.

## Findings

The initial deterministic rules cover:

- macOS and Windows runner choice;
- large static matrices;
- missing job timeouts;
- broad `push` plus `pull_request` triggers;
- missing concurrency cancellation;
- conservative dependency-cache opportunities;
- reusable workflows whose cost is not visible in the caller;
- invalid job mappings.

Every finding includes a stable rule identifier, severity, confidence, message,
evidence, recommendation, and location when available. The engine never executes
workflow commands or GitHub expressions.

## API and output bounds

- Typical historical requests per workflow: 15 at defaults and 25 at the
  maximum sample.
- Pagination worst case per workflow: 25 at defaults and 45 at the maximum.
- Historical workflows per Action execution: five.
- Global historical request budget: 120.
- Jobs collected per run: at most 200.
- Pull-request files returned by GitHub: at most 3,000; an incomplete diff fails
  explicitly instead of reporting no change.
- Step Summary, comments, and JSON use conservative size limits and omit only
  complete report items. JSON declares truncation and omitted counts.
- Browser scanner input: at most 250 KB per workflow.

Expected authorization, network, rate-limit, and data-quality failures preserve
the static report with a visible reason. Unexpected programming or core defects
propagate and fail the Action instead of being disguised as normal fallback.

## Excluded from every estimate

- included minutes or free-tier allowances;
- organization-specific discounts, credits, taxes, or spending caps;
- exact invoice rounding and billing adjustments;
- other repositories' usage;
- larger-runner prices not present in the catalog;
- the economic cost of self-hosted hardware and operations;
- future changes in duration, traffic, cache hit rate, retries, or concurrency;
- workflow behavior hidden behind dynamic expressions or reusable calls.

## Backtesting gate

Before raising confidence or marketing verified outcomes, the expected delta
must be backtested against subsequent comparable periods. The initial internal
gate requires:

- correct expected-delta direction in at least 80% of verifiable cases;
- absolute percentage error no greater than 30% in at least 70% of material
  cases, with absolute error used near zero;
- projection availability in at least 70% of eligible workflows;
- reproducible exclusions and diagnostics;
- no beta result used as the sole automated merge-blocking criterion.

Projected, observed, and verified values must remain separate concepts. A
future hosted product may call a saving “verified” only after an explicit,
versioned baseline and comparability contract passes.
