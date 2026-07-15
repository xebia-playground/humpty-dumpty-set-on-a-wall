import fs from 'node:fs/promises';
import path from 'node:path';

const workspacePath = process.env.TARGET_WORKSPACE || process.cwd();
const actionPath = process.env.GITHUB_ACTION_PATH || process.cwd();
const configInput = process.env.PLAYWRIGHT_CONFIG || '';
const generatedTestsDirInput = process.env.GENERATED_TESTS_DIR_INPUT || '';
const githubEnvPath = process.env.GITHUB_ENV;

try {
  const metadata = await resolvePlaywrightConfigMetadata({
    actionPath,
    configInput,
    generatedTestsDirInput,
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

export async function resolvePlaywrightConfigMetadata({ actionPath, configInput, generatedTestsDirInput = '', workspacePath }) {
  const allowedRoot = configInput ? workspacePath : actionPath;
  const configPath = configInput
    ? resolveInputPathInside(workspacePath, configInput, 'playwright-config')
    : path.resolve(actionPath, 'playwright.config.js');

  const generatedTestsDir = resolveGeneratedTestsDir({
    actionPath,
    configInput,
    generatedTestsDirInput,
    workspacePath,
  });
  assertPathInside(allowedRoot, generatedTestsDir, 'generated tests directory');
  const generatedTestFile = path.join(generatedTestsDir, 'ai-generated.spec.js');
  const outputDir = path.join(allowedRoot, 'test-results');
  const htmlReportDir = path.join(allowedRoot, 'playwright-report');

  return {
    GENERATED_TEST_FILE: generatedTestFile,
    GENERATED_TESTS_DIR: generatedTestsDir,
    PLAYWRIGHT_CONFIG_PATH: configPath,
    PLAYWRIGHT_HTML_REPORT_DIR: htmlReportDir,
    PLAYWRIGHT_OUTPUT_DIR: outputDir,
  };
}

function resolveGeneratedTestsDir({ actionPath, configInput, generatedTestsDirInput, workspacePath }) {
  if (generatedTestsDirInput) {
    return resolveInputPathInside(workspacePath, generatedTestsDirInput, 'generated-tests-dir');
  }

  if (configInput) {
    return path.resolve(workspacePath, 'tests', 'generated-tests');
  }

  return path.resolve(actionPath, 'src', 'tests', 'generated-tests');
}

function resolveInputPathInside(rootPath, inputPath, label) {
  if (path.isAbsolute(inputPath)) {
    throw new Error(`${label} must be a relative path inside the caller workspace.`);
  }

  return assertPathInside(rootPath, path.resolve(rootPath, inputPath), label);
}

function assertPathInside(rootPath, targetPath, label) {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return targetPath;
  }

  throw new Error(`${label} resolves outside the allowed workspace.`);
}

async function appendGithubEnv(githubEnvPath, metadata) {
  const entries = Object.entries(metadata).map(([key, value]) => `${key}=${value}`);
  await fs.appendFile(githubEnvPath, `${entries.join('\n')}\n`, 'utf8');
}