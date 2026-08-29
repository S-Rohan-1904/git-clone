"use strict";

const assert = require("node:assert");

function describeResult(res) {
  return [
    `command: ${res.command}`,
    `exit code: ${res.code}${res.signal ? ` (signal ${res.signal})` : ""}`,
    `stdout: ${JSON.stringify(res.out)}`,
    `stderr: ${JSON.stringify(res.err)}`,
  ].join("\n");
}

function assertExit(res, expected) {
  assert.strictEqual(res.code, expected, `expected exit code ${expected}\n${describeResult(res)}`);
}

// An uncaught JavaScript exception leaks a stack trace to stderr. Real git
// prints a single diagnostic line instead, and so should we.
function assertNoStackTrace(res) {
  assert.ok(
    !/^\s+at\s/m.test(res.err),
    `stderr contains a JavaScript stack trace; print a diagnostic line instead\n${describeResult(res)}`,
  );
}

// git reports usage errors on stderr with exit code 128 and a "fatal:" prefix.
function assertFatal(res, pattern) {
  assertExit(res, 128);
  assertNoStackTrace(res);
  assert.match(res.err, /fatal:/i, `expected a "fatal:" diagnostic on stderr\n${describeResult(res)}`);
  if (pattern) {
    assert.match(res.err, pattern, `stderr did not match ${pattern}\n${describeResult(res)}`);
  }
  assert.strictEqual(res.out, "", `expected nothing on stdout for a fatal error\n${describeResult(res)}`);
}

function assertStdout(res, expected) {
  assertExit(res, 0);
  assert.strictEqual(res.out, expected, `unexpected stdout\n${describeResult(res)}`);
}

function assertStdoutBytes(res, expected) {
  assertExit(res, 0);
  assert.ok(
    res.stdout.equals(Buffer.isBuffer(expected) ? expected : Buffer.from(expected)),
    `stdout bytes did not match expectation\n${describeResult(res)}`,
  );
}

// Compares our stdout against the same command run through the real git binary.
function assertMatchesGit(mineRes, gitRes) {
  assert.strictEqual(
    mineRes.out,
    gitRes.out,
    `stdout differs from real git\n--- ours ---\n${describeResult(mineRes)}\n--- git ---\n${describeResult(gitRes)}`,
  );
  assert.strictEqual(
    mineRes.code,
    gitRes.code,
    `exit code differs from real git\n--- ours ---\n${describeResult(mineRes)}\n--- git ---\n${describeResult(gitRes)}`,
  );
}

module.exports = {
  describeResult,
  assertExit,
  assertNoStackTrace,
  assertFatal,
  assertStdout,
  assertStdoutBytes,
  assertMatchesGit,
};
