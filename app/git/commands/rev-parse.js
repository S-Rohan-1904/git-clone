const { usage } = require("../errors");
const { findGitDir } = require("../repository");
const { resolveRevision } = require("../revision");

const USAGE = "usage: git rev-parse <rev>...";

class RevParseCommand {
  constructor({ revisions = [] } = {}) {
    this.revisions = revisions;
  }

  execute() {
    if (this.revisions.length === 0) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    const resolved = this.revisions.map((revision) => resolveRevision(revision, gitDir));

    process.stdout.write(`${resolved.join("\n")}\n`);
  }
}

module.exports = RevParseCommand;
