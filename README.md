# AI Testing Framework

AI Testing Framework is a composite GitHub Action that uses Copilot CLI to generate Playwright tests for a target React application, run those tests, and export an HTML report.

## Default Behavior

When no custom testing instructions are provided, the action analyzes the caller repository with Copilot CLI and asks Copilot to generate default happy-path Playwright tests from the application context.

The action fails closed if Copilot CLI access is not available. It does not use another LLM provider as a fallback.

## Requirements

- The caller workflow must run the target application before this action starts testing.
- The workflow must provide a `target-url` input.
- The GitHub token used by the action must have access to Copilot CLI for the workflow context.

## Example Usage

```yaml
name: AI Playwright Tests

on:
  pull_request:

jobs:

  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build
      - run: npm run start &

      - id: ai-tests
        uses: your-username/ai-testing-framework@v1
        with:
          target-url: http://localhost:3000
          github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}

      - uses: actions/upload-artifact@v4
        if: ${{ always() }}
        with:
          name: ai-testing-report
          path: ${{ steps.ai-tests.outputs.report-path }}
```

## Custom Instructions

By default, the action looks for custom testing instructions at:

```text
.github/testing_instructions.md
```

If that file is empty or missing, the action generates default happy-path tests.

## GitHub Pages

The action exports the HTML report path as `report-path`. A caller workflow can publish that directory to GitHub Pages using the standard Pages deployment actions.