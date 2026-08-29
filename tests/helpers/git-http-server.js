"use strict";

// A local smart HTTP git server, so clone can be tested against the real
// protocol without touching the network. Requests are handed to git's own
// `git-http-backend` CGI, which is what GitHub-style hosts run behind their
// front end, so the bytes on the wire are genuine.

const http = require("node:http");
const path = require("node:path");
const { fork, spawn, spawnSync } = require("node:child_process");

const { FIXED_IDENTITY } = require("./spawn");

const HTTP_BACKEND = path.join(
  spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim(),
  "git-http-backend",
);

function cgiEnvironment(req, projectRoot) {
  const url = new URL(req.url, "http://localhost");

  return {
    ...process.env,
    ...FIXED_IDENTITY,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_PROJECT_ROOT: projectRoot,
    // Serves every repository under the root without needing a
    // git-daemon-export-ok marker in each one.
    GIT_HTTP_EXPORT_ALL: "1",
    REQUEST_METHOD: req.method,
    PATH_INFO: decodeURIComponent(url.pathname),
    QUERY_STRING: url.search.replace(/^\?/, ""),
    CONTENT_TYPE: req.headers["content-type"] || "",
    CONTENT_LENGTH: req.headers["content-length"] || "",
    HTTP_CONTENT_ENCODING: req.headers["content-encoding"] || "",
    REMOTE_ADDR: req.socket.remoteAddress || "127.0.0.1",
    REMOTE_USER: "tester",
  };
}

// CGI replies with headers, a blank line, then the body. Node needs them
// separated before it can send a response.
function splitCgiResponse(buffer) {
  const separator = buffer.indexOf("\r\n\r\n");
  if (separator === -1) {
    return { headers: {}, status: 200, body: buffer };
  }

  const headers = {};
  let status = 200;

  for (const line of buffer.subarray(0, separator).toString("utf8").split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    if (name.toLowerCase() === "status") {
      status = Number.parseInt(value, 10) || 200;
    } else {
      headers[name] = value;
    }
  }

  return { headers, status, body: buffer.subarray(separator + 4) };
}

function handle(req, res, projectRoot) {
  const backend = spawn(HTTP_BACKEND, { env: cgiEnvironment(req, projectRoot) });
  const chunks = [];

  backend.stdout.on("data", (chunk) => chunks.push(chunk));
  backend.on("error", () => {
    res.writeHead(500);
    res.end();
  });
  backend.on("close", () => {
    const { headers, status, body } = splitCgiResponse(Buffer.concat(chunks));
    res.writeHead(status, headers);
    res.end(body);
  });

  req.pipe(backend.stdin);
}

// Runs the server. Called in the forked child, never in the test process:
// the tests drive git through spawnSync, which blocks the event loop, so a
// server sharing that loop could never answer the request.
function serve(projectRoot) {
  const server = http.createServer((req, res) => handle(req, res, projectRoot));

  server.listen(0, "127.0.0.1", () => {
    process.send({ url: `http://127.0.0.1:${server.address().port}` });
  });
}

// Starts a server exposing every repository under `projectRoot`. Resolves to
// { url, close }, where url is the origin, e.g. http://127.0.0.1:54321.
function startGitHttpServer(projectRoot) {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, [projectRoot], { stdio: "ignore" });

    child.once("error", reject);
    child.once("message", ({ url }) => {
      resolve({
        url,
        close: () =>
          new Promise((done) => {
            child.once("exit", done);
            child.kill();
          }),
      });
    });
  });
}

if (require.main === module) {
  serve(process.argv[2]);
}

module.exports = { startGitHttpServer };
