const { fatal, usage } = require("../errors");
const { findGitDir } = require("../repository");
const { listRefs, writeRef, deleteRef, refExists, currentBranch } = require("../refs");
const { resolveRevision } = require("../revision");

const PREFIX = "refs/heads/";

class BranchCommand {
  constructor({ name, start, remove = false } = {}) {
    this.name = name;
    this.start = start;
    this.remove = remove;
  }

  execute() {
    const gitDir = findGitDir();

    if (this.remove) {
      if (!this.name) {
        throw usage("usage: git branch -d <name>");
      }
      if (!refExists(gitDir, `${PREFIX}${this.name}`)) {
        throw fatal(`branch '${this.name}' not found.`);
      }
      if (this.name === currentBranch(gitDir)) {
        throw fatal(`cannot delete branch '${this.name}' checked out`);
      }
      deleteRef(gitDir, `${PREFIX}${this.name}`);
      return;
    }

    if (this.name) {
      if (refExists(gitDir, `${PREFIX}${this.name}`)) {
        throw fatal(`a branch named '${this.name}' already exists`);
      }
      writeRef(gitDir, `${PREFIX}${this.name}`, resolveRevision(this.start || "HEAD", gitDir));
      return;
    }

    const current = currentBranch(gitDir);
    const names = listRefs(gitDir)
      .filter((ref) => ref.name.startsWith(PREFIX))
      .map((ref) => ref.name.slice(PREFIX.length));

    if (names.length === 0) {
      return;
    }

    process.stdout.write(`${names.map((name) => `${name === current ? "*" : " "} ${name}`).join("\n")}\n`);
  }
}

module.exports = BranchCommand;
