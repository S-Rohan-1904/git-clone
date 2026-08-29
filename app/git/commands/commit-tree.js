const { fatal, usage } = require("../errors");
const { findGitDir, readObject, writeObject } = require("../repository");
const { resolveRevision } = require("../revision");
const { identity } = require("../identity");

const USAGE = "usage: git commit-tree <tree> [(-p <parent>)...] -m <message>";


class CommitTreeCommand {
  constructor({ treeName, parents = [], message } = {}) {
    this.treeName = treeName;
    this.parents = parents;
    this.message = message;
  }

  execute() {
    if (!this.treeName || this.message === undefined) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    const tree = readObject(resolveRevision(this.treeName, gitDir), gitDir);

    if (tree.type !== "tree") {
      throw fatal(`${this.treeName} is not a valid 'tree' object`);
    }

    const parents = this.parents.map((parent) => {
      const object = readObject(resolveRevision(parent, gitDir), gitDir);
      if (object.type !== "commit") {
        throw fatal(`${parent} is not a valid 'commit' object`);
      }
      return object.sha;
    });

    const body = buildCommit({
      tree: tree.sha,
      parents,
      author: identity("AUTHOR"),
      committer: identity("COMMITTER"),
      message: this.message,
    });

    process.stdout.write(`${writeObject("commit", body, gitDir)}\n`);
  }
}

function buildCommit({ tree, parents, author, committer, message }) {
  const lines = [`tree ${tree}`];

  for (const parent of parents) {
    lines.push(`parent ${parent}`);
  }

  lines.push(`author ${author}`);
  lines.push(`committer ${committer}`);
  lines.push("");
  lines.push(message.endsWith("\n") ? message : `${message}\n`);

  return Buffer.from(lines.join("\n"));
}




module.exports = CommitTreeCommand;
