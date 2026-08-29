const { fatal } = require("./errors");
const { readObject, resolveObjectName } = require("./repository");
const { readRef, HEAD } = require("./refs");
const { parseCommit } = require("./commit");

const HEX = /^[0-9a-f]{4,40}$/;
const SPECIAL = /^[A-Z_]+$/;
const DIGITS = /^\d*/;

const CANDIDATE_PREFIXES = ["", "refs/", "refs/tags/", "refs/heads/", "refs/remotes/"];

function splitSuffixes(spec) {
  const boundary = spec.search(/[\^~]/);

  if (boundary === -1) {
    return { base: spec, operations: [] };
  }

  const operations = [];
  let index = boundary;

  while (index < spec.length) {
    const marker = spec[index];
    index += 1;

    if (marker === "~") {
      const digits = DIGITS.exec(spec.slice(index))[0];
      index += digits.length;
      operations.push({ kind: "ancestor", count: digits === "" ? 1 : Number(digits) });
      continue;
    }

    if (marker !== "^") {
      throw fatal(`ambiguous argument '${spec}': unknown revision`);
    }

    if (spec[index] === "{") {
      const close = spec.indexOf("}", index);
      if (close === -1) {
        throw fatal(`ambiguous argument '${spec}': unknown revision`);
      }
      operations.push({ kind: "peel", type: spec.slice(index + 1, close) });
      index = close + 1;
      continue;
    }

    const digits = DIGITS.exec(spec.slice(index))[0];
    index += digits.length;
    operations.push({ kind: "parent", count: digits === "" ? 1 : Number(digits) });
  }

  return { base: spec.slice(0, boundary), operations };
}

function resolveName(name, gitDir) {
  if (name === HEAD || SPECIAL.test(name)) {
    const sha = readRef(gitDir, name);
    if (sha) {
      return sha;
    }
  }

  for (const prefix of CANDIDATE_PREFIXES) {
    if (prefix === "" && !name.startsWith("refs/")) {
      continue;
    }
    const sha = readRef(gitDir, `${prefix}${name}`);
    if (sha) {
      return sha;
    }
  }

  const remoteHead = readRef(gitDir, `refs/remotes/${name}/HEAD`);
  if (remoteHead) {
    return remoteHead;
  }

  if (HEX.test(name)) {
    return resolveObjectName(name, gitDir);
  }

  throw fatal(`ambiguous argument '${name}': unknown revision or path not in the working tree.`);
}

function peel(sha, type, gitDir) {
  let current = sha;

  for (;;) {
    const object = readObject(current, gitDir);

    if (type !== "" && object.type === type) {
      return current;
    }

    if (object.type === "tag") {
      const match = /^object ([0-9a-f]{40})$/m.exec(object.body.toString("utf8"));
      if (!match) {
        throw fatal(`invalid tag object ${current}`);
      }
      current = match[1];
      continue;
    }

    if (type === "") {
      return current;
    }

    if (type === "tree" && object.type === "commit") {
      current = parseCommit(object.body).tree;
      continue;
    }

    throw fatal(`${sha} cannot be peeled to a ${type}`);
  }
}

function nthParent(sha, count, gitDir) {
  if (count === 0) {
    return sha;
  }

  const object = readObject(sha, gitDir);
  if (object.type !== "commit") {
    throw fatal(`${sha} is not a commit`);
  }

  const parents = parseCommit(object.body).parents;
  if (count > parents.length) {
    throw fatal(`${sha} does not have ${count} parents`);
  }

  return parents[count - 1];
}

function resolveRevision(spec, gitDir) {
  if (!spec) {
    throw fatal("no revision given");
  }

  const { base, operations } = splitSuffixes(spec);
  let sha = resolveName(base === "" ? HEAD : base, gitDir);

  for (const operation of operations) {
    if (operation.kind === "peel") {
      sha = peel(sha, operation.type, gitDir);
    } else if (operation.kind === "parent") {
      sha = nthParent(peel(sha, "commit", gitDir), operation.count, gitDir);
    } else {
      for (let step = 0; step < operation.count; step += 1) {
        sha = nthParent(peel(sha, "commit", gitDir), 1, gitDir);
      }
    }
  }

  return sha;
}

module.exports = { resolveRevision, peel };
