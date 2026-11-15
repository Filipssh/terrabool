# TerraBool

Turn a truth table into a compact Terraria logic-gate module.

Terraria wires don't continuously power a device, they toggle it, so two wires joined on one lamp act as a free XOR gate. A circuit built around XOR needs far fewer gates and lamps than a textbook formula. TerraBool searches for those circuits and exports them as [TEdit](https://github.com/TEdit/Terraria-Map-Editor) schematics you can paste into your world.

## Features

- **Single output**: lists every cheapest expression for a 2, 3 or 4 input function, with a tile-by-tile drawing of each module.
- **Multi output**: several truth tables sharing gates in one module, ranked best first (no diodes, then fewest lamps), with wiring found automatically.
- **TEdit export**: download any module as a `.TEditSch` file and load it from TEdit's Clipboard tab.
- **CSV export** of all single-output results.

## Usage

### Entering a truth table

Type the output column **f** of the truth table as one string, **bottom row first**. 2, 3 or 4 inputs need 4, 8 or 16 characters of `0`, `1`, or `x` (any lower case letter) for don't care. This table is entered as `xxx0011011001100`:

| A | B | C | D | f |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 0 | 1 | 0 |
| 0 | 0 | 1 | 0 | 1 |
| 0 | 0 | 1 | 1 | 1 |
| 0 | 1 | 0 | 0 | 0 |
| 0 | 1 | 0 | 1 | 0 |
| 0 | 1 | 1 | 0 | 1 |
| 0 | 1 | 1 | 1 | 1 |
| 1 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 1 | 1 |
| 1 | 0 | 1 | 0 | 1 |
| 1 | 0 | 1 | 1 | 0 |
| 1 | 1 | 0 | 0 | 0 |
| 1 | 1 | 0 | 1 | x |
| 1 | 1 | 1 | 0 | x |
| 1 | 1 | 1 | 1 | x |

### Single output

Every cheapest expression is listed; pick one to see its module drawn tile by tile. They all cost the same, so pick whichever fits your build.

Some functions need two gates whose outputs share a wire. These are listed in two columns: pick one from each, and the module for that pair is drawn.

### Reading an expression

`⊕(¬c, ¬ac, ¬cd, acd)`

- **The symbol is the gate**: `∧` is an AND gate, `⊕` an XOR gate (on when exactly one lamp is on). A `¬` before it inverts the output: the output is off while the gate is on.
- **Each term is one lamp**, wired to the inputs it names. Letters written together (`acd`) are wires joined on one lamp, which XORs them.
- **A `¬` before a term** means that lamp starts on.

### Multi output: several outputs sharing gates

Add one truth table per output (pasting several lines adds them all). They must have the same length and the same don't cares. Gates are shared between outputs: an output wired to several gates is their XOR. For example `10010110` and `11101000` are a full adder (sum and carry). **Advanced → Stop after** sets how many wired modules to find; while it runs, the counter shows how many were verified, marked for validation and total checked.

### Reading a module picture

- Wire colours are inputs, entering at the top: red = a, blue = b, green = c, yellow = d.
- Lamps stack on their gate (G), the bottom lamp on the gate tile. Outputs (O) sit at the bottom.
- Lit tiles show the state with every input off: build them that way.
- An empty column only carries input wires into lamps from the side.

## Running locally

It's a static site with no build step, but ES modules and web workers need an HTTP server, so opening `index.html` from disk won't work:

```sh
npx serve .
```

## Tests

Requires Node 22.5+ (for the coverage flags).

```sh
npm test
```

The test run enforces 100% line, branch and function coverage on the search code in `js/worker`, `js/model` and `js/data`.

## Project layout

| Path | Contents |
|------|----------|
| `js/main.js` | Entry point, wires the UI to the workers |
| `js/worker/` | Expression search, multi-output matrices, wiring |
| `js/data/` | Gate and term tables |
| `js/state/` | UI state and TEdit schematic generation |
| `test/` | `node:test` suites |

## License

[MIT](LICENSE)
