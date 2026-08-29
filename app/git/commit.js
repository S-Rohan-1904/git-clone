const { fatal } = require("./errors");

const IDENTITY = /^(.*?)\s*<([^>]*)>\s*(\d+)\s*([+-]\d{4})$/;
const CONTINUATION = " ";

function parseHeaders(lines) {
  const headers = [];
  let index = 0;

  for (; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === "") {
      index += 1;
      break;
    }

    if (line.startsWith(CONTINUATION) && headers.length > 0) {
      headers[headers.length - 1][1] += `\n${line.slice(1)}`;
      continue;
    }

    const space = line.indexOf(" ");
    if (space === -1) {
      headers.push([line, ""]);
    } else {
      headers.push([line.slice(0, space), line.slice(space + 1)]);
    }
  }

  return { headers, messageStart: index };
}

function parseCommit(body) {
  const lines = body.toString("utf8").split("\n");
  const { headers, messageStart } = parseHeaders(lines);

  const first = (key) => {
    const found = headers.find(([name]) => name === key);
    return found ? found[1] : null;
  };

  const tree = first("tree");
  if (!tree) {
    throw fatal("commit has no tree");
  }

  return {
    tree,
    parents: headers.filter(([name]) => name === "parent").map(([, value]) => value),
    author: parseIdentity(first("author")),
    committer: parseIdentity(first("committer")),
    headers,
    message: lines.slice(messageStart).join("\n"),
  };
}

function parseIdentity(value) {
  if (!value) {
    return null;
  }

  const match = IDENTITY.exec(value.replace(/\n/g, " "));
  if (!match) {
    return { name: value, email: "", seconds: 0, timezone: "+0000" };
  }

  return {
    name: match[1],
    email: match[2],
    seconds: Number(match[3]),
    timezone: match[4],
  };
}

function subject(message) {
  const trimmed = message.replace(/\n+$/, "");
  const blank = trimmed.indexOf("\n\n");
  const head = blank === -1 ? trimmed : trimmed.slice(0, blank);

  return head.split("\n").join(" ");
}

module.exports = { parseCommit, parseIdentity, subject };
