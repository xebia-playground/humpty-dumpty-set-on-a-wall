import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';

const allowlistPath = requireEnv('ALLOWLIST_PATH');
const port = Number.parseInt(process.env.PROXY_PORT || '8080', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PROXY_PORT must be a valid TCP port.');
}

const allowedHosts = await loadAllowedHosts(allowlistPath);

const server = http.createServer((request, response) => {
  handleHttpRequest(request, response).catch((error) => {
    response.writeHead(502, { 'content-type': 'text/plain' });
    response.end(`${error.message}\n`);
  });
});

server.on('connect', (request, clientSocket, head) => {
  const { hostname, port: targetPort } = parseConnectTarget(request.url || '');

  if (!isAllowedHost(hostname)) {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\nDomain not allowed\n');
    return;
  }

  const upstreamSocket = net.connect(targetPort, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on('error', () => {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain\r\n\r\nUpstream connection failed\n');
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Allowlist proxy listening on port ${port}`);
});

async function handleHttpRequest(request, response) {
  const targetUrl = new URL(request.url || '', `http://${request.headers.host || ''}`);
  const hostname = normalizeHostname(targetUrl.hostname);

  if (!isAllowedHost(hostname)) {
    response.writeHead(403, { 'content-type': 'text/plain' });
    response.end('Domain not allowed\n');
    return;
  }

  const proxyRequest = http.request(
    {
      hostname,
      port: targetUrl.port || 80,
      method: request.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: {
        ...request.headers,
        host: targetUrl.host,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'text/plain' });
    response.end(`${error.message}\n`);
  });

  request.pipe(proxyRequest);
}

async function loadAllowedHosts(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const hosts = new Set();

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) {
      continue;
    }

    if (line.includes('*') || line.includes('/')) {
      throw new Error(`Invalid allowlist entry on line ${index + 1}: wildcards and CIDR ranges are not supported.`);
    }

    hosts.add(normalizeHostname(line));
  }

  if (hosts.size === 0) {
    throw new Error('Allowlist file must contain at least one domain or IP address.');
  }

  return hosts;
}

function parseConnectTarget(target) {
  const [rawHostname, rawPort] = target.split(':');
  const targetPort = Number.parseInt(rawPort || '443', 10);

  if (!rawHostname || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    throw new Error(`Invalid CONNECT target: ${target}`);
  }

  return {
    hostname: normalizeHostname(rawHostname),
    port: targetPort,
  };
}

function isAllowedHost(hostname) {
  return allowedHosts.has(normalizeHostname(hostname));
}

function normalizeHostname(hostname) {
  return hostname.trim().replace(/\.$/, '').toLowerCase();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}