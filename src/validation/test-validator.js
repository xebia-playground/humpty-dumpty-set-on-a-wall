import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ALLOWED_IMPORTS = new Set(['@playwright/test']);
const FORBIDDEN_PATTERNS = [
	[/\b(?:require|eval)\s*\(/, 'CommonJS require() and eval() are not allowed in generated tests.'],
	[/\bFunction\s*\(/, 'Function constructor is not allowed in generated tests.'],
	[/\bimport\s*\(/, 'Dynamic import() is not allowed in generated tests.'],
	[/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'Direct network calls are not allowed in generated tests.'],
	[/\bprocess\s*\[/, 'Dynamic process access is not allowed in generated tests.'],
	[/\bglobalThis\.process\b|\bglobal\.process\b/, 'Global process access is not allowed in generated tests.'],
	[/\bpage\.waitForTimeout\s*\(/, 'Fixed waits are not allowed in generated tests. Use web-first Playwright assertions instead.'],
];
const NON_JAVASCRIPT_OUTPUT_PATTERNS = [
	[/^\s*(?:\u25cf|\u2502|\u2514)/u, 'Copilot CLI returned shell suggestion UI output instead of JavaScript.'],
	[/\bnoop\s*\(shell\)/i, 'Copilot CLI returned a shell noop suggestion instead of JavaScript.'],
	[/^\s*echo\s+done\s*$/im, 'Copilot CLI returned a shell command instead of JavaScript.'],
];

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

export async function validateGeneratedTestSyntax(content, { tempDir = process.cwd(), targetUrl = process.env.TARGET_URL || 'http://localhost:3000' } = {}) {
	const syntaxCheckFile = path.join(tempDir, `.ai-generated-syntax-check-${process.pid}.mjs`);

	try {
		await fs.writeFile(syntaxCheckFile, content, 'utf8');
		await runCommand('node', ['--check', syntaxCheckFile], 'Generated Playwright test is not valid JavaScript.', targetUrl);
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

async function runCommand(command, args, failureMessage, targetUrl) {
	try {
		return await execFileAsync(command, args, {
			env: {
				...process.env,
				TARGET_URL: targetUrl,
			},
			maxBuffer: 1024 * 1024 * 10,
		});
	} catch (error) {
		const details = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
		throw new Error(details ? `${failureMessage}\n${details}` : failureMessage);
	}
}