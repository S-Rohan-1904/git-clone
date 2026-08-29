const { writeObject } = require("./repository");
const { serializeTree, sortTreeEntries, MODE_DIRECTORY } = require("./tree");

function insert(root, segments, entry) {
  let node = root;

  for (const segment of segments.slice(0, -1)) {
    if (!node.directories.has(segment)) {
      node.directories.set(segment, { files: [], directories: new Map() });
    }
    node = node.directories.get(segment);
  }

  node.files.push({ name: segments[segments.length - 1], ...entry });
}

function write(node, gitDir) {
  const entries = node.files.map((file) => ({
    mode: file.mode.toString(8),
    name: file.name,
    sha: file.sha,
  }));

  for (const [name, child] of node.directories) {
    entries.push({ mode: MODE_DIRECTORY, name, sha: write(child, gitDir) });
  }

  return writeObject("tree", serializeTree(sortTreeEntries(entries)), gitDir);
}

function buildTreeFromEntries(entries, gitDir) {
  const root = { files: [], directories: new Map() };

  for (const entry of entries) {
    insert(root, entry.path.split("/"), { mode: entry.mode, sha: entry.sha });
  }

  return write(root, gitDir);
}

module.exports = { buildTreeFromEntries };
