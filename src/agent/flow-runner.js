import fs from 'node:fs/promises';
import path from 'node:path';

import { loadTestingInstructions } from '../context/instruction-loader.js';
import { generatePlaywrightSpecWithCopilot } from '../skills/copilot-cli-skill.js';
import { inspectApplication, runGeneratedPlaywrightTest } from '../skills/playwright-cli-skill.js';
import { normalizeGeneratedTest, validateGeneratedTestSyntax } from '../validation/test-validator.js';

export async function inspectLiveApp(env = process.env) {
	const targetUrl = requireEnv(env, 'TARGET_URL');
	const snapshotFile = requireEnv(env, 'APP_SNAPSHOT_FILE');
	await loadTestingInstructions({
		instructionPath: env.TESTING_INSTRUCTIONS_PATH || '.github/testing_instructions.md',
		workspacePath: env.TARGET_WORKSPACE || process.cwd(),
	});
	const appSnapshot = await inspectApplication({ targetUrl });

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
	const generatedSpec = await generatePlaywrightSpecWithCopilot({
		appSnapshot,
		instructions,
		targetUrl,
	});
	const normalizedSpec = normalizeGeneratedTest(generatedSpec);

	await fs.mkdir(path.dirname(outputFile), { recursive: true });
	await validateGeneratedTestSyntax(normalizedSpec, {
		tempDir: path.dirname(outputFile),
		targetUrl,
	});
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