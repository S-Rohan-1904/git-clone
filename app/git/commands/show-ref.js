const { findGitDir } = require("../repository");
const { listRefs, resolveHead } = require("../refs");

class ShowRefCommand {
  constructor({ includeHead = false } = {}) {
    this.includeHead = includeHead;
  }

  execute() {
    const gitDir = findGitDir();
    const lines = [];

    if (this.includeHead) {
      const head = resolveHead(gitDir);
      if (head) {
        lines.push(`${head} HEAD`);
      }
    }

    for (const ref of listRefs(gitDir)) {
      lines.push(`${ref.sha} ${ref.name}`);
    }

    if (lines.length > 0) {
      process.stdout.write(`${lines.join("\n")}\n`);
    }
  }
}

module.exports = ShowRefCommand;
