"use strict";

// Stage 11: The index
//
// .git/index v2 is a binary file: a DIRC header, then one record per staged
// path carrying stat data, mode, SHA and flags, each NUL-padded to a multiple
// of eight bytes, then a SHA-1 over everything before it. Both directions are
// tested -- we must read what `git add` wrote, and real git must accept what
// we wrote.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize } = require("../helpers/fixtures");
const { assertExit, assertStdout, assertMatchesGit } = require("../helpers/assertions");
const { readIndex, writeIndex, entryFromStat } = require("../../app/git/index-file");
const { hashObject, writeObject } = require("../../app/git/repository");

function staged(files, mutate) {
  const repo = mineRepo(files);
  if (mutate) mutate(repo);
  git(["add", "-A"], { cwd: repo });
  return repo;
}

test("ls-files lists staged paths", () => {
  const repo = staged({ "a.txt": "a\n", "b.txt": "b\n" });
  assertMatchesGit(runMine(["ls-files"], { cwd: repo }), runGit(["ls-files"], { cwd: repo }));
});

test("ls-files --stage matches the real git binary", () => {
  const repo = staged({ "a.txt": "a\n", "nested/deep/c.txt": "c\n" });
  assertMatchesGit(runMine(["ls-files", "--stage"], { cwd: repo }), runGit(["ls-files", "--stage"], { cwd: repo }));
});

test("ls-files sorts paths by raw bytes, not by directory grouping", () => {
  const repo = staged({ "hello.c": "c\n", "hello/inner.txt": "i\n", "hello-world.txt": "w\n" });
  assertMatchesGit(runMine(["ls-files"], { cwd: repo }), runGit(["ls-files"], { cwd: repo }));
});

