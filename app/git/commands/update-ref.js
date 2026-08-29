const { fatal, usage } = require("../errors");
const { findGitDir } = require("../repository");
const { writeRef, deleteRef, refExists } = require("../refs");
const { resolveRevision } = require("../revision");

const USAGE = "usage: git update-ref (-d <ref> | <ref> <newvalue>)";

class UpdateRefCommand {
  constructor({ name, value, remove = false } = {}) {
    this.name = name;
    this.value = value;
    this.remove = remove;
  }

  execute() {
    if (!this.name) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();

    if (this.remove) {
      if (!refExists(gitDir, this.name)) {
        throw fatal(`cannot delete '${this.name}': ref does not exist`);
      }
      deleteRef(gitDir, this.name);
      return;
    }

    if (!this.value) {
      throw usage(USAGE);
    }

    writeRef(gitDir, this.name, resolveRevision(this.value, gitDir));
  }
}

module.exports = UpdateRefCommand;
