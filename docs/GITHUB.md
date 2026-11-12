# GitHub repository and local workflow

**Repository:** [SrijanSingh2006/aquapulse-water-intelligence](https://github.com/SrijanSingh2006/aquapulse-water-intelligence)

**Live demo:** [AquaPulse](https://aquapulse-water-intelligence.blondebiscuit2.chatgpt.site)

**Continuous integration:** [Validate AquaPulse](https://github.com/SrijanSingh2006/aquapulse-water-intelligence/actions/workflows/ci.yml)

## Clone and run

Use Node.js 22.13 or newer:

```bash
git clone https://github.com/SrijanSingh2006/aquapulse-water-intelligence.git
cd aquapulse-water-intelligence
npm ci
npm run build
npm run db:local
npm run dev
```

Open the local URL printed by Wrangler. The local database is separate from the hosted demo. For ML retraining, use Python 3.11 or newer with the pinned dependencies in `ml/requirements.txt`; see the [model card](../ml/MODEL_CARD.md).

Alternatively, download the [complete source ZIP](https://aquapulse-water-intelligence.blondebiscuit2.chatgpt.site/aquapulse-source.zip), extract it, enter its `aquapulse` directory and run the same npm commands.

## Check a change

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions runs on pushes and pull requests. It installs JavaScript and Python dependencies, reproduces the model artifacts, checks TypeScript, runs all 66 Vitest tests, and builds the browser assets and Worker. Inspect the linked workflow for the result of a specific commit.

If you edit `db/schema.ts`, run `npm run db:generate`, review the generated SQL and apply the local migrations with `npm run db:local`. Hosted schema changes belong to the matching deployment workflow.

## Contribute or maintain

Create a branch, make the change and run the checks before pushing:

```bash
git switch -c improve-aquapulse
git add .
git commit -m "Describe the implemented change"
git push -u origin improve-aquapulse
```

Repository write access is required to push to the owner's repository. Other contributors can fork the project and open a pull request. Keep credentials, local database state, virtual environments and generated deployment archives out of Git. Preserve any separate `sites` remote used by the hosted workflow.

## Portfolio handoff

Use the repository and live-demo links above on your resume. [Six resume bullets and keywords](RESUME.md), [the interview guide](INTERVIEW.md) and [the advanced demonstration](ADVANCED.md#a-six-minute-demonstration) describe the implemented behavior and its limits.

The public application is deployed through Sites. A push to GitHub runs CI but does not automatically deploy the application. The hosted source ZIP is generated from the release's source during its build.
