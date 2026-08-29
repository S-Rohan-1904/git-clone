const zlib = require("zlib");

const { fatal } = require("./errors");

const SIGNATURE = "PACK";
const SUPPORTED_VERSION = 2;
const HEADER_BYTES = 12;
const SHA_BYTES = 20;

const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;

const TYPE_NAMES = {
  [OBJ_COMMIT]: "commit",
  [OBJ_TREE]: "tree",
  [OBJ_BLOB]: "blob",
  [OBJ_TAG]: "tag",
};

const COPY_INSTRUCTION = 0x80;
const CONTINUATION = 0x80;
const LOW_SEVEN = 0x7f;
const DEFAULT_COPY_SIZE = 0x10000;

function readHeader(buffer) {
  if (buffer.length < HEADER_BYTES || buffer.subarray(0, 4).toString("ascii") !== SIGNATURE) {
    throw fatal("invalid packfile signature");
  }

  const version = buffer.readUInt32BE(4);
  if (version !== SUPPORTED_VERSION) {
    throw fatal(`unsupported packfile version ${version}`);
  }

  return { count: buffer.readUInt32BE(8), offset: HEADER_BYTES };
}

function readTypeAndSize(buffer, start) {
  let offset = start;
  let byte = buffer[offset];
  offset += 1;

  const type = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;

  while (byte & CONTINUATION) {
    byte = buffer[offset];
    offset += 1;
    size += (byte & LOW_SEVEN) * 2 ** shift;
    shift += 7;
  }

  return { type, size, offset };
}

function readVariableLength(buffer, start) {
  let offset = start;
  let value = 0;
  let shift = 0;
  let byte;

  do {
    byte = buffer[offset];
    offset += 1;
    value += (byte & LOW_SEVEN) * 2 ** shift;
    shift += 7;
  } while (byte & CONTINUATION);

  return { value, offset };
}

function readNegativeOffset(buffer, start) {
  let offset = start;
  let byte = buffer[offset];
  offset += 1;
  let value = byte & LOW_SEVEN;

  while (byte & CONTINUATION) {
    byte = buffer[offset];
    offset += 1;
    value = (value + 1) * 128 + (byte & LOW_SEVEN);
  }

  return { value, offset };
}

function inflateAt(buffer, offset) {
  let result;
  try {
    result = zlib.inflateSync(buffer.subarray(offset), { info: true });
  } catch {
    throw fatal("failed to inflate packfile entry");
  }

  return { data: result.buffer, next: offset + result.engine.bytesWritten };
}

function applyDelta(base, delta) {
  const { value: baseSize, offset: afterBase } = readVariableLength(delta, 0);
  const { value: resultSize, offset: afterResult } = readVariableLength(delta, afterBase);

  if (baseSize !== base.length) {
    throw fatal("delta base size mismatch");
  }

  const parts = [];
  let offset = afterResult;
  let produced = 0;

  while (offset < delta.length) {
    const instruction = delta[offset];
    offset += 1;

    if (instruction & COPY_INSTRUCTION) {
      let copyOffset = 0;
      let copySize = 0;

      for (let bit = 0; bit < 4; bit += 1) {
        if (instruction & (1 << bit)) {
          copyOffset |= delta[offset] << (bit * 8);
          offset += 1;
        }
      }
      for (let bit = 0; bit < 3; bit += 1) {
        if (instruction & (1 << (bit + 4))) {
          copySize |= delta[offset] << (bit * 8);
          offset += 1;
        }
      }

      copyOffset >>>= 0;
      if (copySize === 0) {
        copySize = DEFAULT_COPY_SIZE;
      }

      parts.push(base.subarray(copyOffset, copyOffset + copySize));
      produced += copySize;
    } else if (instruction !== 0) {
      parts.push(delta.subarray(offset, offset + instruction));
      offset += instruction;
      produced += instruction;
    } else {
      throw fatal("invalid delta instruction");
    }
  }

  if (produced !== resultSize) {
    throw fatal("delta produced the wrong result size");
  }

  return Buffer.concat(parts, resultSize);
}

function readEntries(buffer) {
  const { count, offset: start } = readHeader(buffer);
  const entries = [];
  let offset = start;

  for (let index = 0; index < count; index += 1) {
    const entryOffset = offset;
    const { type, offset: afterType } = readTypeAndSize(buffer, offset);
    offset = afterType;

    let baseOffset = null;
    let baseSha = null;

    if (type === OBJ_OFS_DELTA) {
      const negative = readNegativeOffset(buffer, offset);
      baseOffset = entryOffset - negative.value;
      offset = negative.offset;
    } else if (type === OBJ_REF_DELTA) {
      baseSha = buffer.subarray(offset, offset + SHA_BYTES).toString("hex");
      offset += SHA_BYTES;
    }

    const { data, next } = inflateAt(buffer, offset);
    offset = next;

    entries.push({ offset: entryOffset, type, baseOffset, baseSha, data });
  }

  return entries;
}

function unpack(buffer, shaOf, lookup = null) {
  const entries = readEntries(buffer);
  const byOffset = new Map(entries.map((entry) => [entry.offset, entry]));
  const resolved = new Map();
  const offsetBySha = new Map();
  const objects = [];

  const store = (entry, type, data) => {
    resolved.set(entry.offset, { type, data });
    const sha = shaOf(type, data);
    offsetBySha.set(sha, entry.offset);
    objects.push({ sha, type, data });
  };

  let remaining = entries.filter((entry) => {
    if (entry.type === OBJ_OFS_DELTA || entry.type === OBJ_REF_DELTA) {
      return true;
    }
    const type = TYPE_NAMES[entry.type];
    if (!type) {
      throw fatal(`unsupported packfile object type ${entry.type}`);
    }
    store(entry, type, entry.data);
    return false;
  });

  while (remaining.length > 0) {
    const pending = [];

    for (const entry of remaining) {
      const baseOffset =
        entry.baseOffset !== null ? entry.baseOffset : offsetBySha.get(entry.baseSha);
      let base = baseOffset === undefined ? undefined : resolved.get(baseOffset);

      if (!base && entry.baseSha && lookup) {
        base = lookup(entry.baseSha);
      }

      if (!base) {
        if (baseOffset !== undefined && !byOffset.has(baseOffset)) {
          throw fatal(`packfile refers to a missing base object`);
        }
        pending.push(entry);
        continue;
      }

      store(entry, base.type, applyDelta(base.data, entry.data));
    }

    if (pending.length === remaining.length) {
      throw fatal("packfile contains deltas whose base objects are missing");
    }
    remaining = pending;
  }

  return objects;
}

module.exports = { unpack, applyDelta, readEntries };
