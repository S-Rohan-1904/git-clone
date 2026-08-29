const LENGTH_BYTES = 4;
const FLUSH = "0000";

function encode(payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = (body.length + LENGTH_BYTES).toString(16).padStart(LENGTH_BYTES, "0");

  return Buffer.concat([Buffer.from(length), body]);
}

function flush() {
  return Buffer.from(FLUSH);
}

function isLength(buffer, offset) {
  if (offset + LENGTH_BYTES > buffer.length) {
    return false;
  }
  return /^[0-9a-f]{4}$/.test(buffer.subarray(offset, offset + LENGTH_BYTES).toString("ascii"));
}

function readLine(buffer, offset) {
  if (!isLength(buffer, offset)) {
    return null;
  }

  const length = Number.parseInt(buffer.subarray(offset, offset + LENGTH_BYTES).toString("ascii"), 16);

  if (length === 0) {
    return { flush: true, next: offset + LENGTH_BYTES };
  }
  if (length < LENGTH_BYTES || offset + length > buffer.length) {
    return null;
  }

  return {
    flush: false,
    payload: buffer.subarray(offset + LENGTH_BYTES, offset + length),
    next: offset + length,
  };
}

function decode(buffer, start = 0) {
  const lines = [];
  let offset = start;

  for (;;) {
    const line = readLine(buffer, offset);
    if (!line) {
      break;
    }
    if (!line.flush) {
      lines.push(line.payload);
    }
    offset = line.next;
  }

  return { lines, offset };
}

module.exports = { encode, flush, decode, readLine, LENGTH_BYTES };
