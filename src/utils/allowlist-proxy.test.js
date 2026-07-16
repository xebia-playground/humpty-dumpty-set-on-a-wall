import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('allowlist proxy forwards allowed hosts and blocks others', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'allowlist-proxy-test-'));
  const allowlistPath = path.join(temporaryDirectory, 'allowlist.txt');
  await fs.writeFile(allowlistPath, '127.0.0.1\n', 'utf8');

  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(`allowed ${request.url}`);
  });

  await listen(upstream, '127.0.0.1', 0);
  const upstreamPort = upstream.address().port;
  const proxyPort = await getFreePort();
  const proxyProcess = spawn(process.execPath, ['src/utils/allowlist-proxy.js'], {
    env: {
      ...process.env,
      ALLOWLIST_PATH: allowlistPath,
      PROXY_PORT: String(proxyPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForProxy(proxyProcess);

    const allowedResponse = await proxyRequest(proxyPort, `http://127.0.0.1:${upstreamPort}/products`);
    assert.equal(allowedResponse.statusCode, 200);
    assert.match(allowedResponse.body, /allowed \/products/);

    const blockedResponse = await proxyRequest(proxyPort, 'http://blocked.example/products');
    assert.equal(blockedResponse.statusCode, 403);
    assert.match(blockedResponse.body, /Domain not allowed/);
  } finally {
    proxyProcess.kill('SIGTERM');
    upstream.close();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function proxyRequest(proxyPort, targetUrl) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: targetUrl,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, body });
        });
      },
    );

    request.on('error', reject);
    request.end();
  });
}

function waitForProxy(proxyProcess) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Allowlist proxy did not start. ${stderr}`));
    }, 5000);

    proxyProcess.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Allowlist proxy listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proxyProcess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proxyProcess.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Allowlist proxy exited early with code ${code}. ${stderr}`));
    });
  });
}

async function getFreePort() {
  const server = http.createServer();
  await listen(server, '127.0.0.1', 0);
  const { port } = server.address();
  server.close();
  return port;
}

function listen(server, hostname, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, resolve);
  });
}