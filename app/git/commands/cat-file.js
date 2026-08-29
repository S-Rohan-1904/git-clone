const { usage, silentExit } = require("../errors");
const { findGitDir, readObject } = require("../repository");
const { resolveRevision } = require("../revision");
const { parseTree, formatTree } = require("../tree");

const USAGE = "usage: git cat-file (-p | -t | -s | -e) <object>";

class CatFileCommand {
  constructor(flag, objectName) {
    this.flag = flag;
    this.objectName = objectName;
  }

  execute() {
    const { flag, objectName } = this;

    if (!flag || !objectName) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();

    switch (flag) {
      case "-e":
        if (!exists(objectName, gitDir)) {
          throw silentExit(1);
        }
        return;

      case "-p": {
        const object = readObject(resolveRevision(objectName, gitDir), gitDir);
        if (object.type === "tree") {
          process.stdout.write(formatTree(parseTree(object.body)));
        } else {
          process.stdout.write(object.body);
        }
        return;
      }

      case "-t":
        process.stdout.write(`${readObject(resolveRevision(objectName, gitDir), gitDir).type}\n`);
        return;

      case "-s":
        process.stdout.write(`${readObject(resolveRevision(objectName, gitDir), gitDir).size}\n`);
        return;

      default:
        throw usage(`error: unknown switch \`${flag}'\n${USAGE}`);
    }
  }
}

function exists(name, gitDir) {
  try {
    readObject(resolveRevision(name, gitDir), gitDir);
    return true;
  } catch {
    return false;
  }
}

module.exports = CatFileCommand;
