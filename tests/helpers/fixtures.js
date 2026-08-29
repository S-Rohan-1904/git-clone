"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const { runMine, git } = require("./spawn");

const createdDirs = [];

process.on("exit", () => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// realpath matters on macOS, where os.tmpdir() is a symlink into /private and
// process.cwd() inside the child resolves to the real path.
function tmpDir(prefix = "mygit-") {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  createdDirs.push(dir);
  return dir;
}

// files maps a relative path to its contents, e.g. { "a.txt": "hello\n" }.
function materialize(dir, files) {
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  }
  return dir;
}

// A repository initialized by the implementation under test.
function mineRepo(files = {}) {
  const dir = tmpDir("mygit-mine-");
  const res = runMine(["init"], { cwd: dir });
  assert.strictEqual(res.code, 0, `\`${res.command}\` exited ${res.code}\n${res.err}`);
  materialize(dir, files);
  return dir;
}

// A repository initialized by the real git binary.
function oracleRepo(files = {}) {
  const dir = tmpDir("mygit-oracle-");
  git(["init", "-q", "--initial-branch=main", "."], { cwd: dir });
  materialize(dir, files);
  return dir;
}

// Two repositories holding identical working trees: one ours, one git's.
function pairedRepos(files = {}) {
  return { mine: mineRepo(files), oracle: oracleRepo(files) };
}

function objectPath(repo, sha) {
  return path.join(repo, ".git", "objects", sha.slice(0, 2), sha.slice(2));
}

function objectExists(repo, sha) {
  return fs.existsSync(objectPath(repo, sha));
}

// Reads a loose object and splits it into its header and payload. Compares
// inflated bytes rather than the file on disk, because the zlib compression
// level is not part of the object format and legitimately differs between
// implementations.
function readObject(repo, sha) {
  const file = objectPath(repo, sha);
  assert.ok(fs.existsSync(file), `expected object ${sha} to exist at .git/objects/${sha.slice(0, 2)}/${sha.slice(2)}`);
  let raw;
  try {
    raw = zlib.inflateSync(fs.readFileSync(file));
  } catch (err) {
    throw new assert.AssertionError({
      message: `object ${sha} is not valid zlib-compressed data: ${err.message}`,
    });
  }
  const nul = raw.indexOf(0);
  assert.ok(nul !== -1, `object ${sha} has no null byte separating header from body`);
  const header = raw.subarray(0, nul).toString("utf8");
  const match = /^(\w+) (\d+)$/.exec(header);
  assert.ok(match, `object ${sha} has malformed header ${JSON.stringify(header)}, expected "<type> <size>"`);
  const body = raw.subarray(nul + 1);
  return { type: match[1], size: Number(match[2]), body, header, raw };
}

function hashObject(type, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const store = Buffer.concat([Buffer.from(`${type} ${buf.length}\0`), buf]);
  return crypto.createHash("sha1").update(store).digest("hex");
}

// Deterministic pseudo-binary payload, for checking that content is treated as
// bytes rather than as UTF-8 text.
function binaryBlob(seed = 1, length = 512) {
  const buf = Buffer.alloc(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = state & 0xff;
  }
  return buf;
}

module.exports = {
  tmpDir,
  materialize,
  mineRepo,
  oracleRepo,
  pairedRepos,
  objectPath,
  objectExists,
  readObject,
  hashObject,
  binaryBlob,
};
