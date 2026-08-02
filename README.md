English | [Español](README.es.md)

# CI Bill Doctor

CI Bill Doctor estimates potential GitHub Actions cost regressions before they
are merged.

The product does not try to guess an exact bill. It turns workflow changes into
explainable signals: expensive runners, matrix expansion, jobs without timeouts,
duplicate executions, missing cancellation, and conservative caching
opportunities.

## Status

Initial version 0.1.0 is under development.

Already implemented:

- deterministic analysis of an individual workflow;
- comparison between a base version and a proposed version;
- transparent estimation of the aggregate runner rate per workflow minute;
- detection of macOS and Windows runners;
- static matrix calculation;
- rules for timeouts, triggers, concurrency, and caching;
- CLI with Markdown or JSON output;
- GitHub Action that analyzes files changed in a pull request;
- GitHub Step Summary reporting;
- optional pull request comment and configurable failure threshold;
- opt-in, ephemeral history of completed runs and jobs;
- expected monthly projection and `gross-equivalent` sensitivity scenarios;
- fallback to static analysis when permissions or data are insufficient;
- reproducible consumer lab;
- automated tests for the core, adapter, and lab manifest;
- end-to-end bundle smoke tests against a simulated GitHub API.

Not yet included:

- free-tier allowances, discounts, or larger runners;
- longitudinal persistence, invoice reconciliation, or verified savings;
- automatic patches;
- dashboard, authentication, or billing;
- support for GitLab, CircleCI, or Buildkite.

## Core principle

Every result should answer four questions:

1. What changed?
2. Why could it cost more?
3. What evidence did the rule use?
4. What are the estimate's limitations?

The MVP decision engine does not use AI.

## Local requirements

- Node.js 22.22.2, pinned in .nvmrc.
- npm.

The Action bundle uses GitHub's Node.js 24 runtime.

## Getting started

Install dependencies:

    npm install

Run the tests:

    npm test

Analyze a workflow:

    npm run cli -- analyze .github/workflows/ci.yml

Compare two versions:

    npm run cli -- compare test/fixtures/base.yml test/fixtures/head.yml

Produce JSON:

    npm run cli -- compare test/fixtures/base.yml test/fixtures/head.yml --json

Build the library, CLI, and Action bundle:

    npm run build

Run the end-to-end smoke tests for the compiled bundle:

    npm run smoke:action

## Use as a GitHub Action

A checkout step is not required to analyze a pull request. The minimal
configuration is:

    name: CI cost guard

    on:
      pull_request:
        paths:
          - ".github/workflows/**"

    permissions:
      contents: read
      pull-requests: read

    jobs:
      inspect:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - uses: seba-montero/ci-bill-doctor@v0

Historical analysis and pull request comments are opt-in. To enable both, add
`actions: read`, raise `pull-requests` to `write`, and set `history: "true"` and
`comment: "true"`. The `fail-on` input is also optional; by default, the Action
never blocks a merge.

For the smallest permission footprint, keep `comment` set to `false` and use
`pull-requests: read` instead of `write`. The permission cannot be omitted
entirely because the Action needs it to list the files changed in the pull
request. Results will still appear in the Step Summary. `actions: read` is only
required when `history: "true"`; history is disabled by default.

## Current cost model

The core uses a versioned snapshot of public list rates for standard runners:

- Linux: US$0.006/minute.
- Windows: US$0.010/minute.
- macOS: US$0.062/minute.

