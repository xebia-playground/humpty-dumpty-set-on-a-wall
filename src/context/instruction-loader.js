import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadTestingInstructions({ instructionPath, workspacePath }) {
	const resolvedPath = resolveInputPathInside(workspacePath, instructionPath, 'testing instructions path');
	const content = await readOptionalFile(resolvedPath);

	return {
		hasCustomInstructions: content.trim().length > 0,
		path: instructionPath,
		text: content.trim(),
	};
}

function resolveInputPathInside(rootPath, inputPath, label) {
	if (path.isAbsolute(inputPath)) {
		throw new Error(`${label} must be a relative path inside the caller workspace.`);
	}

	const targetPath = path.resolve(rootPath, inputPath);
	const relativePath = path.relative(rootPath, targetPath);
	if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
		return targetPath;
	}

	throw new Error(`${label} resolves outside the caller workspace.`);
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