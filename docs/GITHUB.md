# GitHub repository and local workflow

**Repository:** [SrijanSingh2006/aquapulse-water-intelligence](https://github.com/SrijanSingh2006/aquapulse-water-intelligence)

**Live demo:** [AquaPulse](https://aquapulse-water-intelligence.blondebiscuit2.chatgpt.site)

## Clone and run

```bash
git clone https://github.com/SrijanSingh2006/aquapulse-water-intelligence.git
cd aquapulse-water-intelligence
npm ci
npm run db:local
npm run dev
```

Use Node.js 22.13 or newer. `npm run dev` builds the application and starts the local Worker. Open the URL printed by the development server. The local database belongs to this checkout and is separate from the hosted demo.

For ML retraining, use Python 3.11 or newer and the pinned dependencies in `ml/requirements.txt`. See [the README](../README.md#run-locally) and [model card](../ml/MODEL_CARD.md).

## Check a change

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions also retrains the Python models and verifies that the committed artifacts reproduce before running the application checks. Review the workflow run for each commit's status.

If you edit `db/schema.ts`, run `npm run db:generate`, review the generated SQL and apply the local migrations with `npm run db:local`. Hosted schema changes belong to the matching deployment workflow.

## Contribute or maintain

Create a branch, make the change and run the checks before pushing:

```bash
git switch -c improve-aquapulse
git add .
git commit -m "Describe the implemented change"
git push -u origin improve-aquapulse
```

Repository write access is required to push to the owner's repository. Other contributors can fork the project and open a pull request. Keep secrets, local database state, virtual environments and generated deployment archives out of Git. Preserve any separate Sites source remote used by the hosted workflow.

## Portfolio handoff

Use the repository and live-demo links above on a resume. [The six resume bullets](RESUME.md) describe implemented behavior without claiming real customer data, achieved water savings or production adoption. [The interview guide](INTERVIEW.md) and [advanced demo](ADVANCED.md#a-six-minute-demonstration) explain how to demonstrate the project.

GitHub stores the source and runs CI. The public application is deployed through Sites; pushing a branch to GitHub does not by itself publish that branch to the live demo.
