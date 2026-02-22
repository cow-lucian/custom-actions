# Custom GitHub Actions

A collection of reusable GitHub Actions for common CI/CD workflows.

## Action Catalog

| Action | Type | Description |
|--------|------|-------------|
| [setup-project](#setup-project) | Composite | Set up a project with Node.js, caching, and dependency installation |
| [deploy-status](#deploy-status) | Composite | Create and update GitHub deployment statuses |
| [pr-comment](#pr-comment) | Composite | Create or update PR comments with upsert pattern |
| [cache-restore-save](#cache-restore-save) | Composite | Smart caching with multiple fallback keys |
| [lint-commit-messages](#lint-commit-messages) | JavaScript | Validate commit messages follow Conventional Commits |
| [auto-assign-reviewers](#auto-assign-reviewers) | JavaScript | Auto-assign PR reviewers based on changed files |
| [security-scanner](#security-scanner) | Docker | Security vulnerability scanning with Trivy |
| [terraform-plan-comment](#terraform-plan-comment) | Composite | Run Terraform plan and post results as PR comment |

---

## setup-project

Sets up a project environment with repository checkout, Node.js installation, package manager detection, dependency caching, and dependency installation.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `node-version` | No | `20` | Node.js version to use |
| `package-manager` | No | `npm` | Package manager (`npm`, `yarn`, `pnpm`) |
| `working-directory` | No | `.` | Working directory for the project |

### Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | Whether the dependency cache was hit |

### Usage

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Setup project
        uses: your-org/custom-actions/setup-project@main
        with:
          node-version: '20'
          package-manager: 'npm'

      - name: Build
        run: npm run build
```

---

## deploy-status

Creates or updates GitHub deployment statuses for tracking deployment progress across environments.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | - | GitHub token with deployments permission |
| `environment` | Yes | - | Deployment environment name |
| `state` | Yes | - | Status: `pending`, `success`, `failure`, `error`, `inactive` |
| `description` | No | `''` | Short description of the status |
| `environment-url` | No | `''` | URL of the deployed environment |
| `log-url` | No | `''` | URL to deployment logs |

### Usage

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Set pending status
        uses: your-org/custom-actions/deploy-status@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          environment: production
          state: pending

      - name: Deploy application
        run: ./deploy.sh

      - name: Set success status
        uses: your-org/custom-actions/deploy-status@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          environment: production
          state: success
          environment-url: https://myapp.example.com
```

---

## pr-comment

Creates or updates a pull request comment using a hidden HTML marker for identification, enabling an upsert pattern where repeated runs update the same comment.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | - | GitHub token with pull-requests write permission |
| `message` | Yes | - | Comment body (supports markdown) |
| `header` | No | `''` | Unique identifier for matching existing comments |
| `pr-number` | No | Current PR | Pull request number |

### Outputs

| Output | Description |
|--------|-------------|
| `comment-id` | ID of the created or updated comment |

### Usage

```yaml
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - name: Post test results
        uses: your-org/custom-actions/pr-comment@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          header: test-results
          message: |
            ## Test Results
            All **42** tests passed in **12.3s**.
```

---

## cache-restore-save

Smart caching with restore key fallback strategy. Restores from the primary key first, then tries fallback keys in order. Saves the cache only when no exact match was found.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `path` | Yes | - | Paths to cache (one per line) |
| `key` | Yes | - | Primary cache key |
| `restore-keys` | No | `''` | Fallback key prefixes (one per line) |
| `upload-chunk-size` | No | `''` | Chunk size in bytes for upload |

### Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | Whether an exact key match was found |
| `cache-matched-key` | The key that was actually matched |

### Usage

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: your-org/custom-actions/cache-restore-save@main
        with:
          path: node_modules
          key: node-modules-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            node-modules-
```

---

## lint-commit-messages

Validates that commit messages in a pull request follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. Reports errors as annotations and generates a summary.

### Supported Types

`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | - | GitHub token |
| `base-ref` | No | `main` | Base branch reference |
| `strict` | No | `true` | Fail the action on invalid messages |

### Outputs

| Output | Description |
|--------|-------------|
| `valid` | Whether all messages are valid (`true`/`false`) |
| `errors` | JSON array of error objects |

### Usage

```yaml
on:
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/custom-actions/lint-commit-messages@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          strict: 'true'
```

---

## auto-assign-reviewers

Automatically assigns pull request reviewers based on which files were changed, using a CODEOWNERS-like YAML configuration.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | - | GitHub token with pull-requests write permission |
| `config-path` | No | `.github/reviewers.yml` | Path to reviewers config |
| `max-reviewers` | No | `2` | Maximum reviewers to assign |

### Outputs

| Output | Description |
|--------|-------------|
| `assigned-reviewers` | Comma-separated list of assigned reviewers |

### Configuration File Format

```yaml
# .github/reviewers.yml
reviewers:
  - patterns:
      - "src/frontend/**"
      - "**/*.tsx"
    users:
      - frontend-dev-1
      - frontend-dev-2

  - patterns:
      - "src/api/**"
      - "**/*.go"
    users:
      - backend-dev-1

  - patterns:
      - "infra/**"
      - "*.tf"
    users:
      - devops-engineer

defaults:
  reviewers:
    - team-lead
```

### Usage

```yaml
on:
  pull_request:

jobs:
  assign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/custom-actions/auto-assign-reviewers@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          max-reviewers: '3'
```

---

## security-scanner

Docker container action that performs filesystem security vulnerability scanning using [Trivy](https://trivy.dev/).

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `scan-path` | No | `.` | Path to scan |
| `severity-threshold` | No | `HIGH` | Minimum severity: `UNKNOWN`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `output-format` | No | `table` | Output format: `table`, `json`, `sarif` |

### Outputs

| Output | Description |
|--------|-------------|
| `vulnerabilities-count` | Number of vulnerabilities found |
| `report-path` | Path to the scan report file |

### Usage

```yaml
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run security scan
        id: scan
        uses: your-org/custom-actions/security-scanner@main
        with:
          severity-threshold: HIGH
          output-format: json

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: security-report
          path: ${{ steps.scan.outputs.report-path }}
```

---

## terraform-plan-comment

Runs `terraform plan` and posts the formatted output as a pull request comment. Supports upsert pattern so repeated runs update the same comment per working directory.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | - | GitHub token for PR comments |
| `working-directory` | No | `.` | Directory with Terraform files |
| `terraform-version` | No | `1.6` | Terraform version to install |
| `github-token` | No | `''` | Token for Terraform provider auth |

### Outputs

| Output | Description |
|--------|-------------|
| `plan-exitcode` | Exit code (0=no changes, 2=changes) |
| `has-changes` | Whether changes were detected |

### Usage

```yaml
on:
  pull_request:

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Terraform Plan
        uses: your-org/custom-actions/terraform-plan-comment@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          working-directory: infra/
          terraform-version: '1.6'
```

---

## Development

### Repository Structure

```
custom-actions/
├── .github/
│   └── workflows/
│       └── test-actions.yml
├── setup-project/
│   └── action.yml
├── deploy-status/
│   └── action.yml
├── pr-comment/
│   └── action.yml
├── cache-restore-save/
│   └── action.yml
├── lint-commit-messages/
│   ├── action.yml
│   ├── index.js
│   └── package.json
├── auto-assign-reviewers/
│   ├── action.yml
│   ├── index.js
│   └── package.json
├── security-scanner/
│   ├── action.yml
│   ├── Dockerfile
│   └── entrypoint.sh
├── terraform-plan-comment/
│   └── action.yml
└── README.md
```

### Testing

Tests run automatically via the `.github/workflows/test-actions.yml` workflow on push to `main` and on pull requests. Some tests (PR comments, deploy status, commit linting) only run on `pull_request` events.

Run manually via workflow dispatch from the Actions tab.

### Adding a New Action

1. Create a new directory under the repository root
2. Add an `action.yml` with name, description, author, branding, inputs, outputs, and runs config
3. Implement the action logic (composite steps, JavaScript, or Docker)
4. Add tests to `.github/workflows/test-actions.yml`
5. Update this README with documentation

## License

MIT
