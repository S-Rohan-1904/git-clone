const fs = require("fs");
const path = require("path");

const { fatal } = require("./errors");
const { readObject } = require("./repository");
const {
  parseTree,
  MODE_DIRECTORY,
  MODE_EXECUTABLE,
  MODE_SYMLINK,
  MODE_SUBMODULE,
} = require("./tree");

const FILE_MODE = 0o644;
const EXECUTABLE_MODE = 0o755;

function checkoutTree(treeSha, directory, gitDir) {
  const tree = readObject(treeSha, gitDir);

  if (tree.type !== "tree") {
    throw fatal(`${treeSha} is not a valid 'tree' object`);
  }

  fs.mkdirSync(directory, { recursive: true });

  for (const entry of parseTree(tree.body)) {
    const destination = path.join(directory, entry.name);

    if (entry.mode === MODE_DIRECTORY) {
      checkoutTree(entry.sha, destination, gitDir);
      continue;
    }

    if (entry.mode === MODE_SUBMODULE) {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }

    const blob = readObject(entry.sha, gitDir);

    if (entry.mode === MODE_SYMLINK) {
      fs.rmSync(destination, { force: true });
      fs.symlinkSync(blob.body.toString("utf8"), destination);
      continue;
    }

    fs.writeFileSync(destination, blob.body, {
      mode: entry.mode === MODE_EXECUTABLE ? EXECUTABLE_MODE : FILE_MODE,
    });
  }
}

function checkoutCommit(commitSha, directory, gitDir) {
  const commit = readObject(commitSha, gitDir);

  if (commit.type !== "commit") {
    throw fatal(`${commitSha} is not a valid 'commit' object`);
  }

  const match = /^tree ([0-9a-f]{40})$/m.exec(commit.body.toString("utf8"));
  if (!match) {
    throw fatal(`commit ${commitSha} has no tree`);
  }

  checkoutTree(match[1], directory, gitDir);
}

module.exports = { checkoutTree, checkoutCommit };
