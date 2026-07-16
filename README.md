# AI Testing Framework for React Apps
This GitHub Action generates and runs Playwright tests for a React application. It is designed for React application repositories that want automated browser testing without manually writing the first version of every Playwright test.

The action uses GitHub Copilot CLI to generate a Playwright test from your repository context, then runs that generated test inside a Dockerized Playwright sandbox.
## What The Action Does

When a React app repository calls this action, the action performs this flow:
1. Installs this action's Node dependencies.
2. Resolves the Playwright configuration and output paths.
3. Checks that GitHub CLI and Copilot CLI are available.
4. Reads the caller repository context and optional testing instructions.
5. Generates a JavaScript Playwright test file with Copilot CLI.
6. Validates the generated test for unsafe patterns.
7. Runs the generated test inside a Playwright Docker container.
8. Copies the Playwright HTML report back to the caller repository workspace.
## Requirements

The caller workflow must provide:
- A running React application URL through `target-url`.
- A GitHub token that can use Copilot CLI, usually through `github-token`.
- Docker availability on the GitHub Actions runner.

Recommended workflow permissions:
```yaml
permissions:
  contents: read
```
Avoid passing production secrets into the Playwright runtime. Use test credentials, mock APIs, or allowlisted test APIs.

## Basic Usage
Use this when your workflow starts the React app directly on the runner, for example on `localhost:3000`.

```yaml
name: AI Playwright Tests
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read

jobs:
  ai-tests:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build app
        run: npm run build

      - name: Start app
        run: npm run preview -- --host 0.0.0.0 --port 3000 &

      - name: Run AI testing action
        id: ai-tests
        uses: xebia-playground/humpty-dumpty-set-on-a-wall@main
        with:
          target-url: http://localhost:3000
          github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}

      - name: Upload AI testing report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ai-testing-report
          path: ai-testing-report
```

In default `bridge` network mode, the action rewrites `localhost` and `127.0.0.1` to `host.docker.internal` so the Playwright container can reach an app running on the GitHub runner.

## Recommended Docker Internal Network Usage

For stronger isolation, run the React app as a Docker container on a private Docker network and let the action join the Playwright container to the same network.

```yaml
name: AI Playwright Tests

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ai-tests:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Create private test network
        run: docker network create --internal ai-test-net

      - name: Build React app image
        run: docker build -t react-app-under-test .

      - name: Start React app container
        run: |
          docker run -d \
            --name app-under-test \
            --network ai-test-net \
            react-app-under-test

      - name: Run AI testing action
        id: ai-tests
        uses: xebia-playground/humpty-dumpty-set-on-a-wall@main
        with:
          target-url: http://app-under-test:3000
          github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
          sandbox-network: ai-test-net

      - name: Upload AI testing report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ai-testing-report
          path: ai-testing-report

      - name: Cleanup containers
        if: always()
        run: |
          docker rm -f app-under-test || true
          docker network rm ai-test-net || true
```

In this setup:

- `app-under-test` is the Docker container name.
- `http://app-under-test:3000` works because Docker DNS resolves container names inside the same network.
- `docker network create --internal ai-test-net` blocks direct public internet egress from containers on that network.
- The Playwright container can test the React app without exposing the app publicly.

## Usage With External API Allowlist Proxy

If the React app makes browser-side API calls to selected external services during testing, enable proxy egress mode.

```yaml
- name: Run AI testing action
  id: ai-tests
  uses: xebia-playground/humpty-dumpty-set-on-a-wall@main
  with:
    target-url: http://app-under-test:3000
    github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
    sandbox-network: ai-test-net
    egress-mode: proxy
    egress-allowlist-path: .github/egress-allowlist.txt
```

Create `.github/egress-allowlist.txt` in the caller repository:

```txt
# Payment API
api.stripe.com

# Your test backend API
api.mycompany.com
```

This file is an allowlist, not a blocklist. Domains listed in the file are allowed. Any external browser request to a domain not listed receives `403 Forbidden` from the proxy.

Allowed examples:

```txt
https://api.stripe.com/v1/payment_intents
https://api.mycompany.com/products
```

Blocked examples:

```txt
https://evil.example.com/collect
https://google.com
https://api.github.com
```

Only exact hostnames or IP addresses are supported:

```txt
api.stripe.com
api.mycompany.com
192.0.2.10
```

Do not use protocols, paths, wildcards, or CIDR ranges:

```txt
https://api.stripe.com
api.stripe.com/v1/payment_intents
*.stripe.com
*.com
10.0.0.0/8
```

Proxy mode controls browser-originated requests made by Playwright's browser. If the app container itself makes server-side external API calls, configure that app container with proxy environment variables or keep it on an internal Docker network so direct egress is blocked.

## Default Test Generation Behavior

If no custom testing instructions file is found, the action generates default happy-path Playwright tests based on the React application context.

Default behavior means the generated test tries to:

