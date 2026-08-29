const { fatal, usage } = require("../errors");
const { findGitDir } = require("../repository");
const { readHeadTarget, setHead } = require("../refs");

const USAGE = "usage: git symbolic-ref <name> [<ref>]";

class SymbolicRefCommand {
  constructor({ name, target } = {}) {
    this.name = name;
    this.target = target;
  }

  execute() {
    if (!this.name) {
      throw usage(USAGE);
    }
    if (this.name !== "HEAD") {
      throw fatal(`only HEAD is supported, got ${this.name}`);
    }

    const gitDir = findGitDir();

    if (this.target) {
      setHead(gitDir, this.target);
      return;
    }

    const current = readHeadTarget(gitDir);
    if (!current) {
      throw fatal("ref HEAD is not a symbolic ref");
    }

    process.stdout.write(`${current}\n`);
  }
}

module.exports = SymbolicRefCommand;
