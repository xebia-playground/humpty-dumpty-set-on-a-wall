import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { formatAppSnapshot } from '../context/app-snapshot.js';

const execFileAsync = promisify(execFile);

export async function generatePlaywrightSpecWithCopilot({ appSnapshot, instructions, targetUrl }) {
	await assertCopilotCliAccess(targetUrl);

	const prompt = buildPrompt({ appSnapshot, instructions, targetUrl });
	const { stdout } = await runCopilotSuggest(prompt, 'Copilot CLI failed to generate a Playwright test.', targetUrl);

	return extractCodeBlock(stdout) || stdout;
}

async function assertCopilotCliAccess(targetUrl) {
	await runCommand('gh', ['--version'], 'GitHub CLI is required to run Copilot CLI.', targetUrl);
	await runCommand('gh', ['auth', 'status'], 'GitHub authentication is required to check Copilot access.', targetUrl);
	await runCopilotSuggest(
		'echo Copilot access check',
		'Copilot CLI access is required. No valid Copilot license or permission was found for this workflow context.',
		targetUrl,
	);
}

async function runCopilotSuggest(prompt, failureMessage, targetUrl) {
	let lastError;

	for (const args of createCopilotSuggestArgs(prompt)) {
		try {
			return await runCommand('gh', args, failureMessage, targetUrl);
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

async function runCommand(command, args, failureMessage, targetUrl) {
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

function buildPrompt({ appSnapshot, instructions, targetUrl }) {
	const instructionText = instructions.hasCustomInstructions
		? instructions.text
		: 'No custom instructions were provided. Generate default ecommerce-style smoke tests from the live page snapshot.';

	return `Generate a complete JavaScript Playwright test file for this application.

Requirements:
- Use @playwright/test.
- Use ES module syntax: import { test, expect } from '@playwright/test'.
- The first non-comment code line must be: import { test, expect } from '@playwright/test'.
- Include at least one Playwright test(...) block.
- Use process.env.TARGET_URL as the base URL.
- Prefer role-based selectors from the observed UI snapshot.
- Do not use fixed waits such as page.waitForTimeout().
- Do not use external services or real payment gateways.
- Do not return shell commands, terminal instructions, or Copilot suggestion UI output.
- Return only valid JavaScript test code.
- Save no files and do not include markdown fences.

Target URL: ${targetUrl}

Testing instructions from ${instructions.path}:
${instructionText}

Observed application snapshot from Playwright:
${formatAppSnapshot(appSnapshot)}`;
}

function extractCodeBlock(content) {
	const match = content.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
	return match?.[1]?.trim();
}