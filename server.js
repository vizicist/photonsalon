const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 8080);
const publicDir = path.join(__dirname, 'public');
const nodeModulesDir = path.join(__dirname, 'node_modules');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/config.js') {
      serveConfig(res);
      return;
    }

    serveStatic(url.pathname, res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err.message);
  }
});

server.listen(port, () => {
  console.log(`Photon Salon remote: http://127.0.0.1:${port}/`);
  console.log(`NATS_URL: ${process.env.NATS_URL || '(not set)'}`);
});

function serveConfig(res) {
  const config = [
    `window.NATS_URL = ${JSON.stringify(process.env.NATS_URL || '')};`,
    `window.PHOTON_SALON_HOST = ${JSON.stringify(process.env.PHOTON_SALON_HOST || 'photonsalon')};`
  ].join('\n');

  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(config);
}

function serveStatic(requestPath, res) {
  let root = publicDir;
  let pathname = requestPath === '/' ? '/index.html' : requestPath;

  if (pathname.startsWith('/node_modules/')) {
    root = nodeModulesDir;
    pathname = pathname.slice('/node_modules'.length);
  }

  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}
