import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

import { createAppSnapshot } from '../context/app-snapshot.js';

const execFileAsync = promisify(execFile);
const SKIPPED_PROTOCOLS = new Set(['javascript:', 'mailto:', 'tel:', 'sms:']);

export async function inspectApplication({ targetUrl, snapshotOptions = {} }) {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();

	try {
		const origin = new URL(targetUrl).origin;
		const pendingUrls = [normalizeUrl(targetUrl)];
		const visitedUrls = new Set();
		const routeSnapshots = [];

		while (pendingUrls.length > 0) {
			const currentUrl = pendingUrls.shift();
			if (visitedUrls.has(currentUrl)) {
				continue;
			}

			visitedUrls.add(currentUrl);
			await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

			const snapshot = await createAppSnapshot(page, currentUrl, snapshotOptions);
			routeSnapshots.push(snapshot);

			for (const linkedUrl of await collectInternalLinks(page, origin)) {
				if (!visitedUrls.has(linkedUrl) && !pendingUrls.includes(linkedUrl)) {
					pendingUrls.push(linkedUrl);
				}
			}
		}

		return {
			url: normalizeUrl(targetUrl),
			routes: routeSnapshots,
		};
	} catch (error) {
		throw new Error(`Playwright could not inspect the target application at ${targetUrl}. ${error.message}`);
	} finally {
		await browser.close();
	}
}

async function collectInternalLinks(page, origin) {
	return page.evaluate(({ appOrigin, skippedProtocols }) => {
		const skippedProtocolSet = new Set(skippedProtocols);
		return Array.from(document.querySelectorAll('a[href]'))
			.map((anchor) => anchor.getAttribute('href'))
			.filter(Boolean)
			.map((href) => {
				try {
					const url = new URL(href, window.location.href);
					if (skippedProtocolSet.has(url.protocol) || url.origin !== appOrigin) {
						return '';
					}

					url.hash = '';
					return url.toString();
				} catch {
					return '';
				}
			})
			.filter(Boolean);
	}, {
		appOrigin: origin,
		skippedProtocols: Array.from(SKIPPED_PROTOCOLS),
	});
}

function normalizeUrl(value) {
	const url = new URL(value);
	url.hash = '';
	return url.toString();
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