test("ls-files reports the executable mode", () => {
  const repo = staged({ "run.sh": "#!/bin/sh\n" }, (dir) => fs.chmodSync(path.join(dir, "run.sh"), 0o755));
  const res = runMine(["ls-files", "--stage"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^100755 [0-9a-f]{40} 0\trun\.sh$/m);
});

test("ls-files reports a symlink with mode 120000", () => {
  const repo = staged({ "target.txt": "t\n" }, (dir) => fs.symlinkSync("target.txt", path.join(dir, "link.txt")));
  const res = runMine(["ls-files", "--stage"], { cwd: repo });
  assert.match(res.out, /^120000 [0-9a-f]{40} 0\tlink\.txt$/m);
});

test("ls-files handles paths containing spaces", () => {
  const repo = staged({ "with space.txt": "s\n" });
  assertStdout(runMine(["ls-files"], { cwd: repo }), "with space.txt\n");
});

test("ls-files prints nothing when the index is empty", () => {
  const repo = mineRepo();
  const res = runMine(["ls-files"], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "");
});

test("the reader recovers the stat fields git recorded", () => {
  const repo = staged({ "a.txt": "hello world\n" });
  const { entries } = readIndex(path.join(repo, ".git"));
  const entry = entries[0];
  const stats = fs.statSync(path.join(repo, "a.txt"));

  assert.strictEqual(entry.path, "a.txt");
  assert.strictEqual(entry.size, stats.size);
  assert.strictEqual(entry.mode, 0o100644);
  assert.strictEqual(entry.inode, stats.ino);
  assert.strictEqual(entry.sha, hashObject("blob", "hello world\n"));
  assert.strictEqual(entry.stage, 0);
});

test("rewriting git's index preserves every entry", () => {
  const repo = staged({ "a.txt": "a\n", "sub/b.txt": "b\n", "run.sh": "x\n" });
  const gitDir = path.join(repo, ".git");
  const before = runGit(["ls-files", "--stage"], { cwd: repo });

  writeIndex(gitDir, readIndex(gitDir).entries);

  assertMatchesGit(runGit(["ls-files", "--stage"], { cwd: repo }), before);
});

test("an index we rewrote is byte-identical to git's", () => {
  const repo = staged({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  const gitDir = path.join(repo, ".git");
  const original = fs.readFileSync(path.join(gitDir, "index"));

  writeIndex(gitDir, readIndex(gitDir).entries);

  assert.ok(
    fs.readFileSync(path.join(gitDir, "index")).equals(original),
    "the rewritten index differs from the one git wrote",
  );
});

test("git reports a clean tree after we rewrite the index", () => {
  const repo = staged({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  const gitDir = path.join(repo, ".git");
  git(["commit", "-q", "-m", "initial"], { cwd: repo });

  writeIndex(gitDir, readIndex(gitDir).entries);

  const status = runGit(["status", "--porcelain"], { cwd: repo });
  assertExit(status, 0);
  assert.strictEqual(status.out, "", `expected a clean tree, got:\n${status.out}`);
});

test("an index we build from scratch is accepted by the real git binary", () => {
  const repo = mineRepo({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  const gitDir = path.join(repo, ".git");

  const entries = ["a.txt", "sub/b.txt"].map((relative) => {
    const full = path.join(repo, relative);
    const sha = writeObject("blob", fs.readFileSync(full), gitDir);
    return entryFromStat(full, relative, sha, 0o100644);
  });

  writeIndex(gitDir, entries);

  assertMatchesGit(
    runGit(["ls-files", "--stage"], { cwd: repo }),
    runMine(["ls-files", "--stage"], { cwd: repo }),
  );
  assert.strictEqual(runGit(["status", "--porcelain"], { cwd: repo }).out, "A  a.txt\nA  sub/b.txt\n");
});

test("entries we write are padded so git can walk them", () => {
  const repo = mineRepo();
  const gitDir = path.join(repo, ".git");

  const names = ["a", "bb", "ccc", "dddddd", "e".repeat(40), "f".repeat(63)];
  const entries = names.map((name) => {
    materialize(repo, { [name]: `${name}\n` });
    const full = path.join(repo, name);
    const sha = writeObject("blob", fs.readFileSync(full), gitDir);
    return entryFromStat(full, name, sha, 0o100644);
  });

  writeIndex(gitDir, entries);

  const listed = runGit(["ls-files"], { cwd: repo });
  assertExit(listed, 0);
  assert.deepStrictEqual(listed.out.trim().split("\n"), [...names].sort());
});

test("a deeply nested path survives a write and read cycle", () => {
  const relative = "a/b/c/d/e/f/g/deeply-nested-file-name.txt";
  const repo = mineRepo({ [relative]: "deep\n" });
  const gitDir = path.join(repo, ".git");
  const full = path.join(repo, relative);
  const sha = writeObject("blob", fs.readFileSync(full), gitDir);

  writeIndex(gitDir, [entryFromStat(full, relative, sha, 0o100644)]);

  assert.strictEqual(readIndex(gitDir).entries[0].path, relative);
  assertStdout(runGit(["ls-files"], { cwd: repo }), `${relative}\n`);
});

test("writeIndex sorts entries even when handed them out of order", () => {
  const repo = mineRepo({ "z.txt": "z\n", "a.txt": "a\n" });
  const gitDir = path.join(repo, ".git");

  const entries = ["z.txt", "a.txt"].map((relative) => {
    const full = path.join(repo, relative);
    return entryFromStat(full, relative, writeObject("blob", fs.readFileSync(full), gitDir), 0o100644);
  });

  writeIndex(gitDir, entries);
  assertStdout(runGit(["ls-files"], { cwd: repo }), "a.txt\nz.txt\n");
});

test("the index checksum we write validates", () => {
  const repo = staged({ "a.txt": "a\n" });
  const gitDir = path.join(repo, ".git");
  writeIndex(gitDir, readIndex(gitDir).entries);

  const verified = runGit(["fsck"], { cwd: repo });
  assertExit(verified, 0);
});
