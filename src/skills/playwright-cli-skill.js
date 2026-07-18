import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

import { createAppSnapshot } from '../context/app-snapshot.js';

const execFileAsync = promisify(execFile);

export async function inspectApplication({ targetUrl }) {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();

	try {
		await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
		return await createAppSnapshot(page, targetUrl);
	} catch (error) {
		throw new Error(`Playwright could not inspect the target application at ${targetUrl}. ${error.message}`);
	} finally {
		await browser.close();
	}
}

export async function runGeneratedPlaywrightTest({ configPath, generatedTestFile, outputDir, project, targetUrl }) {
	await runCommand('npx', [
		'playwright',
		'test',
		generatedTestFile,
		'--project',
		project,
		'--config',
		configPath,
		'--reporter=line,html',
		'--output',
		outputDir,
	], 'Generated Playwright tests failed.', targetUrl);
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