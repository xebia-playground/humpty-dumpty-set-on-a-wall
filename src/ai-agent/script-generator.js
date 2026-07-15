import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { createProjectContext } from './planner.js';

const execFileAsync = promisify(execFile);

const targetUrl = requireEnv('TARGET_URL');
const targetWorkspace = process.env.TARGET_WORKSPACE || process.cwd();
const testingInstructionsPath = process.env.TESTING_INSTRUCTIONS_PATH || '.github/testing_instructions.md';
const outputDir = path.resolve(process.env.GENERATED_TESTS_DIR || path.join(process.cwd(), 'src/tests/generated-tests'));
const outputFile = path.join(outputDir, 'ai-generated.spec.js');

try {
	await main();
} catch (error) {
	console.error(`Error: ${error.message}`);
	process.exit(1);
}

async function main() {
	await assertCopilotCliAccess();

	const projectContext = await createProjectContext(targetWorkspace, testingInstructionsPath);
	const prompt = buildPrompt(projectContext);
	const generatedTest = await generateWithCopilotCli(prompt);

	await fs.mkdir(outputDir, { recursive: true });
	await fs.writeFile(outputFile, normalizeGeneratedTest(generatedTest), 'utf8');

	console.log(`Generated Playwright test: ${path.relative(process.cwd(), outputFile)}`);
}

async function assertCopilotCliAccess() {
	await runCommand('gh', ['--version'], 'GitHub CLI is required to run Copilot CLI.');
	await runCommand('gh', ['auth', 'status'], 'GitHub authentication is required to check Copilot access.');
	await runCopilotSuggest(
		'echo Copilot access check',
		'Copilot CLI access is required. No valid Copilot license or permission was found for this workflow context.',
	);
}

async function generateWithCopilotCli(prompt) {
	const { stdout } = await runCopilotSuggest(prompt, 'Copilot CLI failed to generate a Playwright test.');

	return extractCodeBlock(stdout) || stdout;
}

async function runCopilotSuggest(prompt, failureMessage) {
	let lastError;

	for (const args of createCopilotSuggestArgs(prompt)) {
		try {
			return await runCommand('gh', args, failureMessage);
		} catch (error) {
			lastError = error;

			if (!isCopilotCommandFormatError(error.message)) {
				throw error;
			}
		}
	}

	throw lastError;
}

function createCopilotSuggestArgs(prompt) {
	return [
		['copilot', '--prompt', `suggest ${prompt} --agent shell`],
		['copilot', '-p', `suggest ${prompt} --agent shell`],
		['copilot', 'suggest', prompt, '--agent', 'shell'],
		['copilot', 'suggest', prompt, '--target', 'shell'],
	];
}

function isCopilotCommandFormatError(message) {
	return /Invalid command format|unknown option|unknown command|Did you mean|--target|--agent/i.test(message);
}

async function runCommand(command, args, failureMessage) {
	try {
		return await execFileAsync(command, args, {
			env: {
				...process.env,
				GH_PROMPT_DISABLED: '1',
				TARGET_URL: targetUrl,
			},
			maxBuffer: 1024 * 1024 * 10,
		});
	} catch (error) {
		const details = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
		throw new Error(details ? `${failureMessage}\n${details}` : failureMessage);
	}
}

function buildPrompt(projectContext) {
	const instructionText = projectContext.hasCustomInstructions
		? projectContext.instructions
		: 'No custom instructions were provided. Generate default happy-path tests based on the application context.';

	const fileContext = projectContext.files
		.map((file) => `File: ${file.path}\n${file.preview}`)
		.join('\n\n---\n\n');

	return `Generate a complete JavaScript Playwright test file for this React application.

Requirements:
- Use @playwright/test.
- Use ES module syntax: import { test, expect } from '@playwright/test'.
- Do not use require() or CommonJS syntax.
- Use process.env.TARGET_URL as the base URL.
- Do not use external services.
- Keep tests resilient and based on visible user behavior.
- Return only valid JavaScript test code.
- Save no files and do not include markdown fences.

Target URL: ${targetUrl}

Testing instructions:
${instructionText}

Application context:
${fileContext}`;
}

function normalizeGeneratedTest(content) {
	const trimmedContent = convertCommonJsPlaywrightImport(content.trim());

	if (!trimmedContent.includes('@playwright/test')) {
		throw new Error('Copilot CLI did not return a valid Playwright test file.');
	}

	if (/\brequire\s*\(/.test(trimmedContent)) {
		throw new Error('Copilot CLI returned CommonJS code. Generated tests must use ES module imports.');
	}

	return `${trimmedContent}\n`;
}

function convertCommonJsPlaywrightImport(content) {
	return content.replace(
		/const\s+\{\s*test\s*,\s*expect\s*\}\s*=\s*require\(['"]@playwright\/test['"]\);?/,
		"import { test, expect } from '@playwright/test';",
	);
}

function extractCodeBlock(content) {
	const match = content.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
	return match?.[1]?.trim();
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}

