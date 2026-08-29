const { fatal } = require("../errors");
const { findGitDir } = require("../repository");
const { readRef, currentBranch, writeRef } = require("../refs");
const { remoteUrl } = require("../config");
const { advertise, sendPack } = require("../protocol/receive-pack");
const { collectObjects } = require("../reachable");
const { writePack } = require("../pack-writer");

const HEADS = "refs/heads/";
const ZERO = "0".repeat(40);

class PushCommand {
  constructor({ remote = "origin", branch } = {}) {
    this.remote = remote;
    this.branch = branch;
  }

  async execute() {
    const gitDir = findGitDir();
    const url = remoteUrl(gitDir, this.remote) || this.remote;
    const branch = this.branch || currentBranch(gitDir);

    if (!branch) {
      throw fatal("HEAD is detached; specify a branch to push");
    }

    const ref = `${HEADS}${branch}`;
    const local = readRef(gitDir, ref);

    if (!local) {
      throw fatal(`src refspec ${branch} does not match any`);
    }

    const advertisement = await advertise(url);
    const remote = advertisement.refs.find((candidate) => candidate.name === ref);
    const old = remote ? remote.sha : ZERO;

    if (old === local) {
      process.stderr.write("Everything up-to-date\n");
      return;
    }

    const objects = collectObjects(gitDir, [local], remote ? [old] : []);

    await sendPack(url, {
      updates: [{ old, new: local, ref }],
      capabilities: advertisement.capabilities,
      pack: writePack(objects),
    });

    writeRef(gitDir, `refs/remotes/${this.remote}/${branch}`, local);

    process.stderr.write(`To ${url}\n   ${old.slice(0, 7)}..${local.slice(0, 7)}  ${branch} -> ${branch}\n`);
  }
}

module.exports = PushCommand;
