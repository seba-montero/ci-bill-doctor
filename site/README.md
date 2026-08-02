# CI Bill Doctor browser scanner

This directory contains the static acquisition site and browser-only workflow
scanner published at:

<https://seba-montero.github.io/ci-bill-doctor/>

## Purpose

The site lets a visitor receive useful value before installing the GitHub
Action. It supports two jobs:

1. analyze one workflow for cost-risk findings;
2. compare a base workflow with a proposed version.

It imports the public deterministic core through `src/browser.ts`. It does not
copy analyzer rules and does not contain a separate estimation model.

## Privacy contract

- All parsing and analysis run inside the browser tab.
- Workflow text is never sent through `fetch`, forms, analytics, logging, or
  error reporting.
- Workflow text is never placed in cookies, local storage, session storage, the
  URL, or clipboard automatically.
- Dynamic GitHub expressions are parsed as data and are never evaluated.
- Dynamic output is created with DOM text nodes; workflow-controlled values are
  not rendered through `innerHTML`.
- Input is capped at 250 KB per workflow, measured as UTF-8 bytes.
- The production site has no account, backend, API key, CI Bill Doctor
  telemetry, advertising, tracking pixel, or third-party font. GitHub may still
  process standard Pages request data as the hosting provider.

Any future analytics integration requires a separate privacy review, public
disclosure, prohibited-property enforcement, and an explicit decision about
consent. YAML, repository/workflow/job names, findings, errors, or analysis
results must never be analytics properties.

## Development

From the repository root:

```bash
nvm use
npm install
npm run dev:site
```

Production build:

```bash
npm run build:site
npm run preview:site
```

The output is written to ignored directory `dist/site`.

## Tests and acceptance

`site/src/scanner.test.ts` verifies that the browser boundary:

- analyzes a static workflow using the public core;
- reproduces the validated `$0.012 → $0.372` comparison;
- rejects empty and oversized input;
- measures UTF-8 bytes correctly;
- retains conservative parser failures.

The repository typecheck includes all site TypeScript. The full `npm run check`
also builds the production site, so Node-only dependencies introduced into the
browser graph fail CI.

Manual release checks:

- desktop and mobile layouts have no horizontal overflow;
- keyboard focus is visible and scanner controls have accessible labels;
- example analysis renders without a console error;
- invalid YAML renders only escaped text;
- file opening does not make a network request;
- Marketplace, GitHub, feedback, security, and install links resolve;
- the deployed artifact contains no credential or analytics endpoint.
- the deployed artifact includes the project license and third-party notices.

## Deployment

`.github/workflows/pages.yml` builds and deploys `dist/site` with GitHub Pages.
This repository is configured to use GitHub Actions as its Pages source;
subsequent pushes to `main` deploy automatically. Owners of a fork must select
**Settings → Pages → Build and deployment → GitHub Actions** once.

The Vite base path is `/ci-bill-doctor/`. A future custom domain requires an
explicit configuration change, canonical URL update, sitemap update, and link
review.

## Measurement during the no-telemetry beta

Initial signals deliberately avoid hidden product telemetry:

- GitHub repository traffic, referrers, and clones;
- public dependency references to the Action;
- sanitized result-feedback issues;
- hosted-capability preference issues;
- reproducible bug reports;
- later checkout or preorder transactions.

GitHub repository traffic has a rolling 14-day window and should be snapshotted
outside this public repository. Private repository adoption remains invisible
unless a user explicitly provides feedback or later connects the hosted product.

## Non-goals

- historical GitHub API access from the browser;
- loading workflows directly from a private repository;
- exact invoice calculation;
- account creation, email capture, checkout, or Cloud persistence;
- Markdown rendering of user-controlled content;
- automated workflow rewriting;
- AI-generated explanations.
