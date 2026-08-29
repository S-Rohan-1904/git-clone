"use strict";

// Stage 1: Initialize the .git directory
//
// `init` must create a repository layout that the real git binary is willing
// to operate on, so later stages can be verified against git itself.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit } = require("../helpers/spawn");
const { tmpDir } = require("../helpers/fixtures");
const { assertExit, assertNoStackTrace } = require("../helpers/assertions");

function initialized() {
  const dir = tmpDir("mygit-init-");
  const res = runMine(["init"], { cwd: dir });
  return { dir, res };
}

test("init exits 0 and reports success on stdout", () => {
  const { res } = initialized();
  assertExit(res, 0);
  assert.match(res.out, /Initialized git directory/);
});

test("init creates .git, .git/objects and .git/refs", () => {
  const { dir } = initialized();
  for (const rel of [".git", ".git/objects", ".git/refs"]) {
    const full = path.join(dir, rel);
    assert.ok(fs.existsSync(full), `expected ${rel} to exist`);
    assert.ok(fs.statSync(full).isDirectory(), `expected ${rel} to be a directory`);
  }
});

test("init writes HEAD pointing at refs/heads/main", () => {
  const { dir } = initialized();
  const head = fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8");
  assert.strictEqual(head, "ref: refs/heads/main\n");
});

test("init creates the refs/heads and refs/tags subdirectories", () => {
  const { dir } = initialized();
  for (const rel of [".git/refs/heads", ".git/refs/tags"]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `expected ${rel} to exist`);
  }
});

test("init creates the objects/info and objects/pack subdirectories", () => {
  const { dir } = initialized();
  for (const rel of [".git/objects/info", ".git/objects/pack"]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `expected ${rel} to exist`);
  }
});

test("init writes a .git/config file", () => {
  const { dir } = initialized();
  const config = path.join(dir, ".git", "config");
  assert.ok(fs.existsSync(config), "expected .git/config to exist");
  const contents = fs.readFileSync(config, "utf8");
  assert.match(contents, /\[core\]/, "expected a [core] section in .git/config");
  assert.match(contents, /repositoryformatversion\s*=\s*0/, "expected repositoryformatversion = 0");
});

test("the real git binary recognizes the repository we created", () => {
  const { dir } = initialized();
  const res = runGit(["rev-parse", "--git-dir"], { cwd: dir });
  assertExit(res, 0);
  assert.strictEqual(res.out.trim(), ".git");
});

test("init is idempotent when run twice in the same directory", () => {
  const { dir } = initialized();
  const second = runMine(["init"], { cwd: dir });
  assertExit(second, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8"),
    "ref: refs/heads/main\n",
  );
});

test("an unknown subcommand fails without leaking a stack trace", () => {
  const dir = tmpDir("mygit-unknown-");
  const res = runMine(["definitely-not-a-command"], { cwd: dir });
  assert.notStrictEqual(res.code, 0, "expected a non-zero exit code for an unknown subcommand");
  assertNoStackTrace(res);
  assert.notStrictEqual(res.err.trim(), "", "expected a diagnostic message on stderr");
});

test("running with no subcommand fails without leaking a stack trace", () => {
  const dir = tmpDir("mygit-nocmd-");
  const res = runMine([], { cwd: dir });
  assert.notStrictEqual(res.code, 0, "expected a non-zero exit code when no subcommand is given");
  assertNoStackTrace(res);
  assert.notStrictEqual(res.err.trim(), "", "expected a diagnostic message on stderr");
});
