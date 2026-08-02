# Remote validation report

**Date:** 2026-08-02
**Action commit under test:** `23421c0fe7e36d8528592fb1435ef4e078b7c90a`
**Consumer repository:** [`seba-montero/ci-bill-doctor-lab`](https://github.com/seba-montero/ci-bill-doctor-lab)

This report records real GitHub Actions executions. It complements the local
test suite and simulated API smoke tests; it does not replace them.

## Results

| Probe | Expected result | Observed result | Evidence |
|---|---|---|---|
| Core CI | Node 22 checks and Node 24 bundle smoke pass; rebuild is byte-equivalent | Passed | [run 30731157319](https://github.com/seba-montero/ci-bill-doctor/actions/runs/30731157319) |
| Pull request without workflow changes | Valid report with zero items | `items: 0`, not truncated | [PR 1](https://github.com/seba-montero/ci-bill-doctor-lab/pull/1) |
| Matrix and macOS expansion | Static rate increases from $0.012 to $0.372 per workflow minute | Delta $0.360; `expensive-runner` and `large-matrix` introduced | [PR 2](https://github.com/seba-montero/ci-bill-doctor-lab/pull/2) |
| Historical projection | Five recent, fully priced runs produce a projection | 5/5 valid; baseline $0.022159/month; proposed $0.686929; delta $0.664770 | [run 30731399347](https://github.com/seba-montero/ci-bill-doctor-lab/actions/runs/30731399347) |
| Trigger expansion | Preserve baseline and withhold incomparable proposal | Static delta zero; proposed monthly cost and delta are `null`; diagnostic `trigger-configuration-changed` | [PR 3](https://github.com/seba-montero/ci-bill-doctor-lab/pull/3) |
| Minimal configuration | No checkout, no `actions: read`, and `history: false` still produce valid JSON | Passed; checkout was not downloaded; no monthly projection | [PR 5](https://github.com/seba-montero/ci-bill-doctor-lab/pull/5) |
| Idempotent comment | A synchronize event updates the Action's comment instead of duplicating it | One `github-actions[bot]` comment retained ID `5155132344`; `updated_at` advanced | [PR 6](https://github.com/seba-montero/ci-bill-doctor-lab/pull/6) |
| `fail-on: high` | Only the guard check fails when a high finding is introduced | Application matrix passed; guard failed with one high finding | [PR 7](https://github.com/seba-montero/ci-bill-doctor-lab/pull/7) |

## Private-repository permission fallback

A separate private consumer fixture ran `history: true` without
`actions: read`. The token permission summary contained no Actions permission;
the history endpoint returned HTTP 403; the report recorded
`historyCollection.status: unavailable` and retained the static comparison. The
guard check passed. The private run is intentionally not linked from this public
document.

The same missing-permission condition cannot be reproduced faithfully in the
public lab because workflow run metadata for a public repository remains
publicly readable.

## Remaining release gate

A real pull request from a fork is still required to confirm head-SHA reads and
read-only token behavior across the repository boundary. Marketplace publication
and the moving `v0` tag remain blocked until that probe succeeds.

The Marketplace Developer Agreement, listing categories, and any account-level
publication confirmation are separate manual release steps.