Source: [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

The reported metric is:

    runner rate × static matrix copy count

The values are summed across all analyzable jobs. This static signal does not
include duration, run frequency, caching effects, or actual concurrency.

Rates are not scattered across individual rules. They live in the
[versioned catalog](catalog/github-hosted-standard.json), which is validated at
load time and accompanied by a [JSON Schema](catalog/pricing-catalog.schema.json).
Labels for larger or custom runners remain unknown.

## Opt-in history and monthly projection

When `history` is enabled, CI Bill Doctor queries recent GitHub Actions metadata
and adds a conservative monthly scenario to pull request comparisons.

| Input | Default | Range | Purpose |
|---|---:|---:|---|
| `history` | `false` | boolean | Enables historical reads and projection |
| `history-window-days` | `30` | 7–90 | Window used to estimate run frequency |
| `history-sample-runs` | `10` | 3–20 | Runs used to calculate mean/p50/p95 per execution |

Frequency is calculated as:

    completed runs created in window / window days × 30.4375

For each run, observed cost is elapsed job time multiplied by the runner's
public list rate. Retries are included. The expected monthly baseline uses
`mean cost/run × frequency`. The report also shows sensitivity scenarios in
which every run costs the observed p50 or p95. Those scenarios are not
percentiles of aggregate monthly cost. The proposal keeps duration and frequency
constant and scales the baseline by the head/base static-signal ratio. If the
`on` configuration changes, the baseline remains visible but proposed cost and
delta are omitted because historical frequency is no longer comparable. The
same restriction applies when a static matrix can only be estimated with low
confidence.

The output is `gross-equivalent`: it is not an invoice, a guaranteed budget, or
a confidence interval. It does not subtract included minutes, discounts,
credits, or taxes, and it does not account for usage by other repositories or
future changes in traffic, caching, or duration. Confidence is capped at
`medium` during the beta.

The adapter divides the window into as many as five time buckets, collects
candidates from each one, and allocates the global sample in proportion to each
bucket's `total_count`. This approximates run-weighted percentiles without
limiting the sample to the most recent executions. It paginates up to 200 jobs
per run and includes retries. A workflow normally uses 15 requests with default
settings and 25 with the maximum sample; the pagination worst cases are 25 and
45, respectively. Only the first five modified workflows are processed with
history in each execution, and the Action enforces a global budget of 120
historical requests.

If a job list exceeds 200 entries, a runner has no known price, or critical
timestamps are missing, the valid subset is not extrapolated. Monthly baseline,
proposed cost, and delta remain unavailable until coverage is complete.
`total_count` preserves frequency even above 1,000; that limit affects GitHub's
result pagination, not the counter. The Action never fails solely because an
expected API query is unavailable. It keeps the static analysis and records the
fallback in Markdown and JSON.

GitHub returns at most 3,000 files for a pull request. If the event payload
declares more changed files than the API returns, CI Bill Doctor fails explicitly
instead of claiming the diff is complete. Step Summary and `report-json` retain
a conservative margin below GitHub's output limits. If an exceptional report
does not fit, complete workflow entries are omitted and the JSON remains valid,
with `truncated`, `summaryTruncated`, and `omitted*` counters.

Integration sources: [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)
and [workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs).

## Structure

    src/
      action.ts       GitHub integration
      analyzer.ts     deterministic rules
      cli.ts          command-line interface
      compare.ts      base-versus-head comparison
      format.ts       Markdown reports
      github-history.ts bounded GitHub Actions adapter
      history.ts      percentiles and monthly projection
      parser.ts       YAML parsing and validation
      pricing.ts      pricing snapshot
      types.ts        result contract
      workflow-path.ts safe classification of file changes
    catalog/
      github-hosted-standard.json
      pricing-catalog.schema.json
    test/
      fixtures/
      analyzer.test.ts
      github-history.test.ts
      history.test.ts
      lab-manifest.test.ts
      pricing.test.ts
      workflow-path.test.ts
    lab/
      README.md       consumer repository runbook
      template/       publishable baseline
      scenarios/      reproducible changes and expectations
      scripts/        safe generator and scenario applier
    docs/
      product-spec.md
      architecture.md

## Privacy and permissions

The MVP does not need to store source code.

For pull requests, the Action reads changed files under `.github/workflows` at
the base and head revisions. Both reads are pinned to event SHAs and performed
against the base repository, so a fork does not expand the token's scope. When
history is enabled, the Action also queries metadata for completed runs and
jobs, but never logs, artifacts, or other source files. Historical data is
processed in memory. The report retains only aggregates and diagnostics, without
IDs, names, or labels. Nothing is persisted or sent to a backend or AI model.

Minimum permissions for static analysis are `contents: read` and
`pull-requests: read`. History additionally requires `actions: read`. To publish
a comment, raise `pull-requests: read` to `pull-requests: write`.

## Future hosted product

The MIT core does not impose repository quotas or require an account. A separate
hosted service may monetize longitudinal history, multi-repository aggregation,
verified savings, organization policies, and scheduled reports. Pricing, limits,
and the payment provider will only be defined after repeated use has been
validated; they are not part of this Action's contract.

## License and open-core model

The parser, deterministic engine, CLI, and GitHub Action are distributed under
the [MIT License](LICENSE). The free version should remain useful without an
account or backend.

Future monetization is centered on persistence, continuity, aggregation, and
coordination, not on hiding the first historical calculation. The decisions are
recorded in [ADR 0001](docs/decisions/0001-open-core-mit.md) and
[ADR 0002](docs/decisions/0002-ephemeral-history.md). The physical separation
between this public core and the private commercial platform is recorded in
[ADR 0003](docs/decisions/0003-public-core-private-cloud.md).

The MIT License permits commercial use of the software. The official name,
logos, and identity are managed separately under the [trademark policy](TRADEMARKS.md).
Licenses for software embedded in the Action bundle are preserved in the
[third-party notices](THIRD_PARTY_NOTICES.md).

## Documentation

- [Product specification](docs/product-spec.md)
- [Current status](docs/current-status.md)
- [Architecture](docs/architecture.md)
- [Reproducible lab](lab/README.md)
- [Remote validation report](docs/remote-validation.md)
- [Architecture decisions](docs/decisions/0001-open-core-mit.md)
- [Ephemeral-history boundary](docs/decisions/0002-ephemeral-history.md)
- [Public core and private platform](docs/decisions/0003-public-core-private-cloud.md)
- [Trademark policy](TRADEMARKS.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Open decisions

- Backtesting criteria before raising model confidence.
- Retry and backoff policy within the request budget.
- Future support for runs with more than 200 jobs.
