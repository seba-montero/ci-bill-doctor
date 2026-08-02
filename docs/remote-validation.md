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
| Cross-repository fork | Read the fork head by immutable SHA with no write permission or secrets | Cross-repository PR; read-only token; $0.012 to $0.372 delta; 5/5 valid historical runs; zero comments | [PR 8](https://github.com/seba-montero/ci-bill-doctor-lab/pull/8) |

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

## Release gate outcome

All technical gates for v0.1.0 passed. The fork probe used head commit
`d4e74cba8acebf06d8a1209a596f89fe57b49ba2` from `smontero88`, while the base
workflow consumed the Action at
`23421c0fe7e36d8528592fb1435ef4e078b7c90a`. Effective permissions were
`actions: read`, `contents: read`, and `pull-requests: read`, with no write
scope. The guard and all application jobs passed.

The immutable `v0.1.0` tag identifies this validated Action bundle. The moving
`v0` tag may advance to later compatible releases; consumers that need this
exact build should pin the full release commit SHA.

The Marketplace Developer Agreement, listing categories, and any account-level
publication confirmation are separate manual release steps.

## v0.2.0 carry-over and browser release gate

Version v0.2.0 adds the browser scanner, acquisition site, structured feedback
forms, and Pages deployment workflow. It does not change the executable Action
bundle validated above. A reproducible build of both versions produces the same
SHA-256 for `dist/action/index.cjs`:

```text
84c609f423fbd17823b4aba21a51424e48c7dbd1ce3ddebaf9dffe1719768006
```

The real-repository Action probes therefore carry over only to the unchanged
Action execution surface. They are not evidence for browser behavior.

The independent v0.2.0 web release gate requires Node and browser typechecks,
50 automated tests, eight Action smoke scenarios, dependency and artifact
license checks, a production build without source maps or network/persistence
runtime markers, a successful Pages deployment for the release commit, and a
remote browser smoke of the canonical site. The version must not be tagged or
published to Marketplace until those commit checks and the live-site smoke pass.
