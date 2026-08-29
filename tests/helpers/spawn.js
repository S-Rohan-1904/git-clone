"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_ENTRY = path.join(REPO_ROOT, "app", "main.js");

// Fixed identity and timestamps keep commit SHAs reproducible, so the same
// input always produces the same object in both our implementation and the
// reference git binary.
const FIXED_IDENTITY = {
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Committer",
  GIT_COMMITTER_EMAIL: "committer@example.com",
  GIT_AUTHOR_DATE: "1700000000 +0000",
  GIT_COMMITTER_DATE: "1700000000 +0000",
};

function baseEnv(extra) {
  return {
    ...process.env,
    // Isolate the reference binary from the developer's own git configuration.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    ...FIXED_IDENTITY,
    ...extra,
  };
}

function toResult(res, display) {
  if (res.error) {
    throw new Error(`failed to spawn \`${display}\`: ${res.error.message}`);
  }
  const stdout = res.stdout || Buffer.alloc(0);
  const stderr = res.stderr || Buffer.alloc(0);
  return {
    command: display,
    code: res.status,
    signal: res.signal,
    stdout,
    stderr,
    out: stdout.toString("utf8"),
    err: stderr.toString("utf8"),
  };
}

function spawnOptions(opts) {
  return {
    cwd: opts.cwd,
    env: baseEnv(opts.env),
    input: opts.input,
    timeout: opts.timeout || 30000,
    maxBuffer: 64 * 1024 * 1024,
  };
}

// Runs the implementation under test.
function runMine(args, opts = {}) {
  const res = spawnSync(process.execPath, [APP_ENTRY, ...args], spawnOptions(opts));
  return toResult(res, `app/main.js ${args.join(" ")}`);
}

// Runs the real git binary, used as the oracle in differential tests.
function runGit(args, opts = {}) {
  const res = spawnSync("git", args, spawnOptions(opts));
  return toResult(res, `git ${args.join(" ")}`);
}

// Same as runGit but throws when git fails, for oracle setup steps where a
// failure means the test itself is broken rather than the implementation.
function git(args, opts = {}) {
  const res = runGit(args, opts);
  if (res.code !== 0) {
    throw new Error(`oracle setup failed: \`${res.command}\` exited ${res.code}\n${res.err}`);
  }
  return res;
}

module.exports = { runMine, runGit, git, REPO_ROOT, APP_ENTRY, FIXED_IDENTITY };
