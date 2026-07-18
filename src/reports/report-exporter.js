import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

if (isMainModule()) {
	try {
		await exportHtmlReport({
			githubOutputPath: process.env.GITHUB_OUTPUT,
			htmlReportDir: process.env.PLAYWRIGHT_HTML_REPORT_DIR,
			reportDirInput: process.env.REPORT_DIR,
			workspacePath: process.env.GITHUB_WORKSPACE || process.cwd(),
		});
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

export async function exportHtmlReport({ githubOutputPath, htmlReportDir, reportDirInput, workspacePath }) {
	if (!htmlReportDir) {
		throw new Error('PLAYWRIGHT_HTML_REPORT_DIR is required.');
	}

	const reportPath = resolveReportPath(workspacePath, reportDirInput || 'ai-testing-report');
	await fs.rm(reportPath, { recursive: true, force: true });
	await fs.mkdir(reportPath, { recursive: true });

	if (await pathExists(htmlReportDir)) {
		await fs.cp(htmlReportDir, reportPath, { recursive: true, force: true });
	}

	if (githubOutputPath) {
		await fs.appendFile(githubOutputPath, `report-path=${reportPath}\n`, 'utf8');
	}

	console.log(`Exported Playwright HTML report: ${reportPath}`);
	return reportPath;
}

function resolveReportPath(workspacePath, reportDirInput) {
	if (!reportDirInput || path.isAbsolute(reportDirInput)) {
		throw new Error('report-dir must be a relative path inside the caller workspace.');
	}

	const reportPath = path.resolve(workspacePath, reportDirInput);
	const relativePath = path.relative(workspacePath, reportPath);
	if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		throw new Error('report-dir resolves outside the caller workspace.');
	}

	return reportPath;
}

async function pathExists(targetPath) {
	try {
		await fs.access(targetPath);
		return true;
	} catch (error) {
		if (error.code === 'ENOENT') {
			return false;
		}
		throw error;
	}
}

function isMainModule() {
	return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}