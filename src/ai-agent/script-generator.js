import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createProjectContext } from './planner.js';

const execFileAsync = promisify(execFile);

const targetUrl = requireEnv('TARGET_URL');
const targetWorkspace = process.env.TARGET_WORKSPACE || process.cwd();
const testingInstructionsPath = process.env.TESTING_INSTRUCTIONS_PATH || '.github/testing_instructions.md';
const outputDir = path.resolve(process.env.GENERATED_TESTS_DIR || path.join(process.cwd(), 'src/tests/generated-tests'));
const outputFile = path.join(outputDir, 'ai-generated.spec.js');

const ALLOWED_IMPORTS = new Set(['@playwright/test']);
const FORBIDDEN_PATTERNS = [
	[/\b(?:require|eval)\s*\(/, 'CommonJS require() and eval() are not allowed in generated tests.'],
	[/\bFunction\s*\(/, 'Function constructor is not allowed in generated tests.'],
	[/\bimport\s*\(/, 'Dynamic import() is not allowed in generated tests.'],
	[/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'Direct network calls are not allowed in generated tests.'],
	[/\bprocess\s*\[/, 'Dynamic process access is not allowed in generated tests.'],
	[/\bglobalThis\.process\b|\bglobal\.process\b/, 'Global process access is not allowed in generated tests.'],
];
const NON_JAVASCRIPT_OUTPUT_PATTERNS = [
	[/^\s*(?:\u25cf|\u2502|\u2514)/u, 'Copilot CLI returned shell suggestion UI output instead of JavaScript.'],
	[/\bnoop\s*\(shell\)/i, 'Copilot CLI returned a shell noop suggestion instead of JavaScript.'],
	[/^\s*echo\s+done\s*$/im, 'Copilot CLI returned a shell command instead of JavaScript.'],
];

if (isMainModule()) {
	try {
		await main();
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

async function main() {
	await assertCopilotCliAccess();

	const projectContext = await createProjectContext(targetWorkspace, testingInstructionsPath);
	const prompt = buildPrompt(projectContext);
	const generatedTest = await generateWithCopilotCli(prompt);
	const normalizedGeneratedTest = normalizeGeneratedTest(generatedTest);

	await fs.mkdir(outputDir, { recursive: true });
	await validateGeneratedTestSyntax(normalizedGeneratedTest);
	await fs.writeFile(outputFile, normalizedGeneratedTest, 'utf8');

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
- The first non-comment code line must be: import { test, expect } from '@playwright/test'.
- Include at least one Playwright test(...) block.
- Do not use require() or CommonJS syntax.
- Use process.env.TARGET_URL as the base URL.
- Do not use external services.
- Do not return shell commands, terminal instructions, or Copilot suggestion UI output.
- Keep tests resilient and based on visible user behavior.
- Return only valid JavaScript test code.
- Save no files and do not include markdown fences.

Target URL: ${targetUrl}

Testing instructions:
${instructionText}

Application context:
${fileContext}`;
}

export function normalizeGeneratedTest(content) {
	const trimmedContent = convertCommonJsPlaywrightImport(content.trim());

	rejectNonJavaScriptOutput(trimmedContent);

	if (!hasPlaywrightTestImport(trimmedContent)) {
		throw new Error('Copilot CLI did not return a valid Playwright test file. Expected an ES module import from @playwright/test.');
	}

	if (!hasPlaywrightTestBlock(trimmedContent)) {
		throw new Error('Copilot CLI did not return a valid Playwright test file. Expected at least one test(...) block.');
	}

	validateGeneratedTestSecurity(trimmedContent);

	return `${trimmedContent}\n`;
}

export async function validateGeneratedTestSyntax(content) {
	const syntaxCheckFile = path.join(outputDir, `.ai-generated-syntax-check-${process.pid}.mjs`);

	try {
		await fs.writeFile(syntaxCheckFile, content, 'utf8');
		await runCommand('node', ['--check', syntaxCheckFile], 'Generated Playwright test is not valid JavaScript.');
	} finally {
		await fs.rm(syntaxCheckFile, { force: true });
	}
}

function rejectNonJavaScriptOutput(content) {
	const firstCodeLine = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith('//'));

	for (const [pattern, message] of NON_JAVASCRIPT_OUTPUT_PATTERNS) {
		if (pattern.test(content) || (firstCodeLine && pattern.test(firstCodeLine))) {
			throw new Error(`${message} Expected raw JavaScript Playwright test code.`);
		}
	}

	if (firstCodeLine && !firstCodeLine.startsWith('import ')) {
		throw new Error('Copilot CLI did not return raw JavaScript. The first non-comment code line must be an ES module import.');
	}
}

function hasPlaywrightTestImport(content) {
	return /^\s*import\s*\{(?=[^}]*\btest\b)(?=[^}]*\bexpect\b)[^}]+\}\s*from\s*['"]@playwright\/test['"];?/m.test(content);
}

function hasPlaywrightTestBlock(content) {
	return /\btest(?:\.(?:only|skip|fixme))?\s*\(/.test(content);
}

function validateGeneratedTestSecurity(content) {
	for (const importSource of findModuleSources(content)) {
		if (!ALLOWED_IMPORTS.has(importSource)) {
			throw new Error(`Generated test imports disallowed module: ${importSource}`);
		}
	}

	for (const [pattern, message] of FORBIDDEN_PATTERNS) {
		if (pattern.test(content)) {
			throw new Error(message);
		}
	}

	const contentWithoutAllowedTargetUrl = content.replace(/process\.env\.TARGET_URL/g, '');
	if (/\bprocess\s*(?:\.|\?\.)\s*env\b/.test(contentWithoutAllowedTargetUrl)) {
		throw new Error('Generated tests may only read process.env.TARGET_URL.');
	}
}

function findModuleSources(content) {
	const sources = [];
	const modulePattern = /^\s*(?:import\s*(?:[^'";]+?\s*from\s*)?|export\s+[^'";]+?\s*from\s*)['"]([^'"]+)['"]/gm;
	let match;

	while ((match = modulePattern.exec(content))) {
		sources.push(match[1]);
	}

	return sources;
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

function isMainModule() {
	return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

