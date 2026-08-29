const { fatal } = require("../errors");
const { request } = require("./transport");
const pktLine = require("./pkt-line");

const SERVICE = "git-upload-pack";
const AGENT = "agent=git/mygit-1.0";
const PEELED_SUFFIX = "^{}";
const ZERO = "0".repeat(40);

async function discoverRefs(remote, service = SERVICE) {
  const response = await request(`${remote}/info/refs?service=${service}`);
  const { lines } = pktLine.decode(response.body);

  if (lines.length === 0 || !lines[0].toString("utf8").startsWith(`# service=${service}`)) {
    throw fatal(`invalid response from '${remote}'`);
  }

  const refs = [];
  const capabilities = new Set();

  for (const line of lines.slice(1)) {
    const text = line.toString("utf8").replace(/\n$/, "");
    const [reference, capabilityList] = text.split("\0");
    const [sha, name] = reference.split(" ");

    if (capabilityList) {
      for (const capability of capabilityList.split(" ").filter(Boolean)) {
        capabilities.add(capability);
      }
    }

    if (!sha || !name || name.endsWith(PEELED_SUFFIX) || sha === ZERO) {
      continue;
    }

    refs.push({ sha, name });
  }

  return { refs, capabilities, symrefHead: symrefHead(capabilities) };
}

function symrefHead(capabilities) {
  for (const capability of capabilities) {
    const match = /^symref=HEAD:(.+)$/.exec(capability);
    if (match) {
      return match[1];
    }
  }
  return null;
}

async function fetchPack(remote, { wants, haves = [], capabilities, preferred }) {
  const negotiated = [...preferred.filter((name) => capabilities.has(name)), AGENT];

  const parts = wants.map((sha, index) =>
    pktLine.encode(index === 0 ? `want ${sha} ${negotiated.join(" ")}\n` : `want ${sha}\n`),
  );

  parts.push(pktLine.flush());
  parts.push(...haves.map((sha) => pktLine.encode(`have ${sha}\n`)));
  parts.push(pktLine.encode("done\n"));

  const response = await request(`${remote}/${SERVICE}`, {
    method: "POST",
    headers: {
      "Content-Type": `application/x-${SERVICE}-request`,
      Accept: `application/x-${SERVICE}-result`,
    },
    body: Buffer.concat(parts),
  });

  return stripNegotiation(response.body);
}

function stripNegotiation(body) {
  let offset = 0;

  for (;;) {
    const line = pktLine.readLine(body, offset);
    if (!line) {
      break;
    }
    offset = line.next;
  }

  if (body.subarray(offset, offset + 4).toString("ascii") !== "PACK") {
    throw fatal("server did not return a packfile");
  }

  return body.subarray(offset);
}

module.exports = { discoverRefs, fetchPack, SERVICE };
