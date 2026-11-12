# Publish this project to your GitHub

Use these steps if the session could not authenticate to your GitHub account. An existing Git installation or `gh` binary does not prove account access. Never paste an access token into the source, README or chat.

## 1. Review the repository

Keep dependency locks, model artifacts, tests, migrations, README and docs. Confirm `.gitignore` excludes dependency folders, local databases, virtual environments, credentials and generated deployment archives. A Sites source repository may already be configured; keep that remote intact.

```bash
git status
git remote -v
npm ci
npm run typecheck
npm test
npm run build
```

## 2. Authenticate through GitHub CLI

```bash
gh auth login
gh auth status
```

Follow the CLI's browser sign-in process on your own account. Choose the account and repository audience deliberately. A public portfolio repository exposes all tracked files and history.

## 3. Create the repository and push

For a source checkout that is not already a Git repository:

```bash
git init
git add .
git commit -m "Build AquaPulse industrial water intelligence application"
git branch -M main
```

If the project is already committed, skip that initialization block. From the project directory, create a public repository under the authenticated account, using a separate remote name so an existing Sites remote is preserved:

```bash
gh repo create aquapulse --public --source=. --remote=github --push
gh repo view --web
```

If that repository name already exists, choose an available name or add the intended existing repository URL as the `github` remote, then push your current branch. Do not force-push over someone else's work.

## 4. Finish the portfolio handoff

1. Verify the GitHub Actions workflow completes on the pushed commit.
2. Add the actual deployment URL near the top of the README.
3. Check the demo in a signed-out browser. A private Sites deployment requires a sharing change before recruiters can visit it.
4. Add a repository description and topics such as `typescript`, `react`, `machine-learning`, `iot` and `water-management`.
5. Use the resume wording only after running the application and reviewing the interview guide.

This guide describes the publishing process. It does not itself create a GitHub repository or change Site sharing.
