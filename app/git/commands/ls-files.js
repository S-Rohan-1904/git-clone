const { findGitDir } = require("../repository");
const { readIndex } = require("../index-file");

class LsFilesCommand {
  constructor({ stage = false } = {}) {
    this.stage = stage;
  }

  execute() {
    const { entries } = readIndex(findGitDir());

    if (entries.length === 0) {
      return;
    }

    const lines = entries.map((entry) =>
      this.stage
        ? `${entry.mode.toString(8)} ${entry.sha} ${entry.stage}\t${entry.path}`
        : entry.path,
    );

    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

module.exports = LsFilesCommand;
