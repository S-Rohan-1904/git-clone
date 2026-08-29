const crypto = require("crypto");
const zlib = require("zlib");

const SIGNATURE = "PACK";
const VERSION = 2;
const CONTINUATION = 0x80;
const LOW_SEVEN = 0x7f;

const TYPE_CODES = { commit: 1, tree: 2, blob: 3, tag: 4 };

function entryHeader(type, size) {
  const bytes = [];
  let byte = (TYPE_CODES[type] << 4) | (size & 0x0f);
  let remaining = Math.floor(size / 16);

  while (remaining > 0) {
    bytes.push(byte | CONTINUATION);
    byte = remaining & LOW_SEVEN;
    remaining = Math.floor(remaining / 128);
  }

  bytes.push(byte);
  return Buffer.from(bytes);
}

function writePack(objects) {
  const header = Buffer.alloc(12);
  header.write(SIGNATURE, 0, "ascii");
  header.writeUInt32BE(VERSION, 4);
  header.writeUInt32BE(objects.length, 8);

  const parts = [header];

  for (const object of objects) {
    parts.push(entryHeader(object.type, object.data.length), zlib.deflateSync(object.data));
  }

  const body = Buffer.concat(parts);
  return Buffer.concat([body, crypto.createHash("sha1").update(body).digest()]);
}

module.exports = { writePack };
