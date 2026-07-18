# Feature 1 Kanban Board

Branch: `feature-1`

Goal: Track the live app snapshot test-generation architecture for the GitHub Action.

## Done

- [x] Replaced static project file scanning with a skill-based agent flow.
- [x] Added agent entrypoint: `src/agent/index.js`.
- [x] Added orchestration runner: `src/agent/flow-runner.js`.
- [x] Added instruction loader for `testing-instructions-path`.
- [x] Added Playwright app snapshot capture.
- [x] Added Playwright skill for live app inspection and generated test execution.
- [x] Added Copilot CLI skill for prompt construction and test generation.
- [x] Added generated-test validator for JavaScript shape, syntax, unsafe patterns, shell-output rejection, and fixed-wait rejection.
- [x] Added report exporter module for HTML report output.
- [x] Updated `action.yml` to inspect app snapshot before generation.
- [x] Updated `action.yml` to run generated tests through the new agent entrypoint.
- [x] Kept Docker sandbox and custom `sandbox-network` support.
- [x] Kept egress proxy support for allowlisted external browser traffic.
- [x] Added workflow-runner debug logs for instruction loading, app snapshot, Copilot prompt, Copilot raw output, generated test names, and missing required test warnings.
- [x] Added validator unit tests.

## In Progress

- [ ] Confirm caller workflow passes the correct `testing-instructions-path`.
- [ ] Confirm workflow logs show `Testing instructions loaded: yes`.
- [ ] Confirm workflow logs show `Required test names detected: 6` for the Skyline Plumber Run instruction file.
- [ ] Confirm generated spec includes `reaches 400 score through gameplay simulation`.
- [ ] Confirm the Playwright report runs all required instruction-driven tests, not only generic smoke tests.

## Next

- [ ] Add hard instruction-compliance validation so missing required test names fail generation before Playwright runs.
- [ ] Add special validation for 400-score simulations: 400 target, 60-second budget, keyboard movement, score parsing, and `Score Target Achieved` log.
- [ ] Improve app snapshot capture for game apps: canvas labels, HUD text, visible score/coins/lives, and game messages.
- [ ] Make debug logging configurable with an input such as `debug-logs: true`.
- [ ] Add README guidance for `testing-instructions-path`, live app snapshots, and interpreting debug logs.

## Validation

- [x] `npm run test:validator`
- [x] `node --test src/utils/allowlist-proxy.test.js`
- [x] `node --check` on new agent, skill, context, validation, and report modules
- [x] `git diff --check`

## Current Debug Finding

The latest workflow logs showed the action used the default path `.github/testing_instructions.md` and printed `No custom instructions were provided`. That means the Skyline Plumber Run instruction file was not loaded, so Copilot generated default smoke tests instead of the required six gameplay tests.