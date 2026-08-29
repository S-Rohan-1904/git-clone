const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const { fatal } = require("./errors");

const OBJECT_NAME_PATTERN = /^[0-9a-f]+$/;
const MIN_ABBREVIATION = 4;
const SHA_LENGTH = 40;

function findGitDir(start = process.cwd()) {
  let dir = path.resolve(start);

  for (;;) {
    const candidate = path.join(dir, ".git");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw fatal("not a git repository (or any of the parent directories): .git");
    }
    dir = parent;
  }
}

function findRepositoryRoot(start = process.cwd()) {
  return path.dirname(findGitDir(start));
}

const REPOSITORY_DIRECTORIES = [
  "objects/info",
  "objects/pack",
  "refs/heads",
  "refs/tags",
];

const DEFAULT_CONFIG = [
  "[core]",
  "\trepositoryformatversion = 0",
  "\tfilemode = true",
  "\tbare = false",
  "",
].join("\n");

function initRepository(root) {
  const gitDir = path.join(root, ".git");

  for (const directory of REPOSITORY_DIRECTORIES) {
    fs.mkdirSync(path.join(gitDir, ...directory.split("/")), { recursive: true });
  }

  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(gitDir, "config"), DEFAULT_CONFIG);

  return gitDir;
}

function objectPath(gitDir, sha) {
  return path.join(gitDir, "objects", sha.slice(0, 2), sha.slice(2));
}

function resolveObjectName(name, gitDir) {
  if (typeof name !== "string" || !OBJECT_NAME_PATTERN.test(name) || name.length > SHA_LENGTH) {
    throw fatal(`Not a valid object name ${name}`);
  }

  if (name.length === SHA_LENGTH) {
    if (!fs.existsSync(objectPath(gitDir, name))) {
      throw fatal(`Not a valid object name ${name}`);
    }
    return name;
  }

  if (name.length < MIN_ABBREVIATION) {
    throw fatal(`Not a valid object name ${name}`);
  }

  const prefix = name.slice(0, 2);
  const rest = name.slice(2);
  const dir = path.join(gitDir, "objects", prefix);

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    throw fatal(`Not a valid object name ${name}`);
  }

  const matches = entries.filter((entry) => entry.startsWith(rest));
  if (matches.length === 0) {
    throw fatal(`Not a valid object name ${name}`);
  }
  if (matches.length > 1) {
    throw fatal(`ambiguous argument '${name}': unknown revision or path not in the working tree.`);
  }

  return prefix + matches[0];
}

function objectExists(name, gitDir) {
  try {
    resolveObjectName(name, gitDir);
    return true;
  } catch {
    return false;
  }
}

function readObject(name, gitDir) {
  const sha = resolveObjectName(name, gitDir);

  let inflated;
  try {
    inflated = zlib.inflateSync(fs.readFileSync(objectPath(gitDir, sha)));
  } catch {
    throw fatal(`unable to read ${sha}`);
  }

  const separator = inflated.indexOf(0);
  if (separator === -1) {
    throw fatal(`invalid object ${sha}`);
  }

  const header = inflated.subarray(0, separator).toString("utf8");
  const match = /^(\w+) (\d+)$/.exec(header);
  if (!match) {
    throw fatal(`invalid object ${sha}`);
  }

  return { sha, type: match[1], size: Number(match[2]), body: inflated.subarray(separator + 1) };
}

function serializeObject(type, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
}

function hashObject(type, content) {
  return crypto.createHash("sha1").update(serializeObject(type, content)).digest("hex");
}

function writeObject(type, content, gitDir) {
  const stored = serializeObject(type, content);
  const sha = crypto.createHash("sha1").update(stored).digest("hex");

  if (gitDir) {
    const destination = objectPath(gitDir, sha);

    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, zlib.deflateSync(stored));
    }
  }

  return sha;
}

module.exports = {
  initRepository,
  DEFAULT_CONFIG,
  findGitDir,
  findRepositoryRoot,
  objectPath,
  resolveObjectName,
  objectExists,
  readObject,
  serializeObject,
  hashObject,
  writeObject,
};
