import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_IGNORE_DIRS = new Set([
	'.git',
	'node_modules',
	'dist',
	'build',
	'coverage',
	'playwright-report',
	'test-results',
]);

const RELEVANT_EXTENSIONS = new Set([
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.json',
	'.html',
	'.css',
	'.md',
]);

export async function createProjectContext(workspacePath, instructionPath) {
	const files = await collectRelevantFiles(workspacePath);
	const instructions = await readOptionalFile(path.resolve(workspacePath, instructionPath));

	return {
		workspacePath,
		instructionPath,
		hasCustomInstructions: instructions.trim().length > 0,
		instructions: instructions.trim(),
		files,
	};
}

async function collectRelevantFiles(workspacePath) {
	const files = [];
	await walk(workspacePath, workspacePath, files);
	return files.sort((first, second) => first.path.localeCompare(second.path));
}

async function walk(rootPath, currentPath, files) {
	const entries = await fs.readdir(currentPath, { withFileTypes: true });

	for (const entry of entries) {
		const absolutePath = path.join(currentPath, entry.name);
		const relativePath = path.relative(rootPath, absolutePath);

		if (entry.isDirectory()) {
			if (!DEFAULT_IGNORE_DIRS.has(entry.name)) {
				await walk(rootPath, absolutePath, files);
			}
			continue;
		}

		if (!entry.isFile() || !RELEVANT_EXTENSIONS.has(path.extname(entry.name))) {
			continue;
		}

		const content = await readOptionalFile(absolutePath);
		files.push({
			path: relativePath,
			preview: content.slice(0, 4000),
		});
	}
}

async function readOptionalFile(filePath) {
	try {
		return await fs.readFile(filePath, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') {
			return '';
		}
		throw error;
	}
}

