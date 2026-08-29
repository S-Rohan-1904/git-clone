const { fatal } = require("../errors");
const { findGitDir, readObject, writeObject, hashObject, objectExists } = require("../repository");
const { listRefs, writeRef } = require("../refs");
const { remoteUrl } = require("../config");
const { discoverRefs, fetchPack } = require("../protocol/upload-pack");
const { unpack } = require("../pack");
const { parseCommit } = require("../commit");

const PREFERRED_CAPABILITIES = ["thin-pack", "ofs-delta", "no-progress"];
const MAX_HAVES = 256;
const HEADS = "refs/heads/";

function localCommits(gitDir, limit) {
  const seen = new Set();
  const queue = listRefs(gitDir)
    .map((ref) => ref.sha)
    .filter((sha) => objectExists(sha, gitDir));

  while (queue.length > 0 && seen.size < limit) {
    const sha = queue.shift();

    if (seen.has(sha)) {
      continue;
    }

    const object = readObject(sha, gitDir);
    if (object.type !== "commit") {
      continue;
    }

    seen.add(sha);
    queue.push(...parseCommit(object.body).parents.filter((parent) => objectExists(parent, gitDir)));
  }

  return [...seen];
}

class FetchCommand {
  constructor({ remote = "origin" } = {}) {
    this.remote = remote;
  }

  async execute() {
    const gitDir = findGitDir();
    const url = remoteUrl(gitDir, this.remote) || this.remote;

    if (!url) {
      throw fatal(`'${this.remote}' does not appear to be a git repository`);
    }

    const advertisement = await discoverRefs(url);
    const wants = [...new Set(advertisement.refs.map((ref) => ref.sha))].filter(
      (sha) => !objectExists(sha, gitDir),
    );

    if (wants.length > 0) {
      const pack = await fetchPack(url, {
        wants,
        haves: localCommits(gitDir, MAX_HAVES),
        capabilities: advertisement.capabilities,
        preferred: PREFERRED_CAPABILITIES,
      });

      const lookup = (sha) => {
        if (!objectExists(sha, gitDir)) {
          return null;
        }
        const object = readObject(sha, gitDir);
        return { type: object.type, data: object.body };
      };

      for (const object of unpack(pack, hashObject, lookup)) {
        writeObject(object.type, object.data, gitDir);
      }
    }

    for (const ref of advertisement.refs) {
      if (ref.name.startsWith(HEADS)) {
        writeRef(gitDir, `refs/remotes/${this.remote}/${ref.name.slice(HEADS.length)}`, ref.sha);
      } else if (ref.name.startsWith("refs/tags/")) {
        writeRef(gitDir, ref.name, ref.sha);
      }
    }

    if (wants.length === 0) {
      process.stderr.write("Already up to date.\n");
    }
  }
}

module.exports = FetchCommand;
