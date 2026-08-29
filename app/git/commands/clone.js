const fs = require("fs");
const path = require("path");

const { fatal, usage } = require("../errors");
const { initRepository, writeObject, hashObject } = require("../repository");
const { writeRef } = require("../refs");
const { checkoutCommit } = require("../checkout");
const { unpack } = require("../pack");
const { discoverRefs, fetchPack } = require("../protocol/upload-pack");

const USAGE = "usage: git clone <repository> [<directory>]";

const PREFERRED_CAPABILITIES = ["ofs-delta", "no-progress"];
const DEFAULT_BRANCHES = ["refs/heads/main", "refs/heads/master"];

class CloneCommand {
  constructor({ url, directory } = {}) {
    this.url = url;
    this.directory = directory;
  }

  async execute() {
    if (!this.url) {
      throw usage(USAGE);
    }

    const remote = this.url.replace(/\/+$/, "");
    const target = path.resolve(this.directory || defaultDirectory(remote));

    if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
      throw fatal(`destination path '${path.basename(target)}' already exists and is not an empty directory.`);
    }

    process.stderr.write(`Cloning into '${path.basename(target)}'...\n`);

    const advertisement = await discoverRefs(remote);

    fs.mkdirSync(target, { recursive: true });
    const gitDir = initRepository(target);
    writeConfig(gitDir, remote);

    if (advertisement.refs.length === 0) {
      process.stderr.write("warning: You appear to have cloned an empty repository.\n");
      return;
    }

    const pack = await fetchPack(remote, {
      wants: [...new Set(advertisement.refs.map((ref) => ref.sha))],
      capabilities: advertisement.capabilities,
      preferred: PREFERRED_CAPABILITIES,
    });

    for (const object of unpack(pack, hashObject)) {
      writeObject(object.type, object.data, gitDir);
    }

    for (const ref of advertisement.refs) {
      if (ref.name.startsWith("refs/")) {
        writeRef(gitDir, ref.name, ref.sha);
      }
    }

    const branch = defaultBranch(advertisement);
    fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: ${branch}\n`);

    const tip = advertisement.refs.find((ref) => ref.name === branch);
    if (tip) {
      checkoutCommit(tip.sha, target, gitDir);
    }
  }
}

function defaultDirectory(remote) {
  const name = remote.split("/").filter(Boolean).pop() || "repository";
  return name.replace(/\.git$/, "");
}



function defaultBranch({ refs, symrefHead: symbolic }) {
  const names = new Set(refs.map((ref) => ref.name));

  if (symbolic && names.has(symbolic)) {
    return symbolic;
  }

  for (const candidate of DEFAULT_BRANCHES) {
    if (names.has(candidate)) {
      return candidate;
    }
  }

  const head = refs.find((ref) => ref.name === "HEAD");
  if (head) {
    const match = refs.find((ref) => ref.name.startsWith("refs/heads/") && ref.sha === head.sha);
    if (match) {
      return match.name;
    }
  }

  const branch = refs.find((ref) => ref.name.startsWith("refs/heads/"));
  return branch ? branch.name : DEFAULT_BRANCHES[0];
}



function writeConfig(gitDir, remote) {
  const config = [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = true",
    "\tbare = false",
    '[remote "origin"]',
    `\turl = ${remote}`,
    "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(gitDir, "config"), config);
}

module.exports = CloneCommand;
