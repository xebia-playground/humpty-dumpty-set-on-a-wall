import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'script-generator-test-'));
process.env.TARGET_URL = 'http://example.test';
process.env.GENERATED_TESTS_DIR = temporaryDirectory;

const { normalizeGeneratedTest, validateGeneratedTestSyntax } = await import('./script-generator.js');

test.after(async () => {
	await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test('rejects Copilot shell suggestion output', () => {
	assert.throws(
		() => normalizeGeneratedTest("● noop (shell)\n  │ echo done\n  └ 2 lines…\n\nimport { test, expect } from '@playwright/test';"),
		/Expected raw JavaScript Playwright test code/,
	);
});

test('requires a Playwright test import and test block', () => {
	assert.throws(
		() => normalizeGeneratedTest("import { expect } from '@playwright/test';\n"),
		/Expected an ES module import from @playwright\/test/,
	);

	assert.throws(
		() => normalizeGeneratedTest("import { test, expect } from '@playwright/test';\nconst value = 1;"),
		/Expected at least one test\(\.\.\.\) block/,
	);
});

test('accepts and syntax-checks valid generated Playwright code', async () => {
	const normalizedTest = normalizeGeneratedTest(`import { test, expect } from '@playwright/test';

test('loads page', async ({ page }) => {
	await page.goto(process.env.TARGET_URL);
	await expect(page).toHaveURL(/example/);
});`);

	assert.match(normalizedTest, /import \{ test, expect \} from '@playwright\/test';/);
	await validateGeneratedTestSyntax(normalizedTest);
});