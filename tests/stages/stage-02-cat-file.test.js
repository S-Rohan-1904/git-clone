"use strict";

// Stage 2: Read a blob object
//
// `cat-file` reads a loose object out of .git/objects. Objects are written
// here by the real git binary, so passing these tests proves we can read
// genuine git data rather than only our own output.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, binaryBlob } = require("../helpers/fixtures");
const {
  assertExit,
  assertFatal,
  assertStdout,
  assertStdoutBytes,
  assertMatchesGit,
  assertNoStackTrace,
} = require("../helpers/assertions");

// Writes a blob into our repository using the real git binary and returns its
// SHA, so the object under test is known-good git data.
function seedBlob(repo, name, contents) {
  fs.writeFileSync(path.join(repo, name), Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  return git(["hash-object", "-w", name], { cwd: repo }).out.trim();
}

test("cat-file -p prints the contents of a blob", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "hello.txt", "hello world\n");
  assertStdout(runMine(["cat-file", "-p", sha], { cwd: repo }), "hello world\n");
});

test("cat-file -p does not append a trailing newline of its own", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "no-newline.txt", "no trailing newline");
  assertStdout(runMine(["cat-file", "-p", sha], { cwd: repo }), "no trailing newline");
});

test("cat-file -p handles an empty blob", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "empty.txt", "");
  assertStdout(runMine(["cat-file", "-p", sha], { cwd: repo }), "");
});

test("cat-file -p writes binary content through unmodified", () => {
  const repo = mineRepo();
  const payload = binaryBlob(7, 4096);
  const sha = seedBlob(repo, "blob.bin", payload);
  assertStdoutBytes(runMine(["cat-file", "-p", sha], { cwd: repo }), payload);
});

test("cat-file -p handles content containing null bytes", () => {
  const repo = mineRepo();
  const payload = Buffer.from("before\0after\0\0end");
  const sha = seedBlob(repo, "nulls.bin", payload);
  assertStdoutBytes(runMine(["cat-file", "-p", sha], { cwd: repo }), payload);
});

test("cat-file -p output matches the real git binary", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "compare.txt", "line one\nline two\n");
  assertMatchesGit(
    runMine(["cat-file", "-p", sha], { cwd: repo }),
    runGit(["cat-file", "-p", sha], { cwd: repo }),
  );
});

test("cat-file -t prints the object type", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "typed.txt", "some content\n");
  assertStdout(runMine(["cat-file", "-t", sha], { cwd: repo }), "blob\n");
});

test("cat-file -s prints the object size in bytes", () => {
  const repo = mineRepo();
  const payload = binaryBlob(11, 1234);
  const sha = seedBlob(repo, "sized.bin", payload);
  assertStdout(runMine(["cat-file", "-s", sha], { cwd: repo }), "1234\n");
});

test("cat-file -e exits 0 and prints nothing for an object that exists", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "exists.txt", "here\n");
  const res = runMine(["cat-file", "-e", sha], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "", "expected no stdout for cat-file -e");
});

test("cat-file -e exits 1 for an object that is missing", () => {
  const repo = mineRepo();
  const res = runMine(["cat-file", "-e", "1111111111111111111111111111111111111111"], { cwd: repo });
  assertExit(res, 1);
  assertNoStackTrace(res);
  assert.strictEqual(res.out, "", "expected no stdout for cat-file -e");
});

test("cat-file resolves an abbreviated object name", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "abbrev.txt", "abbreviated lookup\n");
  assertStdout(runMine(["cat-file", "-p", sha.slice(0, 6)], { cwd: repo }), "abbreviated lookup\n");
});

test("cat-file works from a subdirectory of the repository", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "root.txt", "found from below\n");
  const nested = path.join(repo, "sub", "deeper");
  fs.mkdirSync(nested, { recursive: true });
  assertStdout(runMine(["cat-file", "-p", sha], { cwd: nested }), "found from below\n");
});

test("cat-file fails with exit code 128 for a missing object", () => {
  const repo = mineRepo();
  const res = runMine(["cat-file", "-p", "0000000000000000000000000000000000000000"], { cwd: repo });
  assertFatal(res, /not a valid object name/i);
});

test("cat-file fails with exit code 128 for a malformed object name", () => {
  const repo = mineRepo();
  const res = runMine(["cat-file", "-p", "zz"], { cwd: repo });
  assertFatal(res);
});

test("cat-file rejects an unknown flag instead of exiting successfully", () => {
  const repo = mineRepo();
  const sha = seedBlob(repo, "flagged.txt", "content\n");
  const res = runMine(["cat-file", "-q", sha], { cwd: repo });
  assert.notStrictEqual(res.code, 0, "expected a non-zero exit code for an unknown flag");
  assertNoStackTrace(res);
});
