const path = require("path");

const { usage, silentExit } = require("../errors");
const { findGitDir, findRepositoryRoot } = require("../repository");
const { createMatcher } = require("../ignore");

const USAGE = "usage: git check-ignore <pathname>...";

class CheckIgnoreCommand {
  constructor({ paths = [] } = {}) {
    this.paths = paths;
  }

  execute() {
    if (this.paths.length === 0) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    const root = findRepositoryRoot();
    const matcher = createMatcher(root, gitDir);

    const ignored = this.paths.filter((candidate) => {
      const relative = path.relative(root, path.resolve(candidate)).split(path.sep).join("/");
      return matcher.isIgnored(relative, candidate.endsWith("/"));
    });

    if (ignored.length === 0) {
      throw silentExit(1);
    }

    process.stdout.write(`${ignored.join("\n")}\n`);
  }
}

module.exports = CheckIgnoreCommand;
