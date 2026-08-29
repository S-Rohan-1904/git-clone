const { readObject, objectExists } = require("./repository");
const { parseCommit } = require("./commit");
const { parseTree, MODE_DIRECTORY, MODE_SUBMODULE } = require("./tree");

const ZERO = "0".repeat(40);

function collectTree(sha, gitDir, seen) {
  if (seen.has(sha)) {
    return;
  }
  seen.add(sha);

  for (const entry of parseTree(readObject(sha, gitDir).body)) {
    if (entry.mode === MODE_SUBMODULE) {
      continue;
    }
    if (entry.mode === MODE_DIRECTORY) {
      collectTree(entry.sha, gitDir, seen);
    } else {
      seen.add(entry.sha);
    }
  }
}

function ancestry(tips, gitDir) {
  const seen = new Set();
  const queue = tips.filter((sha) => sha && sha !== ZERO && objectExists(sha, gitDir));

  while (queue.length > 0) {
    const sha = queue.shift();
    if (seen.has(sha)) {
      continue;
    }

    const object = readObject(sha, gitDir);
    if (object.type !== "commit") {
      continue;
    }

    seen.add(sha);
    queue.push(...parseCommit(object.body).parents);
  }

  return seen;
}

function collectObjects(gitDir, tips, excludeTips = []) {
  const excluded = ancestry(excludeTips, gitDir);
  const excludedTrees = new Set();

  for (const sha of excluded) {
    collectTree(parseCommit(readObject(sha, gitDir).body).tree, gitDir, excludedTrees);
  }

  const commits = [...ancestry(tips, gitDir)].filter((sha) => !excluded.has(sha));
  const objects = new Set(commits);
  const trees = new Set();

  for (const sha of commits) {
    collectTree(parseCommit(readObject(sha, gitDir).body).tree, gitDir, trees);
  }

  for (const sha of trees) {
    if (!excludedTrees.has(sha)) {
      objects.add(sha);
    }
  }

  return [...objects].map((sha) => {
    const object = readObject(sha, gitDir);
    return { sha, type: object.type, data: object.body };
  });
}

module.exports = { collectObjects, ancestry };
