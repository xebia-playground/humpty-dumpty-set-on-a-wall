import fs from 'node:fs/promises';
import path from 'node:path';

import { formatAppSnapshot } from '../context/app-snapshot.js';
import { loadTestingInstructions } from '../context/instruction-loader.js';
import { generatePlaywrightSpecWithCopilot } from '../skills/copilot-cli-skill.js';
import { inspectApplication, runGeneratedPlaywrightTest } from '../skills/playwright-cli-skill.js';
import { extractPlaywrightTestNames, extractRequiredTestNames, findMissingRequiredTestNames, normalizeGeneratedTest, validateGeneratedTestSyntax } from '../validation/test-validator.js';
import { createAppSnapshot } from '../context/app-snapshot.js';
import { executePlaywrightAction } from '../skills/playwright-cli-skill.js';

const MAX_GENERATION_ATTEMPTS = 2;

export async function inspectLiveApp(env = process.env) {
	const targetUrl = requireEnv(env, 'TARGET_URL');
	const snapshotFile = requireEnv(env, 'APP_SNAPSHOT_FILE');
	const instructions = await loadTestingInstructions({
		instructionPath: env.TESTING_INSTRUCTIONS_PATH || '.github/testing_instructions.md',
		workspacePath: env.TARGET_WORKSPACE || process.cwd(),
	});
	logInstructionDebug(instructions);

	const appSnapshot = await inspectApplication({
		targetUrl,
		snapshotOptions: {
			useAccessibilityTree: true,
		},
	});
	console.log(`Application routes inspected: ${appSnapshot.routes?.length ?? 1}`);
	logGroup('Application snapshot captured by Playwright', formatAppSnapshot(appSnapshot));

	await fs.mkdir(path.dirname(snapshotFile), { recursive: true });
	await fs.writeFile(snapshotFile, `${JSON.stringify(appSnapshot, null, 2)}\n`, 'utf8');
	console.log(`Captured application snapshot: ${path.relative(process.cwd(), snapshotFile)}`);
}

export async function generateTestsFromSnapshot(env = process.env) {
	const targetUrl = requireEnv(env, 'TARGET_URL');
	const workspacePath = env.TARGET_WORKSPACE || process.cwd();
	const testingInstructionsPath = env.TESTING_INSTRUCTIONS_PATH || '.github/testing_instructions.md';
	const outputFile = env.GENERATED_TEST_FILE || path.resolve(env.GENERATED_TESTS_DIR || path.join(process.cwd(), 'src/tests/generated-tests'), 'ai-generated.spec.js');
	const appSnapshot = JSON.parse(await fs.readFile(requireEnv(env, 'APP_SNAPSHOT_FILE'), 'utf8'));

	const instructions = await loadTestingInstructions({
		instructionPath: testingInstructionsPath,
		workspacePath,
	});
	logInstructionDebug(instructions);
	console.log(`Application routes used for Copilot generation: ${appSnapshot.routes?.length ?? 1}`);
	logGroup('Application snapshot used for Copilot generation', formatAppSnapshot(appSnapshot));

	const { normalizedSpec } = await generateAndValidateSpec({
		appSnapshot,
		instructions,
		targetUrl,
		outputFile,
	});

	await fs.mkdir(path.dirname(outputFile), { recursive: true });
	await fs.writeFile(outputFile, normalizedSpec, 'utf8');

	console.log(`Generated Playwright test: ${path.relative(process.cwd(), outputFile)}`);
}

export async function runGeneratedTests(env = process.env) {
	await runGeneratedPlaywrightTest({
		configPath: requireEnv(env, 'PLAYWRIGHT_CONFIG_PATH'),
		generatedTestFile: requireEnv(env, 'GENERATED_TEST_FILE'),
		outputDir: requireEnv(env, 'PLAYWRIGHT_OUTPUT_DIR'),
		project: env.PLAYWRIGHT_PROJECT || 'chromium',
		targetUrl: requireEnv(env, 'TARGET_URL'),
	});
}

function requireEnv(env, name) {
	const value = env[name];
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}

function logInstructionDebug(instructions) {
	const requiredTestNames = extractRequiredTestNames(instructions.text || '');
	console.log(`Testing instructions path: ${instructions.path}`);
	console.log(`Testing instructions loaded: ${instructions.hasCustomInstructions ? 'yes' : 'no'}`);
	console.log(`Testing instructions length: ${(instructions.text || '').length} characters`);
	console.log(`Required test names detected: ${requiredTestNames.length}`);
	for (const testName of requiredTestNames) {
		console.log(`- ${testName}`);
	}
}

