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
			console.debug(`Captured snapshot for route: ${currentUrl} with ${snapshot.links.length} links and ${snapshot.forms.length} forms.`);
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

function parseActionPayload(rawAction) {
  if (!rawAction) return null;

  if (typeof rawAction === 'object') return rawAction;

  if (typeof rawAction === 'string') {
    const match = rawAction.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return null;
    }
  }

  return null;
}

function buildLocator(page, payload) {
  const { locator, role, name, placeholder, text, label, selector, id, value, index = 0 } = payload;

  if (locator === 'role') {
    if (role && name) {
      return page.getByRole(role, { name: new RegExp(String(name), 'i') });
    }
    if (role) return page.getByRole(role);
  }

  if (locator === 'placeholder' && placeholder) {
    return page.getByPlaceholder(placeholder);
  }

  if (locator === 'text' && text) {
    return page.getByText(new RegExp(String(text), 'i'), { exact: false });
  }

  if (locator === 'label' && label) {
    return page.getByLabel(label);
  }

  if (locator === 'id' && id) {
    return page.locator(`#${CSS.escape(id)}`);
  }

  if (selector) {
    return page.locator(selector).nth(index);
  }

  if (value) {
    return page.locator(`input[value="${value}"]`);
  }

  return page.locator('body').nth(0);
}

export async function executePlaywrightAction(page, rawAction) {
  const payload = parseActionPayload(rawAction);

  if (!payload || !payload.action) {
    throw new Error(`Invalid structured action payload: ${JSON.stringify(rawAction)}`);
  }

  const { action, ...locatorProps } = payload;
  const locator = buildLocator(page, locatorProps);

  switch (action) {
    case 'click': {
      await locator.click({ timeout: 10000 });
      return { ok: true, action };
    }

    case 'fill': {
      if (!locatorProps.value) throw new Error('Fill action requires value');
      await locator.fill(String(locatorProps.value), { timeout: 10000 });
      return { ok: true, action };
    }

    case 'type': {
      if (!locatorProps.value) throw new Error('Type action requires value');
      await locator.type(String(locatorProps.value), { timeout: 10000 });
      return { ok: true, action };
    }

    case 'press': {
      await locator.press(locatorProps.key || 'Enter', { timeout: 10000 });
      return { ok: true, action };
    }

    case 'check': {
      await locator.check({ timeout: 10000 });
      return { ok: true, action };
    }

    case 'uncheck': {
      await locator.uncheck({ timeout: 10000 });
      return { ok: true, action };
    }

    case 'hover': {
      await locator.hover({ timeout: 10000 });
      return { ok: true, action };
    }

    case 'goto': {
      await page.goto(locatorProps.url || '/', { waitUntil: 'networkidle' });
      return { ok: true, action };
    }

    case 'waitForVisible': {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
      return { ok: true, action };
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

export async function runStructuredAction(page, actionText) {
  const payload = parseActionPayload(actionText);
  if (!payload) {
    throw new Error(
      'Expected structured JSON like: {"action":"click","locator":"role","role":"button","name":"Checkout"}'
    );
  }

  return executePlaywrightAction(page, payload);
}