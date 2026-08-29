const { fatal, usage } = require("../errors");
const { findGitDir, readObject } = require("../repository");
const { resolveRevision } = require("../revision");
const { parseCommit } = require("../commit");
const { parseTree, formatTree } = require("../tree");

const USAGE = "usage: git ls-tree [--name-only] <tree-ish>";

class LsTreeCommand {
  constructor({ nameOnly = false, treeName } = {}) {
    this.nameOnly = nameOnly;
    this.treeName = treeName;
  }

  execute() {
    if (!this.treeName) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    let object = readObject(resolveRevision(this.treeName, gitDir), gitDir);

    if (object.type === "commit") {
      object = readObject(parseCommit(object.body).tree, gitDir);
    }

    if (object.type !== "tree") {
      throw fatal("not a tree object");
    }

    const entries = parseTree(object.body);

    process.stdout.write(formatTree(entries, { nameOnly: this.nameOnly }));
  }
}

module.exports = LsTreeCommand;
