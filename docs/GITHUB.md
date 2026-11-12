# GitHub publication and local workflow

**Live demo:** [AquaPulse](https://aquapulse-water-intelligence.blondebiscuit2.chatgpt.site)

**Source:** [Complete ZIP](https://aquapulse-water-intelligence.blondebiscuit2.chatgpt.site/aquapulse-source.zip)

## Publication status

The intended repository is `SrijanSingh2006/aquapulse-water-intelligence`. It has **not** been created or uploaded. Both GitHub's GraphQL and REST creation endpoints returned **Resource not accessible by integration (HTTP 403)**. The connected account is recognized, but the integration cannot create a repository.

The account owner needs to create an **empty public repository** named `aquapulse-water-intelligence`, without initializing a README, license or .gitignore. Grant the connected GitHub app access to that repository if its installation is limited to selected repositories. Publication can then resume with the prepared source and its commit history.

Do not send access tokens in chat or commit credentials.

## Upload from an existing checkout

After creating the repository and authenticating Git locally:

```bash
git remote add github https://github.com/SrijanSingh2006/aquapulse-water-intelligence.git
git push -u github main
```

Preserve the separate `sites` remote used by the hosted workflow. When starting from the source ZIP, initialize a local Git repository first (`git init -b main`, `git add .`, `git commit -m "Initial AquaPulse release"`).

## Run and check locally

Use Node.js 22.13 or newer. Extract the ZIP, enter the `aquapulse` directory and run:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run db:local
npm run dev
```

Open the local URL printed by Wrangler. The local database is separate from the hosted demo. For retraining, use Python 3.11 or newer with `ml/requirements.txt`; see the [model card](../ml/MODEL_CARD.md).

The included GitHub Actions workflow retrains the models, checks deterministic artifacts, runs TypeScript checks and Vitest, and builds the application. It will run after publication; a hosted CI result has not yet been verified. Local validation passed all 66 tests.

## Portfolio handoff

Use the live demo on your resume now; add the GitHub link once the repository is public. [Six resume bullets and keywords](RESUME.md), [the interview guide](INTERVIEW.md) and [the advanced demonstration](ADVANCED.md#a-six-minute-demonstration) explain implemented behavior and its limits.

The public application is deployed through Sites. A push to GitHub does not automatically deploy the application. Keep credentials, local database state, virtual environments and generated deployment archives out of Git.
