"use strict";

// Stage 7: Clone a repository
//
// Everything here runs against a local server built on git's own
// `git-http-backend`, so the smart HTTP protocol, the pkt-line framing and
// the packfile on the wire are all genuine -- there is no network access and
// no hand-rolled fixture that could quietly disagree with real git.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { tmpDir, materialize, binaryBlob } = require("../helpers/fixtures");
const { startGitHttpServer } = require("../helpers/git-http-server");
const { assertExit, assertNoStackTrace } = require("../helpers/assertions");

let server;
let projectRoot;
const sources = {};

// Publishes a working repository as a bare one the server can serve.
function publish(name, build) {
  const work = tmpDir(`mygit-src-${name}-`);
  git(["init", "-q", `--initial-branch=${build.branch || "main"}`, "."], { cwd: work });
  build.commits(work);
  const bare = path.join(projectRoot, `${name}.git`);
  git(["clone", "-q", "--bare", work, bare], { cwd: projectRoot });
  sources[name] = { work, bare };
}

function commit(repo, message) {
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", message], { cwd: repo });
}

before(async () => {
  projectRoot = tmpDir("mygit-serve-");

  publish("basic", {
    commits: (repo) => {
      materialize(repo, {
        "README.md": "first version\n",
        "src/index.js": "console.log('hi');\n",
        "src/deep/nested.txt": "buried\n",
        "data.bin": binaryBlob(5, 2048),
      });
      fs.symlinkSync("README.md", path.join(repo, "link.md"));
      fs.writeFileSync(path.join(repo, "run.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
      commit(repo, "first commit");

      materialize(repo, { "README.md": "second version\n", "src/added.js": "const added = 1;\n" });
      commit(repo, "second commit");
    },
  });

  publish("master-branch", {
    branch: "master",
    commits: (repo) => {
      materialize(repo, { "only.txt": "on master\n" });
      commit(repo, "only commit");
    },
  });

  // Repeated edits to a large, highly repetitive file are what push git's
  // packer into emitting deltas, which is the part of the format a naive
  // packfile reader gets wrong.
  publish("deltas", {
    commits: (repo) => {
      let body = "the quick brown fox jumps over the lazy dog\n".repeat(4000);
      materialize(repo, { "large.txt": body });
      commit(repo, "large file");

      for (let round = 0; round < 5; round += 1) {
        body = `revision ${round}\n${body}appended line ${round}\n`;
        materialize(repo, { "large.txt": body, [`extra-${round}.txt`]: `extra ${round}\n` });
        commit(repo, `revision ${round}`);
      }
    },
  });

  git(["init", "-q", "--bare", "--initial-branch=main", path.join(projectRoot, "empty.git")], {
    cwd: projectRoot,
  });

  server = await startGitHttpServer(projectRoot);
});

after(async () => {
  if (server) await server.close();
});

function cloneInto(name, directory = "clone") {
  const workspace = tmpDir("mygit-clone-");
  const result = runMine(["clone", `${server.url}/${name}.git`, directory], { cwd: workspace });
  return { workspace, target: path.join(workspace, directory), result };
}

// Compares every tracked file in the clone against the source working tree.
function assertWorkingTreeMatches(target, sourceWork) {
  const expected = git(["ls-files"], { cwd: sourceWork }).out.trim().split("\n").filter(Boolean);

  for (const relative of expected) {
    const cloned = path.join(target, relative);
    const original = path.join(sourceWork, relative);
    assert.ok(fs.existsSync(cloned), `expected ${relative} to be checked out`);
    assert.ok(
      fs.readFileSync(cloned).equals(fs.readFileSync(original)),
      `contents of ${relative} differ from the source repository`,
    );
  }
}

test("clone exits 0 and creates the target directory", () => {
  const { result, target } = cloneInto("basic");
  assertExit(result, 0);
  assert.ok(fs.existsSync(target), "expected the target directory to be created");
  assert.ok(fs.existsSync(path.join(target, ".git")), "expected a .git directory in the clone");
});

test("clone checks out every file from the source repository", () => {
  const { target } = cloneInto("basic");
  assertWorkingTreeMatches(target, sources.basic.work);
});

test("clone checks out files in nested directories", () => {
  const { target } = cloneInto("basic");
  assert.strictEqual(fs.readFileSync(path.join(target, "src", "deep", "nested.txt"), "utf8"), "buried\n");
});

test("clone preserves binary file contents", () => {
  const { target } = cloneInto("basic");
  assert.ok(
    fs.readFileSync(path.join(target, "data.bin")).equals(binaryBlob(5, 2048)),
    "binary file contents were altered during checkout",
  );
});

test("clone restores the executable bit", () => {
  const { target } = cloneInto("basic");
  const mode = fs.statSync(path.join(target, "run.sh")).mode;
  assert.ok(mode & 0o111, `expected run.sh to be executable, got mode ${(mode & 0o777).toString(8)}`);
});

test("clone restores symlinks as symlinks", () => {
  const { target } = cloneInto("basic");
  const link = path.join(target, "link.md");
  assert.ok(fs.lstatSync(link).isSymbolicLink(), "expected link.md to be a symlink");
  assert.strictEqual(fs.readlinkSync(link), "README.md");
});

test("clone checks out the tip commit, not an earlier one", () => {
  const { target } = cloneInto("basic");
  assert.strictEqual(fs.readFileSync(path.join(target, "README.md"), "utf8"), "second version\n");
  assert.ok(fs.existsSync(path.join(target, "src", "added.js")), "file added in the second commit is missing");
});

test("clone writes HEAD as a symbolic ref to the default branch", () => {
  const { target } = cloneInto("basic");
  assert.strictEqual(fs.readFileSync(path.join(target, ".git", "HEAD"), "utf8"), "ref: refs/heads/main\n");
});

test("clone writes the branch ref with the source tip SHA", () => {
  const { target } = cloneInto("basic");
  const expected = git(["rev-parse", "main"], { cwd: sources.basic.work }).out.trim();
  const actual = fs.readFileSync(path.join(target, ".git", "refs", "heads", "main"), "utf8").trim();
  assert.strictEqual(actual, expected);
});

test("the real git binary reports the clone as a healthy repository", () => {
  const { target } = cloneInto("basic");
  const fsck = runGit(["fsck"], { cwd: target });
  assertExit(fsck, 0);
});

test("the cloned history matches the source history", () => {
  const { target } = cloneInto("basic");
  const ours = runGit(["log", "--format=%H %s"], { cwd: target });
  const theirs = git(["log", "--format=%H %s"], { cwd: sources.basic.work });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "commit history differs from the source repository");
});

test("clone writes every object the history references", () => {
  const { target } = cloneInto("basic");
  const ours = runGit(["rev-list", "--objects", "--all"], { cwd: target });
  const theirs = git(["rev-list", "--objects", "--all"], { cwd: sources.basic.work });
  assertExit(ours, 0);
  assert.strictEqual(ours.out.split("\n").sort().join("\n"), theirs.out.split("\n").sort().join("\n"));
});

test("our own commands can read the objects we cloned", () => {
  const { target } = cloneInto("basic");
  const head = fs.readFileSync(path.join(target, ".git", "refs", "heads", "main"), "utf8").trim();

  const type = runMine(["cat-file", "-t", head], { cwd: target });
  assertExit(type, 0);
  assert.strictEqual(type.out, "commit\n");

  const body = runMine(["cat-file", "-p", head], { cwd: target });
  assertExit(body, 0);
  assert.match(body.out, /^tree [0-9a-f]{40}$/m);
  assert.match(body.out, /second commit/);

  const tree = /^tree ([0-9a-f]{40})$/m.exec(body.out)[1];
  const listing = runMine(["ls-tree", "--name-only", tree], { cwd: target });
  assertExit(listing, 0);
  assert.match(listing.out, /^README\.md$/m);
});

test("clone resolves deltified objects in the packfile", () => {
  const { target } = cloneInto("deltas");
  assertWorkingTreeMatches(target, sources.deltas.work);
  assertExit(runGit(["fsck"], { cwd: target }), 0);
});

test("the deltified clone's history matches the source", () => {
  const { target } = cloneInto("deltas");
  const ours = runGit(["log", "--format=%H %s"], { cwd: target });
  const theirs = git(["log", "--format=%H %s"], { cwd: sources.deltas.work });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out);
});

