const { fatal, usage } = require("../errors");
const { findGitDir, readObject, writeObject } = require("../repository");
const { listRefs, writeRef, deleteRef, refExists } = require("../refs");
const { resolveRevision } = require("../revision");
const { identity } = require("../identity");

const PREFIX = "refs/tags/";

class TagCommand {
  constructor({ name, target, message, annotated = false, remove = false } = {}) {
    this.name = name;
    this.target = target;
    this.message = message;
    this.annotated = annotated;
    this.remove = remove;
  }

  execute() {
    const gitDir = findGitDir();

    if (this.remove) {
      if (!this.name || !refExists(gitDir, `${PREFIX}${this.name}`)) {
        throw fatal(`tag '${this.name}' not found.`);
      }
      deleteRef(gitDir, `${PREFIX}${this.name}`);
      return;
    }

    if (!this.name) {
      const names = listRefs(gitDir)
        .filter((ref) => ref.name.startsWith(PREFIX))
        .map((ref) => ref.name.slice(PREFIX.length));

      if (names.length > 0) {
        process.stdout.write(`${names.join("\n")}\n`);
      }
      return;
    }

    if (refExists(gitDir, `${PREFIX}${this.name}`)) {
      throw fatal(`tag '${this.name}' already exists`);
    }

    const sha = resolveRevision(this.target || "HEAD", gitDir);

    if (!this.annotated) {
      writeRef(gitDir, `${PREFIX}${this.name}`, sha);
      return;
    }

    if (this.message === undefined) {
      throw usage("usage: git tag -a <name> -m <message> [<commit>]");
    }

    const body = [
      `object ${sha}`,
      `type ${readObject(sha, gitDir).type}`,
      `tag ${this.name}`,
      `tagger ${identity("COMMITTER")}`,
      "",
      this.message.endsWith("\n") ? this.message : `${this.message}\n`,
    ].join("\n");

    writeRef(gitDir, `${PREFIX}${this.name}`, writeObject("tag", Buffer.from(body), gitDir));
  }
}

module.exports = TagCommand;
