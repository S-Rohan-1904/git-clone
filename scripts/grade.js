#!/usr/bin/env node
"use strict";

// A local stand-in for the CodeCrafters tester. Runs one stage's test file at a
// time, in order, and stops at the first stage that fails, so you always know
// exactly which stage you are on.
//
//   npm run grade            # run every stage, stop at the first failure
//   npm run grade -- 4       # run stage 4 only
//   npm run grade -- 2 3 4   # run stages 2, 3 and 4
//   npm run grade -- --all   # run every stage, do not stop at a failure

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const STAGES = require("./stages");
const ROOT = path.resolve(__dirname, "..");

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => color("32", t);
const red = (t) => color("31", t);
const yellow = (t) => color("33", t);
const dim = (t) => color("2", t);
const bold = (t) => color("1", t);

function parseArgs(argv) {
  const requested = [];
  let all = false;
  for (const arg of argv) {
    if (arg === "--all") {
      all = true;
    } else if (/^\d+$/.test(arg)) {
      requested.push(arg.padStart(2, "0"));
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return { requested, all };
}

// node --test's TAP output is flat as long as tests are declared with top-level
// `test()` calls, which lets us map each line straight onto one assertion.
function parseTap(output) {
  const results = [];
  let current = null;
  let inDiagnostics = false;

  for (const line of output.split("\n")) {
    const match = /^(not )?ok (\d+) - (.*)$/.exec(line);
    if (match) {
      current = { ok: !match[1], name: match[3].trim(), diagnostics: [] };
      results.push(current);
      inDiagnostics = false;
      continue;
    }
    if (!current) continue;
    if (/^\s+---\s*$/.test(line)) {
      inDiagnostics = true;
      continue;
    }
    if (/^\s+\.\.\.\s*$/.test(line)) {
      inDiagnostics = false;
      continue;
    }
    if (inDiagnostics) current.diagnostics.push(line);
  }
  return results;
}

function unindent(text) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const strip = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(strip)).join("\n");
}

// The failure reason lives in the TAP diagnostic block's `error:` field, which
// is either a single quoted string or a YAML block scalar.
function failureReason(diagnostics) {
  const text = diagnostics.join("\n");
  const block = /^\s*error:\s*\|-?\s*\n([\s\S]*?)(?=\n\s*(?:code|failureType|stack|expected|actual|operator):)/m.exec(text);
  if (block) return unindent(block[1]);
  const inline = /^\s*error:\s*'([\s\S]*?)'\s*$/m.exec(text);
  if (inline) return inline[1].replace(/''/g, "'");
  const plain = /^\s*error:\s*(.+)$/m.exec(text);
  return plain ? plain[1] : "(no failure message reported)";
}

function runStage(stage) {
  const file = path.join(ROOT, stage.file);
  const label = `stage-${Number(stage.id)}`;

  console.log("");
  console.log(bold(`[tester] Running tests for Stage #${Number(stage.id)}: ${stage.title}`));

  if (!fs.existsSync(file)) {
    console.log(yellow(`[${label}] No tests written for this stage yet (${stage.file}).`));
    return { status: "pending" };
  }

  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const output = `${res.stdout || ""}${res.stderr || ""}`;
  const results = parseTap(output);

  if (results.length === 0) {
    console.log(red(`[${label}] The test file produced no results. Raw output:`));
    console.log(output.trim());
    return { status: "failed", passed: 0, total: 0 };
  }

  const failures = [];
  for (const result of results) {
    if (result.ok) {
      console.log(`[${label}] ${green("PASS")} ${result.name}`);
    } else {
      console.log(`[${label}] ${red("FAIL")} ${result.name}`);
      failures.push(result);
    }
  }

  const passed = results.length - failures.length;

  if (failures.length === 0) {
    console.log(
      `[${label}] ${green(`Stage #${Number(stage.id)} passed.`)} ${dim(`${passed}/${results.length} assertions`)}`,
    );
    return { status: "passed", passed, total: results.length };
  }

  console.log("");
  for (const failure of failures) {
    console.log(red(`[${label}] Failure: ${failure.name}`));
    for (const line of failureReason(failure.diagnostics).split("\n")) {
      console.log(dim(`[${label}]   ${line}`));
    }
    console.log("");
  }
  console.log(
    `[${label}] ${red(`Stage #${Number(stage.id)} failed.`)} ${dim(`${passed}/${results.length} assertions passed`)}`,
  );
  return { status: "failed", passed, total: results.length };
}

function main() {
  const { requested, all } = parseArgs(process.argv.slice(2));
  const selected = requested.length ? STAGES.filter((s) => requested.includes(s.id)) : STAGES;

  if (selected.length === 0) {
    console.error(`no matching stages for: ${requested.join(", ")}`);
    process.exit(2);
  }

  const summary = [];
  let failed = false;

  for (const stage of selected) {
    const result = runStage(stage);
    summary.push({ stage, result });
    if (result.status === "failed") {
      failed = true;
      if (!all && requested.length === 0) break;
    }
  }

  console.log("");
  console.log(bold("[tester] Summary"));
  for (const { stage, result } of summary) {
    const mark =
      result.status === "passed" ? green("PASS") : result.status === "pending" ? yellow("PEND") : red("FAIL");
    const counts = result.total ? dim(` ${result.passed}/${result.total}`) : "";
    console.log(`[tester]   ${mark} Stage #${Number(stage.id)} ${stage.title}${counts}`);
  }

  if (failed) {
    const first = summary.find((s) => s.result.status === "failed");
    console.log("");
    console.log(red(`[tester] Stage #${Number(first.stage.id)} is the stage to work on next.`));
    console.log(dim(`[tester] Re-run just that stage with: npm run grade -- ${Number(first.stage.id)}`));
    process.exit(1);
  }

  console.log("");
  console.log(green("[tester] All selected stages passed."));
}

main();