test("clone follows a default branch other than main", () => {
  const { target } = cloneInto("master-branch");
  assert.strictEqual(fs.readFileSync(path.join(target, ".git", "HEAD"), "utf8"), "ref: refs/heads/master\n");
  assert.strictEqual(fs.readFileSync(path.join(target, "only.txt"), "utf8"), "on master\n");
});

test("clone derives the directory name from the URL when none is given", () => {
  const workspace = tmpDir("mygit-clone-default-");
  const result = runMine(["clone", `${server.url}/basic.git`], { cwd: workspace });
  assertExit(result, 0);
  assert.ok(fs.existsSync(path.join(workspace, "basic", ".git")), "expected the clone to land in ./basic");
});

test("clone of an empty repository succeeds and creates the repository", () => {
  const { result, target } = cloneInto("empty");
  assertExit(result, 0);
  assert.ok(fs.existsSync(path.join(target, ".git", "HEAD")), "expected an initialized repository");
});

test("clone fails without a stack trace when the repository does not exist", () => {
  const workspace = tmpDir("mygit-clone-missing-");
  const result = runMine(["clone", `${server.url}/does-not-exist.git`, "out"], { cwd: workspace });
  assert.notStrictEqual(result.code, 0, "expected a non-zero exit code for a missing repository");
  assertNoStackTrace(result);
  assert.notStrictEqual(result.err.trim(), "", "expected a diagnostic on stderr");
});

