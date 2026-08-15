// Reading a zip, which is the other half of `.story`.
//
// Entries are found through the central directory at the end of the
// file rather than by walking local headers, because that's the only
// part of the format that's reliably complete — our own bundles write
// sizes after the payload, so the local headers say zero.
//
// Both storage methods are handled: STORE (what we write) and DEFLATE
// (what someone gets if they zip a folder with ordinary tools, which
// they will). Inflating uses the platform's own DecompressionStream, so
// there's no compression code here in either direction.
//
// The archive is read into memory first. That's a real limit and worth
// stating: fine for a core bundle, wrong eventually for a books bundle
// with a hundred megabytes of PDFs in it. Streaming import is a
// follow-up, not a subtlety anyone should discover in production.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export type ZipFile = {
  name: string;
  bytes: () => Promise<Uint8Array>;
  size: number;
};

export async function readZip(buffer: ArrayBuffer): Promise<Map<string, ZipFile>> {
  const view = new DataView(buffer);
  const all = new Uint8Array(buffer);

  // The end-of-central-directory record is last, but a trailing comment
  // can push it back by up to 64k. Scan backwards for the signature.
  let eocd = -1;
  for (let i = all.length - 22; i >= Math.max(0, all.length - 65_557); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  // Named generically because packs are archives too now — a `.pack`
  // failing to open used to claim it wasn't a `.story`.
  if (eocd < 0) throw new Error("that doesn't look like a teller file");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const files = new Map<string, ZipFile>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL) break;
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localAt = view.getUint32(offset + 42, true);
    const name = decoder.decode(all.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    // Directory entries; nothing to read.
    if (name.endsWith('/')) continue;

    files.set(name, {
      name,
      size: uncompressed,
      bytes: async () => {
        // The local header's own name/extra lengths decide where the
        // payload starts — they can differ from the central directory's.
        const localNameLen = view.getUint16(localAt + 26, true);
        const localExtraLen = view.getUint16(localAt + 28, true);
        const start = localAt + 30 + localNameLen + localExtraLen;
        const raw = all.subarray(start, start + compressed);
        if (method === 0) return raw;
        if (method === 8) {
          const stream = new Blob([raw as BlobPart])
            .stream()
            .pipeThrough(new DecompressionStream('deflate-raw'));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error(`${name}: unsupported compression method ${method}`);
      },
    });
  }
  return files;
}

/** Read and parse a JSON member, or undefined if the bundle omitted it. */
export async function readJson<T>(
  files: Map<string, ZipFile>,
  name: string,
): Promise<T | undefined> {
  const file = files.get(name);
  if (!file) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(await file.bytes())) as T;
  } catch {
    throw new Error(`${name} in this bundle isn't valid JSON`);
  }
}
