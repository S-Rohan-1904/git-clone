"use strict";

// Stage 12: Ignore rules
//
// The pattern language has more corners than it looks: * and ? stop at a
// directory separator but ** crosses one, a leading / anchors to the
// containing directory, a trailing / matches directories only, and ! negates
// an earlier match with last-match-wins precedence.

const assert = require("node:assert");
const { test } = require("node:test");

const { runMine, runGit } = require("../helpers/spawn");
const { mineRepo, materialize } = require("../helpers/fixtures");
const { assertMatchesGit } = require("../helpers/assertions");

// check-ignore exits 1 when nothing matches, so comparing exit codes as well
// as output is part of the contract.
function bothCheck(repo, paths) {
  assertMatchesGit(runMine(["check-ignore", ...paths], { cwd: repo }), runGit(["check-ignore", ...paths], { cwd: repo }));
}

function repoWith(ignore, files) {
  return mineRepo({ ".gitignore": ignore, ...files });
}

test("a literal name is ignored", () => {
  const repo = repoWith("secret.txt\n", { "secret.txt": "s\n", "public.txt": "p\n" });
  bothCheck(repo, ["secret.txt", "public.txt"]);
});

test("a * wildcard matches within one path segment", () => {
  const repo = repoWith("*.log\n", { "debug.log": "d\n", "nested/deep.log": "n\n", "notes.txt": "t\n" });
  bothCheck(repo, ["debug.log", "nested/deep.log", "notes.txt"]);
});

test("a ? wildcard matches a single character", () => {
  const repo = repoWith("file?.txt\n", { "file1.txt": "1\n", "file12.txt": "2\n" });
  bothCheck(repo, ["file1.txt", "file12.txt"]);
});

test("a trailing slash matches directories only", () => {
  const repo = repoWith("build/\n", { "build/output.o": "o\n", "build.txt": "b\n" });
  bothCheck(repo, ["build/output.o", "build.txt"]);
});

test("a leading slash anchors the pattern to the repository root", () => {
  const repo = repoWith("/root.txt\n", { "root.txt": "r\n", "nested/root.txt": "n\n" });
  bothCheck(repo, ["root.txt", "nested/root.txt"]);
});

test("an unanchored pattern matches at any depth", () => {
  const repo = repoWith("target\n", { "target/a.txt": "a\n", "nested/target/b.txt": "b\n" });
  bothCheck(repo, ["target/a.txt", "nested/target/b.txt"]);
});

test("a pattern containing a slash is anchored", () => {
  const repo = repoWith("doc/notes.txt\n", { "doc/notes.txt": "d\n", "nested/doc/notes.txt": "n\n" });
  bothCheck(repo, ["doc/notes.txt", "nested/doc/notes.txt"]);
});

test("** crosses directory separators", () => {
  const repo = repoWith("logs/**/*.log\n", {
    "logs/a.log": "a\n",
    "logs/deep/b.log": "b\n",
    "logs/deep/deeper/c.log": "c\n",
  });
  bothCheck(repo, ["logs/a.log", "logs/deep/b.log", "logs/deep/deeper/c.log"]);
});

test("a leading ** matches at any depth", () => {
  const repo = repoWith("**/temp\n", { "temp/a.txt": "a\n", "nested/temp/b.txt": "b\n" });
  bothCheck(repo, ["temp/a.txt", "nested/temp/b.txt"]);
});

test("! negates an earlier pattern", () => {
  const repo = repoWith("*.log\n!keep.log\n", { "debug.log": "d\n", "keep.log": "k\n" });
  bothCheck(repo, ["debug.log", "keep.log"]);
});

test("the last matching pattern in a file wins", () => {
  const repo = repoWith("!important.log\n*.log\n", { "important.log": "i\n" });
  bothCheck(repo, ["important.log"]);
});

test("a nested .gitignore applies to its own directory", () => {
  const repo = mineRepo({
    ".gitignore": "*.txt\n",
    "nested/.gitignore": "!allowed.txt\n",
    "nested/allowed.txt": "a\n",
    "nested/blocked.txt": "b\n",
    "top.txt": "t\n",
  });
  bothCheck(repo, ["top.txt", "nested/allowed.txt", "nested/blocked.txt"]);
});

test("blank lines and comments are skipped", () => {
  const repo = repoWith("\n# a comment\n\n*.tmp\n", { "scratch.tmp": "s\n", "#a comment": "c\n" });
  bothCheck(repo, ["scratch.tmp"]);
});

test(".git/info/exclude is honoured", () => {
  const repo = mineRepo({ "local.txt": "l\n", "other.txt": "o\n" });
  materialize(repo, { ".git/info/exclude": "local.txt\n" });
  bothCheck(repo, ["local.txt", "other.txt"]);
});

test("a file inside an ignored directory is ignored", () => {
  const repo = repoWith("build/\n", { "build/deep/nested/out.o": "o\n" });
  bothCheck(repo, ["build/deep/nested/out.o"]);
});

test("check-ignore exits 1 when nothing matches", () => {
  const repo = repoWith("*.log\n", { "notes.txt": "n\n" });
  const res = runMine(["check-ignore", "notes.txt"], { cwd: repo });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(res.out, "");
});

test("ignored files do not appear as untracked in status", () => {
  const repo = repoWith("*.log\nbuild/\n", { "tracked.txt": "t\n", "debug.log": "d\n", "build/out.o": "o\n" });
  assertMatchesGit(
    runMine(["status", "--porcelain"], { cwd: repo }),
    runGit(["status", "--porcelain"], { cwd: repo }),
  );
});