function logGeneratedTestDebug(content, instructions) {
	const generatedTestNames = extractPlaywrightTestNames(content);
	const missingTestNames = findMissingRequiredTestNames(content, instructions);

	console.log(`Generated Playwright test cases: ${generatedTestNames.length}`);
	for (const testName of generatedTestNames) {
		console.log(`- ${testName}`);
	}

	if (missingTestNames.length === 0) {
		console.log('Generated tests include all required test names detected from instructions.');
		return;
	}

	for (const testName of missingTestNames) {
		console.warn(`::warning::Generated tests are missing required test case: ${testName}`);
	}
}

function logGroup(title, content) {
	console.log(`::group::${title}`);
	console.log(content);
	console.log('::endgroup::');
}

async function generateAndValidateSpec({ appSnapshot, instructions, targetUrl, outputFile }) {
	let lastError;
	let promptContext = undefined;

	for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
		const generatedSpec = await generatePlaywrightSpecWithCopilot({
			appSnapshot,
			instructions,
			targetUrl,
			feedback: promptContext,
		});
		let normalizedSpec;

		try {
			normalizedSpec = normalizeGeneratedTest(generatedSpec);
			await validateGeneratedTestSyntax(normalizedSpec, {
				tempDir: path.dirname(outputFile),
				targetUrl,
			});
			logGeneratedTestDebug(normalizedSpec, instructions);
			return { normalizedSpec };
		} catch (error) {
			lastError = error;
			const isSyntaxOrGenerationError = isSelfHealEligibleError(error.message);
			if (!isSyntaxOrGenerationError || attempt === MAX_GENERATION_ATTEMPTS) {
				throw error;
			}

			promptContext = {
				attempt,
				errorMessage: error.message,
				generatedSpec,
			};
			console.warn(`::warning::Regenerating tests after syntax/API validation failure: ${error.message}`);
		}
	}

	throw lastError;
}

function isSelfHealEligibleError(message = '') {
	return /invalid|expected raw JavaScript|not valid JavaScript|fixed waits|disallowed module|CommonJS require\(|label: expected string|selector|import/.test(message);
}

async function waitForReactStability(page, previousUrl) {
  const timeoutMs = 1200;

  try {
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
  } catch (error) {
    // Ignore load-state failures; some SPA routes never fire a full page load
  }

  try {
    if (previousUrl) {
      await page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 3000 }).catch(() => {});
    }
  } catch (error) {
    // ignore; route may not change
  }

  await new Promise((resolve) => setTimeout(resolve, 700));
}

function isSnapshotDifferent(a, b) {
  if (!a || !b) return true;
  if (!a.nodes || !b.nodes) return true;

  const aKey = a.nodes.map((n) => `${n.role}:${n.name}:${n.path}`).join('|');
  const bKey = b.nodes.map((n) => `${n.role}:${n.name}:${n.path}`).join('|');

  return aKey !== bKey;
}

export async function runMicroStepLoop({
  page,
  instruction,
  planner,
  validator,
  maxSteps = 25,
  waitOptions = {},
}) {
  let previousSnapshot = null;
  let previousUrl = page.url();
  let lastAction = null;

  for (let step = 0; step < maxSteps; step += 1) {
    const snapshot = await createAppSnapshot(page, previousUrl, { includeA11yTree: true });

    const plan =
      typeof planner === 'function'
        ? await planner({
            instruction,
            snapshot,
            previousSnapshot,
            pageUrl: page.url(),
            step,
          })
        : null;

    if (!plan) {
      return {
        completed: false,
        reason: 'No planner decision returned',
        lastSnapshot: snapshot,
      };
    }

    lastAction = plan;

    await executePlaywrightAction(page, plan);

    const beforeRouteUrl = page.url();
    await waitForReactStability(page, previousUrl);

    const nextSnapshot = await createAppSnapshot(page, page.url(), { includeA11yTree: true });

    const validation =
      typeof validator === 'function'
        ? await validator({
            instruction,
            previousSnapshot: snapshot,
            currentSnapshot: nextSnapshot,
            action: plan,
            previousUrl,
            currentUrl: page.url(),
          })
        : {
            passed: true,
            completed: true,
          };

    previousSnapshot = nextSnapshot;
    previousUrl = page.url();

    if (validation?.completed || validation?.passed) {
      return {
        completed: Boolean(validation.completed || validation.passed),
        step,
        action: plan,
        snapshot: nextSnapshot,
      };
    }

    if (validation?.retryable === false) {
      return {
        completed: false,
        failed: true,
        step,
        action: plan,
        snapshot: nextSnapshot,
        reason: validation.reason || 'Action validation failed',
      };
    }
  }

  return {
    completed: false,
    step: maxSteps,
    action: lastAction,
    snapshot: previousSnapshot,
    reason: 'Max steps exceeded',
  };
}

export async function observePlanActValidate({
  page,
  instruction,
  planner,
  validator,
  maxSteps = 25,
}) {
  return runMicroStepLoop({
    page,
    instruction,
    planner,
    validator,
    maxSteps,
    waitOptions: {
      networkIdleTimeout: 1500,
      settleDelayMs: 700,
    },
  });
}