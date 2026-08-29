"use strict";

// Stage 3: Create a blob object
//
// `hash-object` computes a blob's SHA-1 and, with -w, writes the compressed
// object into .git/objects. Comparison is done on the inflated bytes: the
// zlib compression level is not part of the object format, so the file on
// disk is legitimately allowed to differ from git's byte for byte.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const {
  mineRepo,
  oracleRepo,
  materialize,
  readObject,
  objectExists,
  hashObject,
  binaryBlob,
} = require("../helpers/fixtures");
const {
  assertExit,
  assertFatal,
  assertStdout,
  assertNoStackTrace,
} = require("../helpers/assertions");

const EMPTY_BLOB_SHA = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

test("hash-object prints the same SHA the real git binary prints", () => {
  const files = { "sample.txt": "hello world\n" };
  const mine = mineRepo(files);
  const oracle = oracleRepo(files);
  const ours = runMine(["hash-object", "sample.txt"], { cwd: mine });
  const theirs = runGit(["hash-object", "sample.txt"], { cwd: oracle });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "SHA differs from the one computed by git");
});

test("hash-object without -w does not write anything into .git/objects", () => {
  const repo = mineRepo({ "unwritten.txt": "not persisted\n" });
  const res = runMine(["hash-object", "unwritten.txt"], { cwd: repo });
  assertExit(res, 0);
  const sha = res.out.trim();
  assert.ok(!objectExists(repo, sha), `object ${sha} was written even though -w was not given`);
});

test("hash-object -w writes an object whose inflated bytes are a valid blob", () => {
  const contents = "persist me\n";
  const repo = mineRepo({ "written.txt": contents });
  const res = runMine(["hash-object", "-w", "written.txt"], { cwd: repo });
  assertExit(res, 0);
  const sha = res.out.trim();
  const object = readObject(repo, sha);
  assert.strictEqual(object.type, "blob");
  assert.strictEqual(object.size, Buffer.byteLength(contents));
  assert.strictEqual(object.body.toString("utf8"), contents);
});

test("hash-object -w stores the object at .git/objects/<first 2>/<remaining 38>", () => {
  const repo = mineRepo({ "layout.txt": "path layout\n" });
  const sha = runMine(["hash-object", "-w", "layout.txt"], { cwd: repo }).out.trim();
  assert.strictEqual(sha.length, 40, `expected a 40 character SHA, got ${JSON.stringify(sha)}`);
  const full = path.join(repo, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  assert.ok(fs.existsSync(full), `expected the object at .git/objects/${sha.slice(0, 2)}/${sha.slice(2)}`);
});

test("an object we write is readable by the real git binary", () => {
  const contents = "interoperability matters\n";
  const repo = mineRepo({ "interop.txt": contents });
  const sha = runMine(["hash-object", "-w", "interop.txt"], { cwd: repo }).out.trim();
  const res = runGit(["cat-file", "-p", sha], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, contents);
});

test("hash-object handles an empty file", () => {
  const repo = mineRepo({ "empty.txt": "" });
  const res = runMine(["hash-object", "-w", "empty.txt"], { cwd: repo });
  assertStdout(res, `${EMPTY_BLOB_SHA}\n`);
});

test("hash-object treats file content as bytes, not text", () => {
  const payload = binaryBlob(3, 8192);
  const repo = mineRepo({ "payload.bin": payload });
  const res = runMine(["hash-object", "-w", "payload.bin"], { cwd: repo });
  assertExit(res, 0);
  const sha = res.out.trim();
  assert.strictEqual(sha, hashObject("blob", payload), "SHA does not match the blob hash of the raw bytes");
  assert.ok(readObject(repo, sha).body.equals(payload), "stored body differs from the original bytes");
});

test("hash-object accepts a path in a subdirectory", () => {
  const repo = mineRepo({ "nested/deep/file.txt": "down here\n" });
  const res = runMine(["hash-object", "-w", "nested/deep/file.txt"], { cwd: repo });
  assertStdout(res, `${hashObject("blob", "down here\n")}\n`);
});

test("hash-object runs from a subdirectory of the repository", () => {
  const repo = mineRepo({ "nested/file.txt": "relative to cwd\n" });
  const res = runMine(["hash-object", "-w", "file.txt"], { cwd: path.join(repo, "nested") });
  assertExit(res, 0);
  const sha = res.out.trim();
  assert.strictEqual(sha, hashObject("blob", "relative to cwd\n"));
  assert.ok(objectExists(repo, sha), "object was not written into the repository's .git/objects");
});

test("hash-object -t accepts an explicit object type", () => {
  const body = `tree ${"0".repeat(40)}\n`;
  const repo = mineRepo({ "typed.txt": body });
  const res = runMine(["hash-object", "-t", "commit", "-w", "typed.txt"], { cwd: repo });
  assertExit(res, 0);
  const sha = res.out.trim();
  assert.strictEqual(sha, hashObject("commit", body), "SHA was not computed with the requested type");
  assert.strictEqual(readObject(repo, sha).type, "commit", "stored object header does not use the requested type");
});

test("hash-object fails with exit code 128 for a missing file", () => {
  const repo = mineRepo();
  assertFatal(runMine(["hash-object", "-w", "missing.txt"], { cwd: repo }), /missing\.txt/);
});

test("hash-object fails with exit code 128 for a directory", () => {
  const repo = mineRepo();
  materialize(repo, { "adir/child.txt": "x\n" });
  assertFatal(runMine(["hash-object", "-w", "adir"], { cwd: repo }), /adir/);
});

test("hash-object fails without a path argument", () => {
  const repo = mineRepo();
  const res = runMine(["hash-object", "-w"], { cwd: repo });
  assert.notStrictEqual(res.code, 0, "expected a non-zero exit code when no path is given");
  assertNoStackTrace(res);
});
