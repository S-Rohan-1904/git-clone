const fs = require("fs");
const path = require("path");

const { findGitDir, findRepositoryRoot, writeObject } = require("../repository");
const {
  serializeTree,
  sortTreeEntries,
  MODE_DIRECTORY,
  MODE_FILE,
  MODE_EXECUTABLE,
  MODE_SYMLINK,
} = require("../tree");

const GIT_DIRECTORY = ".git";
const EXECUTABLE_BITS = 0o111;

class WriteTreeCommand {
  execute() {
    const gitDir = findGitDir();
    const root = findRepositoryRoot();

    process.stdout.write(`${writeTreeFor(root, gitDir)}\n`);
  }
}

function writeTreeFor(directory, gitDir) {
  const entries = [];

  for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
    if (child.name === GIT_DIRECTORY) {
      continue;
    }

    const entry = entryFor(path.join(directory, child.name), child, gitDir);
    if (entry) {
      entries.push(entry);
    }
  }

  return writeObject("tree", serializeTree(sortTreeEntries(entries)), gitDir);
}

function entryFor(fullPath, dirent, gitDir) {
  const name = dirent.name;

  if (dirent.isSymbolicLink()) {
    const target = fs.readlinkSync(fullPath);
    return { mode: MODE_SYMLINK, name, sha: writeObject("blob", target, gitDir) };
  }

  if (dirent.isDirectory()) {
    const sha = writeTreeFor(fullPath, gitDir);
    return isEmptyTree(sha) ? null : { mode: MODE_DIRECTORY, name, sha };
  }

  if (!dirent.isFile()) {
    return null;
  }

  const executable = (fs.statSync(fullPath).mode & EXECUTABLE_BITS) !== 0;
  const sha = writeObject("blob", fs.readFileSync(fullPath), gitDir);

  return { mode: executable ? MODE_EXECUTABLE : MODE_FILE, name, sha };
}

function isEmptyTree(sha) {
  return sha === EMPTY_TREE_SHA;
}

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

module.exports = WriteTreeCommand;
