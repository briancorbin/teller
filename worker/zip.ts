// A zip writer, because a `.story` file is a zip.
//
// Written here rather than pulled in because the requirements are narrow
// enough to be boring: STORE only, no compression. A books bundle is
// mostly PDFs, which are already compressed — deflating them would burn
// CPU on a Pi to save a percent or two.
//
// It streams. Entries are written with data descriptors (the sizes and
// checksum go AFTER the payload) so nothing has to be buffered to know
// how big it is first. That's what lets a hundred-megabyte rulebook
// leave the host without ever being held in memory whole.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

class Crc32 {
  private value = 0xffffffff;
  update(bytes: Uint8Array): void {
    let c = this.value;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    this.value = c;
  }
  get digest(): number {
    return (this.value ^ 0xffffffff) >>> 0;
  }
}

function bytes(...parts: (number | Uint8Array)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') out.push(part);
    else out.push(...part);
  }
  return new Uint8Array(out);
}

const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n: number) =>
  new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** One thing to put in the archive. `data` may be a stream for large files. */
export type ZipEntry = {
  name: string;
  data: Uint8Array | ReadableStream<Uint8Array>;
};

// Bit 3 says "sizes and CRC follow the data", which is what makes
// streaming possible. Bit 11 says the name is UTF-8.
const FLAGS = 0x0008 | 0x0800;

/**
 * Build a zip as a stream.
 *
 * Entries are pulled lazily, so a caller can hand over a hundred books
 * and only one is in flight at a time.
 */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (chunk: Uint8Array) => {
        controller.enqueue(chunk);
        offset += chunk.length;
      };

      for await (const entry of entries) {
        const name = encoder.encode(entry.name);
        const start = offset;

        push(
          bytes(
            u32(0x04034b50), // local file header
            u16(20), // version needed
            u16(FLAGS),
            u16(0), // STORE
            u16(0), // mod time — deliberately fixed; see below
            u16(0x21), // mod date: 1980-01-01
            u32(0), // crc, unknown until the data is through
            u32(0), // compressed size
            u32(0), // uncompressed size
            u16(name.length),
            u16(0),
            name,
          ),
        );

        // Timestamps are pinned rather than taken from the clock so that
        // exporting the same campaign twice produces the same bytes.
        // A bundle you can diff is a bundle you can trust as a backup.

        const crc = new Crc32();
        let size = 0;
        if (entry.data instanceof Uint8Array) {
          crc.update(entry.data);
          size = entry.data.length;
          push(entry.data);
        } else {
          const reader = entry.data.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            crc.update(value);
            size += value.length;
            push(value);
          }
        }

        push(bytes(u32(0x08074b50), u32(crc.digest), u32(size), u32(size)));

        central.push(
          bytes(
            u32(0x02014b50), // central directory header
            u16(20),
            u16(20),
            u16(FLAGS),
            u16(0),
            u16(0),
            u16(0x21),
            u32(crc.digest),
            u32(size),
            u32(size),
            u16(name.length),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(0),
            u32(start),
            name,
          ),
        );
        count++;
      }

      const dirStart = offset;
      for (const record of central) push(record);
      push(
        bytes(
          u32(0x06054b50), // end of central directory
          u16(0),
          u16(0),
          u16(count),
          u16(count),
          u32(offset - dirStart),
          u32(dirStart),
          u16(0),
        ),
      );
      controller.close();
    },
  });
}

export const jsonEntry = (name: string, value: unknown): ZipEntry => ({
  name,
  data: new TextEncoder().encode(JSON.stringify(value, null, 2)),
});
