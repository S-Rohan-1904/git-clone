"use strict";

// Stage 6: Create a commit
//
// `commit-tree <tree> [-p <parent>] -m <message>` writes a commit object. Its
// body is:
//
//   tree <sha>\n
//   parent <sha>\n          (once per parent, omitted for a root commit)
//   author <name> <<email>> <timestamp> <timezone>\n
//   committer <name> <<email>> <timestamp> <timezone>\n
//   \n
//   <message>\n
//
// Identity and timestamp come from the GIT_AUTHOR_* / GIT_COMMITTER_*
// environment variables, which the test harness pins to fixed values. Reading
// them is what lets a commit SHA be compared against the one git produces.

const assert = require("node:assert");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize, readObject } = require("../helpers/fixtures");
const { assertExit, assertFatal } = require("../helpers/assertions");

function seedTree(repo, files = { "a.txt": "a\n" }) {
  materialize(repo, files);
  git(["add", "-A"], { cwd: repo });
  return git(["write-tree"], { cwd: repo }).out.trim();
}

function commitBody(repo, sha) {
  const object = readObject(repo, sha);
  assert.strictEqual(object.type, "commit", `expected a commit object, got ${object.type}`);
  return object.body.toString("utf8");
}

test("commit-tree prints a 40 character SHA", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const res = runMine(["commit-tree", tree, "-m", "initial commit"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^[0-9a-f]{40}\n$/, "expected a single 40 character SHA followed by a newline");
});

test("commit-tree writes an object of type commit", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "typed"], { cwd: repo }).out.trim();
  assert.strictEqual(readObject(repo, sha).type, "commit");
});

test("a root commit body starts with the tree line and has no parent line", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "root"], { cwd: repo }).out.trim();
  const body = commitBody(repo, sha);
  assert.ok(body.startsWith(`tree ${tree}\n`), `body should start with "tree ${tree}", got:\n${body}`);
  assert.ok(!/^parent /m.test(body), `a root commit must not have a parent line, got:\n${body}`);
});

test("commit-tree records the parent given with -p", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const parent = runMine(["commit-tree", tree, "-m", "first"], { cwd: repo }).out.trim();
  const child = runMine(["commit-tree", tree, "-p", parent, "-m", "second"], { cwd: repo }).out.trim();
  const body = commitBody(repo, child);
  assert.ok(
    body.startsWith(`tree ${tree}\nparent ${parent}\n`),
    `expected the parent line directly after the tree line, got:\n${body}`,
  );
});

test("commit-tree accepts more than one -p for a merge commit", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const a = runMine(["commit-tree", tree, "-m", "branch a"], { cwd: repo }).out.trim();
  const b = runMine(["commit-tree", tree, "-m", "branch b"], { cwd: repo }).out.trim();
  const merge = runMine(["commit-tree", tree, "-p", a, "-p", b, "-m", "merge"], { cwd: repo });
  assertExit(merge, 0);
  const body = commitBody(repo, merge.out.trim());
  assert.match(body, new RegExp(`^parent ${a}$`, "m"));
  assert.match(body, new RegExp(`^parent ${b}$`, "m"));
});

test("author and committer lines use the git identity format", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "identity"], { cwd: repo }).out.trim();
  const body = commitBody(repo, sha);
  assert.match(body, /^author .+ <.+@.+> \d+ [+-]\d{4}$/m, `missing or malformed author line:\n${body}`);
  assert.match(body, /^committer .+ <.+@.+> \d+ [+-]\d{4}$/m, `missing or malformed committer line:\n${body}`);
});

test("commit-tree reads the identity from the GIT_AUTHOR_* environment variables", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "env identity"], { cwd: repo }).out.trim();
  const body = commitBody(repo, sha);
  assert.match(body, /^author Test Author <author@example\.com> 1700000000 \+0000$/m, `unexpected author line:\n${body}`);
  assert.match(
    body,
    /^committer Test Committer <committer@example\.com> 1700000000 \+0000$/m,
    `unexpected committer line:\n${body}`,
  );
});

test("the message is separated from the header by a blank line and ends with a newline", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "a message"], { cwd: repo }).out.trim();
  const body = commitBody(repo, sha);
  assert.ok(body.endsWith("\n\na message\n"), `unexpected message encoding at the end of:\n${body}`);
});

test("commit-tree produces the same SHA as the real git binary", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const ours = runMine(["commit-tree", tree, "-m", "identical input"], { cwd: repo });
  const theirs = runGit(["commit-tree", tree, "-m", "identical input"], { cwd: repo });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "commit SHA differs from git's for identical input and environment");
});

test("commit-tree with a parent produces the same SHA as the real git binary", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const parent = git(["commit-tree", tree, "-m", "first"], { cwd: repo }).out.trim();
  const ours = runMine(["commit-tree", tree, "-p", parent, "-m", "second"], { cwd: repo });
  const theirs = runGit(["commit-tree", tree, "-p", parent, "-m", "second"], { cwd: repo });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "commit SHA differs from git's for identical input and environment");
});

test("the commit we write is readable by the real git binary", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "readable"], { cwd: repo }).out.trim();
  const res = runGit(["cat-file", "-p", sha], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^tree [0-9a-f]{40}$/m);
  assert.match(res.out, /readable/);
});

test("the real git binary accepts the commit as a branch tip", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "branch tip"], { cwd: repo }).out.trim();
  git(["update-ref", "refs/heads/main", sha], { cwd: repo });
  const log = runGit(["log", "--oneline", "main"], { cwd: repo });
  assertExit(log, 0);
  assert.match(log.out, /branch tip/);
});

test("our own cat-file can read the commit we wrote", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const sha = runMine(["commit-tree", tree, "-m", "round trip"], { cwd: repo }).out.trim();
  const res = runMine(["cat-file", "-p", sha], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, new RegExp(`^tree ${tree}$`, "m"));
  assert.match(res.out, /^round trip$/m);
  assert.strictEqual(runMine(["cat-file", "-t", sha], { cwd: repo }).out, "commit\n");
});

test("commit-tree handles a multi-line message", () => {
  const repo = mineRepo();
  const tree = seedTree(repo);
  const message = "subject line\n\nbody paragraph one\nbody paragraph two";
  const ours = runMine(["commit-tree", tree, "-m", message], { cwd: repo });
  const theirs = runGit(["commit-tree", tree, "-m", message], { cwd: repo });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out);
});

test("commit-tree fails with exit code 128 for a missing tree", () => {
  const repo = mineRepo();
  assertFatal(runMine(["commit-tree", "0".repeat(40), "-m", "nope"], { cwd: repo }));
});

test("commit-tree fails with exit code 128 when the tree SHA is a blob", () => {
  const repo = mineRepo({ "blob.txt": "not a tree\n" });
  const blob = git(["hash-object", "-w", "blob.txt"], { cwd: repo }).out.trim();
  assertFatal(runMine(["commit-tree", blob, "-m", "nope"], { cwd: repo }));
});
