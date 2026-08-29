const { fatal, usage } = require("../errors");
const { findGitDir, writeObject } = require("../repository");
const { readIndex } = require("../index-file");
const { buildTreeFromEntries } = require("../tree-builder");
const { identity } = require("../identity");
const { resolveHead, readHeadTarget, writeRef, currentBranch } = require("../refs");

const USAGE = "usage: git commit -m <message>";
const ABBREVIATED = 7;

class CommitCommand {
  constructor({ message } = {}) {
    this.message = message;
  }

  execute() {
    if (this.message === undefined) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    const { entries } = readIndex(gitDir);

    if (entries.length === 0) {
      throw fatal("nothing to commit");
    }

    const tree = buildTreeFromEntries(entries, gitDir);
    const parent = resolveHead(gitDir);

    const lines = [`tree ${tree}`];
    if (parent) {
      lines.push(`parent ${parent}`);
    }
    lines.push(`author ${identity("AUTHOR")}`);
    lines.push(`committer ${identity("COMMITTER")}`);
    lines.push("");
    lines.push(this.message.endsWith("\n") ? this.message : `${this.message}\n`);

    const sha = writeObject("commit", Buffer.from(lines.join("\n")), gitDir);
    const target = readHeadTarget(gitDir);

    if (!target) {
      throw fatal("HEAD is detached; refusing to commit");
    }

    writeRef(gitDir, target, sha);

    const branch = currentBranch(gitDir) || "HEAD";
    const root = parent ? "" : " (root-commit)";
    const subject = this.message.split("\n")[0];

    process.stdout.write(`[${branch}${root} ${sha.slice(0, ABBREVIATED)}] ${subject}\n`);
  }
}

module.exports = CommitCommand;
