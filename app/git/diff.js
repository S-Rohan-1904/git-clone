const CONTEXT = 3;
const ABBREVIATED = 7;
const NULL_SHA = "0000000";
const NO_NEWLINE = "\\ No newline at end of file";
const SENTINEL = "\u0000";
const BINARY_SCAN_BYTES = 8000;

function isBinary(buffer) {
  return buffer.subarray(0, BINARY_SCAN_BYTES).includes(0);
}

function splitLines(buffer) {
  const text = buffer.toString("utf8");

  if (text === "") {
    return { lines: [], newlineAtEof: true };
  }

  const newlineAtEof = text.endsWith("\n");
  const lines = text.split("\n");

  if (newlineAtEof) {
    lines.pop();
  }

  return { lines, newlineAtEof };
}

function myers(a, b) {
  const max = a.length + b.length;
  const v = new Map([[1, 0]]);
  const trace = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(new Map(v));

    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0))
          ? v.get(k + 1) || 0
          : (v.get(k - 1) || 0) + 1;
      let y = x - k;

      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1;
        y += 1;
      }

      v.set(k, x);

      if (x >= a.length && y >= b.length) {
        return backtrack(trace, a, b);
      }
    }
  }

  return [];
}

function backtrack(trace, a, b) {
  const edits = [];
  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;

    const previousK =
      k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0)) ? k + 1 : k - 1;
    const previousX = v.get(previousK) || 0;
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      edits.push({ type: " ", text: a[x] });
    }

    if (d === 0) {
      break;
    }

    if (x === previousX) {
      y -= 1;
      edits.push({ type: "+", text: b[y] });
    } else {
      x -= 1;
      edits.push({ type: "-", text: a[x] });
    }
  }

  return edits.reverse();
}

function annotate(edits) {
  let oldLine = 1;
  let newLine = 1;

  return edits.map((edit) => {
    const annotated = { ...edit, oldLine, newLine };
    if (edit.type !== "+") oldLine += 1;
    if (edit.type !== "-") newLine += 1;
    return annotated;
  });
}

function buildHunks(edits) {
  const annotated = annotate(edits);
  const changed = [];

  annotated.forEach((edit, index) => {
    if (edit.type !== " ") changed.push(index);
  });

  if (changed.length === 0) {
    return [];
  }

  const groups = [[changed[0], changed[0]]];

  for (const index of changed.slice(1)) {
    const group = groups[groups.length - 1];
    if (index - group[1] > CONTEXT * 2) {
      groups.push([index, index]);
    } else {
      group[1] = index;
    }
  }

  return groups.map(([first, last]) =>
    finalize(annotated.slice(Math.max(0, first - CONTEXT), Math.min(annotated.length, last + CONTEXT + 1))),
  );
}

function finalize(lines) {
  const olds = lines.filter((line) => line.type !== "+");
  const news = lines.filter((line) => line.type !== "-");

  return {
    lines,
    oldStart: olds.length > 0 ? olds[0].oldLine : lines[0].oldLine - 1,
    oldCount: olds.length,
    newStart: news.length > 0 ? news[0].newLine : lines[0].newLine - 1,
    newCount: news.length,
  };
}

function range(start, count) {
  return count === 1 ? `${start}` : `${start},${count}`;
}

function keyed(lines, newlineAtEof) {
  return lines.map((text, index) =>
    !newlineAtEof && index === lines.length - 1 ? `${text}${SENTINEL}` : text,
  );
}

function renderHunks(source, target) {
  const edits = myers(keyed(source.lines, source.newlineAtEof), keyed(target.lines, target.newlineAtEof));
  const lines = [];

  for (const hunk of buildHunks(edits)) {
    lines.push(`@@ -${range(hunk.oldStart, hunk.oldCount)} +${range(hunk.newStart, hunk.newCount)} @@`);

    for (const line of hunk.lines) {
      const missing = line.text.endsWith(SENTINEL);
      lines.push(`${line.type}${missing ? line.text.slice(0, -SENTINEL.length) : line.text}`);
      if (missing) {
        lines.push(NO_NEWLINE);
      }
    }
  }

  return lines;
}

function abbreviate(sha) {
  return sha ? sha.slice(0, ABBREVIATED) : NULL_SHA;
}

function formatPatch({ path: name, before, after }) {
  const lines = [`diff --git a/${name} b/${name}`];

  if (!before) {
    lines.push(`new file mode ${after.mode}`);
  } else if (!after) {
    lines.push(`deleted file mode ${before.mode}`);
  } else if (before.mode !== after.mode) {
    lines.push(`old mode ${before.mode}`, `new mode ${after.mode}`);
  }

  if (before && after && before.sha === after.sha) {
    return lines.join("\n");
  }

  const sameMode = before && after && before.mode === after.mode;
  const suffix = sameMode ? ` ${before.mode}` : "";
  lines.push(`index ${abbreviate(before && before.sha)}..${abbreviate(after && after.sha)}${suffix}`);

  const beforeContent = before ? before.content : Buffer.alloc(0);
  const afterContent = after ? after.content : Buffer.alloc(0);

  if (isBinary(beforeContent) || isBinary(afterContent)) {
    lines.push(`Binary files ${before ? `a/${name}` : "/dev/null"} and ${after ? `b/${name}` : "/dev/null"} differ`);
    return lines.join("\n");
  }

  const source = splitLines(beforeContent);
  const target = splitLines(afterContent);

  lines.push(before ? `--- a/${name}` : "--- /dev/null");
  lines.push(after ? `+++ b/${name}` : "+++ /dev/null");
  lines.push(...renderHunks(source, target));

  return lines.join("\n");
}

module.exports = { formatPatch, myers, splitLines };
