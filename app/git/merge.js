const { readObject } = require("./repository");
const { parseCommit } = require("./commit");
const { myers, splitLines } = require("./diff");

const OURS_MARKER = "<<<<<<<";
const SPLIT_MARKER = "=======";
const THEIRS_MARKER = ">>>>>>>";

function ancestors(sha, gitDir) {
  const seen = new Set();
  const queue = [sha];

  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    queue.push(...parseCommit(readObject(current, gitDir).body).parents);
  }

  return seen;
}

function mergeBase(gitDir, ours, theirs) {
  const oursAncestors = ancestors(ours, gitDir);
  const candidates = [];
  const seen = new Set();
  const queue = [theirs];

  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (oursAncestors.has(current)) {
      candidates.push(current);
      continue;
    }

    queue.push(...parseCommit(readObject(current, gitDir).body).parents);
  }

  return candidates.find((candidate) =>
    candidates.every((other) => other === candidate || !ancestors(other, gitDir).has(candidate)),
  ) || null;
}

function toHunks(base, side) {
  const edits = myers(base, side);
  const hunks = [];
  let baseIndex = 0;
  let current = null;

  for (const edit of edits) {
    if (edit.type === " ") {
      current = null;
      baseIndex += 1;
      continue;
    }

    if (!current) {
      current = { start: baseIndex, end: baseIndex, lines: [] };
      hunks.push(current);
    }

    if (edit.type === "-") {
      baseIndex += 1;
      current.end = baseIndex;
    } else {
      current.lines.push(edit.text);
    }
  }

  return hunks;
}

function applyRange(base, hunks, from, to) {
  const lines = [];
  let index = from;

  for (const hunk of hunks) {
    if (hunk.end <= from || hunk.start >= to) {
      continue;
    }
    lines.push(...base.slice(index, hunk.start));
    lines.push(...hunk.lines);
    index = hunk.end;
  }

  lines.push(...base.slice(index, to));
  return lines;
}

function overlaps(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

function mergeLines(base, ours, theirs, labels) {
  const oursHunks = toHunks(base, ours);
  const theirsHunks = toHunks(base, theirs);
  const output = [];

  let index = 0;
  let conflicted = false;
  let o = 0;
  let t = 0;

  while (o < oursHunks.length || t < theirsHunks.length) {
    const nextOurs = oursHunks[o];
    const nextTheirs = theirsHunks[t];

    if (!nextTheirs || (nextOurs && nextOurs.end <= nextTheirs.start)) {
      output.push(...base.slice(index, nextOurs.start), ...nextOurs.lines);
      index = nextOurs.end;
      o += 1;
      continue;
    }

    if (!nextOurs || nextTheirs.end <= nextOurs.start) {
      output.push(...base.slice(index, nextTheirs.start), ...nextTheirs.lines);
      index = nextTheirs.end;
      t += 1;
      continue;
    }

    let start = Math.min(nextOurs.start, nextTheirs.start);
    let end = Math.max(nextOurs.end, nextTheirs.end);
    let lastO = o;
    let lastT = t;

    for (;;) {
      const grownO = oursHunks.findIndex((hunk, i) => i > lastO && overlaps(hunk, { start, end }));
      const grownT = theirsHunks.findIndex((hunk, i) => i > lastT && overlaps(hunk, { start, end }));

      if (grownO === -1 && grownT === -1) {
        break;
      }
      if (grownO !== -1) {
        lastO = grownO;
        end = Math.max(end, oursHunks[grownO].end);
      }
      if (grownT !== -1) {
        lastT = grownT;
        end = Math.max(end, theirsHunks[grownT].end);
      }
    }

    const oursText = applyRange(base, oursHunks.slice(o, lastO + 1), start, end);
    const theirsText = applyRange(base, theirsHunks.slice(t, lastT + 1), start, end);

    output.push(...base.slice(index, start));

    if (oursText.join("\n") === theirsText.join("\n")) {
      output.push(...oursText);
    } else {
      conflicted = true;
      output.push(`${OURS_MARKER} ${labels.ours}`);
      output.push(...oursText);
      output.push(SPLIT_MARKER);
      output.push(...theirsText);
      output.push(`${THEIRS_MARKER} ${labels.theirs}`);
    }

    index = end;
    o = lastO + 1;
    t = lastT + 1;
  }

  output.push(...base.slice(index));
  return { lines: output, conflicted };
}

function mergeContents(baseBuffer, oursBuffer, theirsBuffer, labels) {
  const base = splitLines(baseBuffer || Buffer.alloc(0));
  const ours = splitLines(oursBuffer);
  const theirs = splitLines(theirsBuffer);

  const { lines, conflicted } = mergeLines(base.lines, ours.lines, theirs.lines, labels);
  const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;

  return { content: Buffer.from(text), conflicted };
}

module.exports = { mergeBase, mergeContents, ancestors };
