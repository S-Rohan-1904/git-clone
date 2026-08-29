const { fatal } = require("../errors");
const { request } = require("./transport");
const { discoverRefs } = require("./upload-pack");
const pktLine = require("./pkt-line");

const SERVICE = "git-receive-pack";
const AGENT = "agent=git/mygit-1.0";
const PREFERRED_CAPABILITIES = ["report-status"];

function advertise(remote) {
  return discoverRefs(remote, SERVICE);
}

async function sendPack(remote, { updates, capabilities, pack }) {
  const negotiated = [...PREFERRED_CAPABILITIES.filter((name) => capabilities.has(name)), AGENT];

  const commands = updates.map((update, index) => {
    const line = `${update.old} ${update.new} ${update.ref}`;
    return pktLine.encode(index === 0 ? `${line}\0${negotiated.join(" ")}\n` : `${line}\n`);
  });

  const response = await request(`${remote}/${SERVICE}`, {
    method: "POST",
    headers: {
      "Content-Type": `application/x-${SERVICE}-request`,
      Accept: `application/x-${SERVICE}-result`,
    },
    body: Buffer.concat([...commands, pktLine.flush(), pack]),
  });

  return parseReport(response.body);
}

function parseReport(body) {
  const { lines } = pktLine.decode(body);
  const report = lines.map((line) => line.toString("utf8").replace(/\n$/, ""));

  for (const line of report) {
    if (line.startsWith("unpack ") && line !== "unpack ok") {
      throw fatal(`remote rejected the pack: ${line.slice("unpack ".length)}`);
    }
    if (line.startsWith("ng ")) {
      throw fatal(`remote rejected the update: ${line.slice(3)}`);
    }
  }

  return report;
}

module.exports = { advertise, sendPack, SERVICE };
