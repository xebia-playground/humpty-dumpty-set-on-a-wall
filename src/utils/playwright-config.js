import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspacePath = process.env.TARGET_WORKSPACE || process.cwd();
const actionPath = process.env.GITHUB_ACTION_PATH || process.cwd();
const configInput = process.env.PLAYWRIGHT_CONFIG || '';
const githubEnvPath = process.env.GITHUB_ENV;

try {
  const metadata = await resolvePlaywrightConfigMetadata({
    actionPath,
    configInput,
    workspacePath,
  });

  if (githubEnvPath) {
    await appendGithubEnv(githubEnvPath, metadata);
  } else {
    console.log(JSON.stringify(metadata, null, 2));
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

export async function resolvePlaywrightConfigMetadata({ actionPath, configInput, workspacePath }) {
  const configPath = configInput
    ? path.resolve(workspacePath, configInput)
    : path.resolve(actionPath, 'playwright.config.js');
  const configDir = path.dirname(configPath);
  const config = await loadConfig(configPath);

  const testDir = resolveFromConfigDir(configDir, config.testDir || 'tests');
  const outputDir = resolveFromConfigDir(configDir, config.outputDir || 'test-results');
  const htmlReportDir = resolveFromConfigDir(configDir, findHtmlReportDir(config.reporter) || 'playwright-report');
  const generatedTestsDir = path.join(testDir, 'generated-tests');

  return {
    GENERATED_TESTS_DIR: generatedTestsDir,
    PLAYWRIGHT_CONFIG_PATH: configPath,
    PLAYWRIGHT_HTML_REPORT_DIR: htmlReportDir,
    PLAYWRIGHT_OUTPUT_DIR: outputDir,
  };
}

async function loadConfig(configPath) {
  await fs.access(configPath);
  const importedConfig = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
  return importedConfig.default || importedConfig;
}

function findHtmlReportDir(reporter) {
  if (!reporter) {
    return undefined;
  }

  if (reporter === 'html') {
    return undefined;
  }

  const reporters = Array.isArray(reporter) && Array.isArray(reporter[0]) ? reporter : [reporter];

  for (const reporterEntry of reporters) {
    if (reporterEntry === 'html') {
      return undefined;
    }

    if (!Array.isArray(reporterEntry)) {
      continue;
    }

    const [name, options] = reporterEntry;
    if (name === 'html' && options?.outputFolder) {
      return options.outputFolder;
    }
  }

  return undefined;
}

function resolveFromConfigDir(configDir, targetPath) {
  return path.resolve(configDir, targetPath);
}

async function appendGithubEnv(githubEnvPath, metadata) {
  const entries = Object.entries(metadata).map(([key, value]) => `${key}=${value}`);
  await fs.appendFile(githubEnvPath, `${entries.join('\n')}\n`, 'utf8');
}