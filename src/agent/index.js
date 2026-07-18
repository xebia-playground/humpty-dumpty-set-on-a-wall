import { pathToFileURL } from 'node:url';

import { generateTestsFromSnapshot, inspectLiveApp, runGeneratedTests } from './flow-runner.js';

if (isMainModule()) {
	try {
		const command = process.argv[2] || 'generate';

		if (command === 'inspect') {
			await inspectLiveApp();
		} else if (command === 'generate') {
			await generateTestsFromSnapshot();
		} else if (command === 'run-tests') {
			await runGeneratedTests();
		} else {
			throw new Error(`Unknown agent command: ${command}`);
		}
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

function isMainModule() {
	return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}