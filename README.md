English | [Español](README.es.md)

# CI Bill Doctor

**Catch GitHub Actions cost regressions before merge.**

See when a pull request expands a matrix, moves jobs to macOS or Windows,
broadens triggers, or removes CI guardrails—before usage changes reach the bill.

- Read-only by default.
- No source code, logs, or artifacts are sent to CI Bill Doctor.
- No account, backend, AI model, or CI Bill Doctor telemetry.

[Try the browser scanner](https://seba-montero.github.io/ci-bill-doctor/) ·
[Install in 2 minutes](#install-in-2-minutes) ·
[See a validated report](https://github.com/seba-montero/ci-bill-doctor-lab/pull/2) ·
[View on Marketplace](https://github.com/marketplace/actions/ci-bill-doctor)

[![CI Bill Doctor report showing a workflow rate increase from $0.012 to $0.372 per minute](site/public/report-preview.png)](https://github.com/seba-montero/ci-bill-doctor-lab/pull/2)

_Illustration based on a validated result from the public lab. Estimates are
gross-equivalent signals at public list rates, not invoices._

## Install in 2 minutes

Create `.github/workflows/ci-bill-doctor.yml` on the default branch:

```yaml
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
```

No checkout step is required. On the next pull request that changes a file
directly under `.github/workflows`, open the **CI cost guard** job summary.

The first report includes:

- the base and proposed hosted-runner rate per workflow runtime minute;
- introduced and resolved findings;
- severity, confidence, evidence, and a recommendation for every finding;
- explicit assumptions when a runner, matrix, or price cannot be modeled.

Comments, historical analysis, and merge blocking remain off by default.
Consumers that require maximum supply-chain stability can pin the full
`v0.2.0` release commit SHA instead of the moving `v0` major tag.

## Try without installing

The [free browser scanner](https://seba-montero.github.io/ci-bill-doctor/)
analyzes or compares workflow YAML locally in the current tab.

- The same deterministic TypeScript core powers the scanner, CLI, and Action.
- Workflow text is not uploaded, persisted, logged, or sent to analytics.
- Dynamic expressions remain unknown instead of being executed or guessed.
- Input is capped at 250 KB per workflow to protect the browser tab.

## What it detects

| Signal | Example | Why it matters |
|---|---|---|
| Expensive runners | Moving portable jobs from Linux to macOS or Windows | Public list rates differ materially |
| Matrix expansion | Growing from 2 to 12 static combinations | Every combination can create another job |
| Duplicate triggers | Broad `push` plus `pull_request` | The same commit may run twice |
| Missing cancellation | No `concurrency.cancel-in-progress` | Superseded runs can keep consuming minutes |
| Missing timeouts | A job without `timeout-minutes` | Hung processes can run until the platform limit |
| Cache opportunity | Dependency installation without visible setup caching | Repeated setup work may increase duration |
| Unknown cost | Dynamic, reusable, larger, custom, or self-hosted runner | The tool refuses to treat unknown as zero |

The decision engine is deterministic and does not use AI.

## Optional history, comments, and enforcement

The static report needs only `contents: read` and `pull-requests: read`.
Monthly context and comments are separate opt-ins:

```yaml
permissions:
  actions: read
  contents: read
  pull-requests: write

jobs:
  inspect:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: seba-montero/ci-bill-doctor@v0
        with:
          history: "true"
          comment: "true"
          fail-on: "high"
```

| Capability | Default | Additional permission | Behavior |
|---|---|---|---|
| Step Summary | On | None beyond the minimum | Publishes the report with no PR write |
| Historical context | Off | `actions: read` | Reads bounded run/job metadata and processes it in memory |
| PR comment | Off | `pull-requests: write` | Creates or updates one idempotent comment |
| Failure threshold | `none` | None | Can fail on `high`, `medium`, `low`, or `info` |

If history is unavailable because of permissions, rate limits, incomplete data,
or unpriced runners, the Action keeps the static report and explains the
fallback. It never fails solely because an expected history query is unavailable.

## How the estimate works

For static analysis, the primary signal is:

```text
public runner rate × static matrix copy count
```

The beta catalog currently covers standard GitHub-hosted Linux, Windows, and
macOS runners. It does not include free quotas, discounts, credits, taxes,
larger runners, or custom self-hosted costs.

With `history: "true"`, CI Bill Doctor samples completed run/job metadata over a
bounded 7–90 day window. It estimates observed frequency and run cost, then
projects a conservative monthly gross-equivalent scenario. A trigger change,
incomplete coverage, or approximate matrix prevents an unsupported proposed
monthly number.

Read the [methodology and limits](docs/methodology.md) for formulas, sampling,
API budgets, and confidence rules.

## Privacy and security

The public product has no CI Bill Doctor backend.

- Base and head workflow files are read by immutable event SHAs.
- Fork pull requests are read from the base repository's scope.
- Historical analysis reads metadata only—never logs or artifacts.
- Historical data is processed in memory and only aggregates reach the report.
- No workflow text, source code, token, run ID, job ID, or private name is sent
  to CI Bill Doctor.
- The default configuration has no write permission.

Do not use `pull_request_target`. Report vulnerabilities through
[Private Vulnerability Reporting](https://github.com/seba-montero/ci-bill-doctor/security/advisories/new),
not a public issue. See [SECURITY.md](SECURITY.md) for the full contract.

## Validated beta status

Current release: **v0.2.0**.

The v0.2 release gate includes:

- 50 automated core, adapter, lab, and browser-boundary tests;
- Node.js 22 checks and production Node.js 24 Action smoke;
- reproducible bundles and dependency audit with zero known vulnerabilities as
  checked on 2026-08-02;
- base/head rate comparison, matrix expansion, trigger-change suppression,
  historical projection, idempotent comment, and failure-threshold scenarios.

The v0.2 Action bundle is byte-for-byte identical to the remotely validated
v0.1.0 bundle. Its normal, minimum-permission, private-fallback, and
cross-repository fork probes therefore carry over without extending the claim
to the new browser surface. The hash, evidence, and public run links are recorded
in the [remote validation report](docs/remote-validation.md). Beta confidence is
capped at `medium`; longitudinal backtesting is still required.

Not yet included:

- exact invoice reconciliation, quotas, discounts, or larger-runner prices;
- persistent longitudinal history or verified savings;
- automatic workflow patches;
- dashboard, account, authentication, or billing;
- support for GitLab, CircleCI, or Buildkite.

## Feedback without a meeting

Product validation is asynchronous:

- [Share whether a sanitized result was useful](https://github.com/seba-montero/ci-bill-doctor/issues/new?template=result-feedback.yml)
- [Choose the first hosted capability](https://github.com/seba-montero/ci-bill-doctor/issues/new?template=hosted-interest.yml)
- [Report a reproducible bug](https://github.com/seba-montero/ci-bill-doctor/issues/new?template=bug-report.yml)
- [Ask a sanitized usage question](https://github.com/seba-montero/ci-bill-doctor/issues/new?template=usage-question.yml)

Issue content is public. Never include private workflow YAML, repository names,
tokens, logs, artifacts, billing information, or confidential data.

## Local development

Requirements: Node.js 22.22.2 (pinned in `.nvmrc`) and npm.

```bash
nvm use
npm install
npm test
npm run build
```

Useful commands:

```bash
# Analyze or compare workflow files
npm run cli -- analyze .github/workflows/ci.yml
npm run cli -- compare test/fixtures/base.yml test/fixtures/head.yml

# Open the browser scanner locally
npm run dev:site

# Run the full release-quality gate
npm run check
```

The Action bundle uses GitHub's Node.js 24 runtime. The browser scanner is a
static Vite build and has no server component.

## Open-core model

The parser, deterministic engine, CLI, browser scanner, and GitHub Action are
distributed under the [MIT License](LICENSE). The free product remains useful
without an account or backend.

A future private service may monetize durable history, multi-repository
aggregation, policies, and scheduled reports. The commercial boundary is
persistence and coordination—not hiding the first useful analysis.

See the [open-core decision](docs/decisions/0001-open-core-mit.md),
[ephemeral-history boundary](docs/decisions/0002-ephemeral-history.md),
[public-core/private-platform boundary](docs/decisions/0003-public-core-private-cloud.md),
and [trademark policy](TRADEMARKS.md).

## Documentation

- [Methodology and limits](docs/methodology.md)
- [Current status](docs/current-status.md)
- [Architecture](docs/architecture.md)
- [Product specification](docs/product-spec.md)
- [Reproducible consumer lab](lab/README.md)
- [Remote validation report](docs/remote-validation.md)
- [Security policy](SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