- Open `process.env.TARGET_URL`.
- Inspect visible user-facing UI.
- Interact with common controls such as links, buttons, forms, and navigation.
- Assert visible page behavior rather than implementation details.
- Avoid external services unless explicitly allowed by workflow/network configuration.

The generated test is written as JavaScript using `@playwright/test` and ES module syntax.

The action also validates the generated test before execution. The generated test is restricted to `@playwright/test` imports and may only read `process.env.TARGET_URL` from the environment.

## Custom Testing Instructions

To control what the generated Playwright test should cover, add a testing instructions file to the caller repository.

Default path:

```txt
.github/testing_instructions.md
```

Example:

```md
# Testing instructions

Test the main shopping flow:

1. Open the home page.
2. Search for "running shoes".
3. Open the first product result.
4. Add the product to the cart.
5. Verify the cart page shows the product name and price.

Use visible roles and text where possible. Do not depend on generated CSS class names.
```

Then call the action normally:

```yaml
- name: Run AI testing action
  uses: xebia-playground/humpty-dumpty-set-on-a-wall@main
  with:
    target-url: http://app-under-test:3000
    github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
    sandbox-network: ai-test-net
```

To use a different file path:

```yaml
- name: Run AI testing action
  uses: xebia-playground/humpty-dumpty-set-on-a-wall@main
  with:
    target-url: http://app-under-test:3000
    github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
    sandbox-network: ai-test-net
    testing-instructions-path: docs/ai-testing.md
```

The instructions path must be relative and must stay inside the caller repository.

## Custom Playwright Configuration

By default, the action uses its own Playwright config. You can provide a caller repository Playwright config if your app needs custom timeouts, projects, base settings, or test behavior.

```yaml
- name: Run AI testing action
  uses: xebia-playground/humpty-dumpty-set-on-a-wall@main
  with:
    target-url: http://app-under-test:3000
    github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
    sandbox-network: ai-test-net
    playwright-config: playwright.config.js
    generated-tests-dir: tests/generated-tests
```

When using `playwright-config`, set `generated-tests-dir` to a directory that your Playwright config can discover. For example, if your config uses `testDir: './tests'`, use `generated-tests-dir: tests/generated-tests`.

The config path and generated tests directory must be relative paths inside the caller repository.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `target-url` | Yes | None | URL of the React app under test. |
| `github-token` | No | `github.token` | Token used by GitHub CLI and Copilot CLI. Use a token with Copilot access when needed. |
| `testing-instructions-path` | No | `.github/testing_instructions.md` | Relative path to custom test generation instructions. |
| `playwright-config` | No | Action default config | Relative path to a caller repository Playwright config file. |
| `generated-tests-dir` | No | Depends on config mode | Directory where the generated test file is written. |
| `report-dir` | No | `ai-testing-report` | Directory where the HTML report is copied in the caller workspace. |
| `playwright-container-image` | No | `mcr.microsoft.com/playwright:v1.61.1-noble` | Docker image used for the Playwright sandbox runtime. |
| `sandbox-network` | No | `bridge` | Docker network used by the Playwright container. Use a custom internal network for stronger isolation. |
| `egress-mode` | No | `none` | Use `proxy` to enable external API allowlisting for browser traffic. |
| `egress-allowlist-path` | Required when `egress-mode: proxy` | None | Relative path to the external domain allowlist file. |

## Outputs

| Output | Description |
| --- | --- |
| `report-path` | Absolute path to the generated HTML report directory in the caller workspace. |

## Report Upload Example

```yaml
- name: Upload AI testing report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: ai-testing-report
    path: ai-testing-report
```

## Security Notes For Caller Repositories

- Prefer `docker network create --internal` for app and Playwright testing.
- Do not pass production secrets into the app or Playwright test runtime.
- Use exact trusted domains in `.github/egress-allowlist.txt`.
- Do not use wildcard allowlists.
- Avoid running this action with `pull_request_target` for untrusted pull requests.
- Treat a custom `playwright.config.js` as executable code because Playwright runs it inside the sandbox.

## Complete Example With Internal Network And Egress Proxy

```yaml
name: AI Playwright Tests

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ai-tests:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Create private test network
        run: docker network create --internal ai-test-net

      - name: Build React app image
        run: docker build -t react-app-under-test .

      - name: Start React app container
        run: |
          docker run -d \
            --name app-under-test \
            --network ai-test-net \
            react-app-under-test

      - name: Run AI testing action
        id: ai-tests
        continue-on-error: true
        uses: xebia-playground/humpty-dumpty-set-on-a-wall@main
        with:
          target-url: http://app-under-test:3000
          github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
          sandbox-network: ai-test-net
          egress-mode: proxy
          egress-allowlist-path: .github/egress-allowlist.txt

      - name: Upload AI testing report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ai-testing-report
          path: ai-testing-report

      - name: Cleanup containers
        if: always()
        run: |
          docker rm -f app-under-test || true
          docker network rm ai-test-net || true
```
