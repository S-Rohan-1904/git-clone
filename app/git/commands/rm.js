const fs = require("fs");
const path = require("path");

const { fatal, usage } = require("../errors");
const { findGitDir, findRepositoryRoot } = require("../repository");
const { readIndex, writeIndex } = require("../index-file");

const USAGE = "usage: git rm [--cached] <file>...";

class RmCommand {
  constructor({ paths = [], cached = false } = {}) {
    this.paths = paths;
    this.cached = cached;
  }

  execute() {
    if (this.paths.length === 0) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    const root = findRepositoryRoot();
    const entries = new Map(readIndex(gitDir).entries.map((entry) => [entry.path, entry]));

    for (const given of this.paths) {
      const relative = path.relative(root, path.resolve(given)).split(path.sep).join("/");

      if (!entries.has(relative)) {
        throw fatal(`pathspec '${given}' did not match any files`);
      }

      entries.delete(relative);

      if (!this.cached) {
        fs.rmSync(path.join(root, relative), { force: true });
      }
    }

    writeIndex(gitDir, [...entries.values()]);
  }
}

module.exports = RmCommand;
