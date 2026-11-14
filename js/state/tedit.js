// A module as a TEdit schematic (.TEditSch): TEdit's clipboard file in its V5 layout
// (TEdit.Editor/Clipboard/ClipboardBuffer.File.cs, SaveV5), as TEdit saves for world
// version 326. Little-endian; strings are .NET BinaryWriter strings (7-bit length, UTF-8).

const VERSION = 326;
// Terraria's "tile frame important" bit array for version 326 (int16 bit count, then
// the bits), as TEdit writes it. 419 and 420 are set, 260 and 267 are not.
const FRAME_IMPORTANT =
  "f20238fc3fbd1e04862080e7feffff470660f3ef21002078040f0082961f98faff4000e0f8efffff7ff419c00e20dc1ff017fc0f60" +
  "7c983bf83ff0e3ff18f16f0ae6c0ff3ec4fbdfb13ff8fffffffffbe1a5fd7f97030000e0fdef1f7b20008003";

/** Tile id, frame U and V of each picture tile: a lamp, a gate, or a Diamond Gemspark output. */
const BLOCKS = {
  lamp: (on) => [419, on ? 18 : 0, 0],
  gate_and: (on) => [420, on ? 18 : 0, 0],
  gate_xor: (on) => [420, on ? 18 : 0, 72],
  output: (on) => [on ? 267 : 260],
};

/**
 * @param {string} name the schematic's name in TEdit
 * @param {number[][]} colours colours[y][x] bit c: wire colour c (red, blue, green, yellow)
 * @param {({image: string, on: boolean} | null)[][]} cells cells[y][x], same size
 * @returns {Uint8Array}
 */
export function teditSchematic(name, colours, cells) {
  const out = [];
  const int = (value, bytes) => {
    for (let i = 0; i < bytes; i++) out.push((value >> (8 * i)) & 0xff);
  };
  const string = (s) => {
    const utf8 = new TextEncoder().encode(s);
    let n = utf8.length;
    for (; n >= 128; n >>= 7) out.push((n & 127) | 128);
    out.push(n, ...utf8);
  };
  const width = colours[0].length;
  const height = colours.length;

  string(name);
  int(VERSION + 20000, 4); // + 20000 marks the V5 layout
  for (let i = 0; i < FRAME_IMPORTANT.length; i += 2) out.push(parseInt(FRAME_IMPORTANT.slice(i, i + 2), 16));
  int(width, 4);
  int(height, 4);

  // Column by column, top to bottom; each tile is up to 3 header bytes, then its data.
  for (let x = 0; x < width; x++)
    for (let y = 0; y < height; y++) {
      const set = colours[y][x];
      let h1 = 0;
      let h2 = (set & 0b111) << 1; // red, blue, green: header2 bits 1 to 3
      const h3 = (set & 0b1000) << 2; // yellow: header3 bit 5
      const data = [];
      const cell = cells[y][x];
      if (cell) {
        const [type, u, v] = BLOCKS[cell.image](cell.on);
        h1 |= 2 | (type > 255 ? 32 : 0); // active, two-byte type
        data.push(type & 0xff, ...(type > 255 ? [type >> 8] : []));
        if (u !== undefined) data.push(u & 0xff, u >> 8, v & 0xff, v >> 8);
      }
      if (h3) h2 |= 1;
      if (h2) h1 |= 1;
      out.push(h1, ...(h2 ? [h2] : []), ...(h3 ? [h3] : []), ...data);
    }

  int(0, 2); // chests
  int(0, 2); // signs
  int(0, 4); // tile entities
  // Footer TEdit checks the file against.
  string(name);
  int(VERSION, 4);
  int(width, 4);
  int(height, 4);
  return Uint8Array.from(out);
}