test("clone refuses a target directory that already has contents", () => {
  const workspace = tmpDir("mygit-clone-occupied-");
  materialize(workspace, { "taken/existing.txt": "in the way\n" });
  const result = runMine(["clone", `${server.url}/basic.git`, "taken"], { cwd: workspace });
  assert.notStrictEqual(result.code, 0, "expected a non-zero exit code for an occupied directory");
  assertNoStackTrace(result);
});

test("clone fails without a stack trace for an unreachable host", () => {
  const workspace = tmpDir("mygit-clone-unreachable-");
  const result = runMine(["clone", "http://127.0.0.1:1/nope.git", "out"], { cwd: workspace });
  assert.notStrictEqual(result.code, 0, "expected a non-zero exit code for an unreachable host");
  assertNoStackTrace(result);
});

// A server that has agreed to ofs-delta never sends OBJ_REF_DELTA, so the
// integration tests above cannot reach that branch. This builds such a pack
// by hand and unpacks it directly.
const { unpack } = require("../../app/git/pack");
const { hashObject } = require("../../app/git/repository");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

function variableLength(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function entryHeader(type, size) {
  const bytes = [];
  let byte = (type << 4) | (size & 0x0f);
  let remaining = size >> 4;
  while (remaining > 0) {
    bytes.push(byte | 0x80);
    byte = remaining & 0x7f;
    remaining >>= 7;
  }
  bytes.push(byte);
  return Buffer.from(bytes);
}

function buildRefDeltaPack(base, appended) {
  const baseSha = hashObject("blob", base);
  const result = Buffer.concat([base, appended]);

  const copy = Buffer.concat([
    Buffer.from([0x80 | 0x10]),
    Buffer.from([base.length & 0xff]),
  ]);
  const insert = Buffer.concat([Buffer.from([appended.length]), appended]);
  const delta = Buffer.concat([
    variableLength(base.length),
    variableLength(result.length),
    copy,
    insert,
  ]);

  const header = Buffer.alloc(12);
  header.write("PACK", 0, "ascii");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(2, 8);

  const body = Buffer.concat([
    header,
    entryHeader(3, base.length),
    zlib.deflateSync(base),
    entryHeader(7, delta.length),
    Buffer.from(baseSha, "hex"),
    zlib.deflateSync(delta),
  ]);

  return {
    pack: Buffer.concat([body, crypto.createHash("sha1").update(body).digest()]),
    result,
  };
}

test("the packfile reader resolves OBJ_REF_DELTA objects", () => {
  const base = Buffer.from("x".repeat(200));
  const appended = Buffer.from("appended tail\n");
  const { pack, result } = buildRefDeltaPack(base, appended);

  const objects = unpack(pack, hashObject);

  assert.strictEqual(objects.length, 2);
  const resolved = objects.find((object) => object.sha === hashObject("blob", result));
  assert.ok(resolved, "the deltified object was not resolved to the expected content");
  assert.strictEqual(resolved.type, "blob");
  assert.ok(resolved.data.equals(result), "delta application produced the wrong bytes");
});
