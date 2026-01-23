import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const certDir = path.resolve(fileURLToPath(new URL("./certs", import.meta.url)));

const keyPath = process.env.DEMO_TLS_KEY ?? path.join(certDir, "localhost-key.pem");
const certPath = process.env.DEMO_TLS_CERT ?? path.join(certDir, "localhost.pem");
const host = process.env.DEMO_HOST ?? "localhost";
const port = Number(process.env.DEMO_PORT ?? 8443);
const hostForUrl =
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

const missing = [];
if (!fs.existsSync(keyPath)) {
  missing.push(keyPath);
}
if (!fs.existsSync(certPath)) {
  missing.push(certPath);
}

if (missing.length) {
  console.error("HTTPS demo requires a local TLS certificate.");
  console.error("Missing:");
  missing.forEach((filePath) => {
    console.error(`  ${filePath}`);
  });
  console.error("");
  console.error("Generate a local cert with one of the following:");
  console.error(
    "  mkcert -key-file demo/certs/localhost-key.pem -cert-file demo/certs/localhost.pem localhost 127.0.0.1 ::1",
  );
  console.error(
    "  openssl req -x509 -newkey rsa:2048 -nodes -keyout demo/certs/localhost-key.pem -out demo/certs/localhost.pem -days 365 -subj \"/CN=localhost\" -addext \"subjectAltName=DNS:localhost,IP:127.0.0.1\"",
  );
  console.error("");
  console.error("Then run: npm run demo:https");
  process.exit(1);
}

const key = fs.readFileSync(keyPath);
const cert = fs.readFileSync(certPath);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wgsl": "text/plain; charset=utf-8",
};

function sendText(res, status, message, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(message);
}

async function handleRequest(req, res) {
  if (!req.url) {
    sendText(res, 400, "Bad request");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, `https://${hostForUrl}`).pathname;
  } catch (err) {
    sendText(res, 400, "Bad request");
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (err) {
    sendText(res, 400, "Bad request");
    return;
  }

  const resolvedPath = path.resolve(rootDir, `.${decodedPath}`);
  if (!resolvedPath.startsWith(rootDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let filePath = resolvedPath;
  if (decodedPath.endsWith("/")) {
    filePath = path.join(filePath, "index.html");
  }

  let stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch (err) {
    if (!decodedPath.endsWith("/")) {
      try {
        const dirStats = await fs.promises.stat(resolvedPath);
        if (dirStats.isDirectory()) {
          res.writeHead(301, { Location: `${decodedPath}/` });
          res.end();
          return;
        }
      } catch (dirErr) {
        // Ignore and fall through to 404 below.
      }
    }
    sendText(res, 404, "Not found");
    return;
  }

  if (stats.isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = https.createServer({ key, cert }, (req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error(err);
    sendText(res, 500, "Internal server error");
  });
});

server.listen(port, host, () => {
  console.log(`HTTPS demo server running at https://${hostForUrl}:${port}/demo/`);
});
