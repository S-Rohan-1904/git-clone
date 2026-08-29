const http = require("http");
const https = require("https");
const { URL } = require("url");

const { fatal } = require("../errors");

const USER_AGENT = "git/mygit-1.0";
const MAX_REDIRECTS = 5;

function request(url, { method = "GET", headers = {}, body, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(fatal(`unable to parse URL '${url}'`));
      return;
    }

    const client = target.protocol === "https:" ? https : http;

    const req = client.request(
      target,
      {
        method,
        headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const payload = Buffer.concat(chunks);

          if (isRedirect(res.statusCode) && res.headers.location) {
            if (redirects >= MAX_REDIRECTS) {
              reject(fatal(`too many redirects while fetching ${url}`));
              return;
            }
            resolve(
              request(new URL(res.headers.location, target).toString(), {
                method,
                headers,
                body,
                redirects: redirects + 1,
              }),
            );
            return;
          }

          if (res.statusCode !== 200) {
            reject(fatal(`repository '${url}' not found (HTTP ${res.statusCode})`));
            return;
          }

          resolve({ status: res.statusCode, headers: res.headers, body: payload });
        });
      },
    );

    req.on("error", (error) => reject(fatal(`unable to access '${url}': ${error.message}`)));

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

module.exports = { request };
