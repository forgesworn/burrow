// Render an image as half-block terminal art for a hole page.
//
// Two source pixels share one terminal cell, an upper half over a lower one,
// which is what makes a square picture come out square in a grid of cells that
// are twice as tall as they are wide.
//
// The encoding follows thecryptodonkey-hole's scripts/build-art.mjs, which
// solved this first and solved it better than a greedy pass does:
//
//   - one escape per cell, `ESC[38;5;N;48;5;Mm`, rather than one per colour
//   - the glyph for a cell is not chosen in isolation. '▀' and '▄' draw the
//     same pair of pixels with the colours swapped, so a dearer cell here can
//     leave the colours already set for the cells after it. Each cell has at
//     most two reachable (foreground, background) states, so a row is a short
//     shortest-path problem and the exact minimum costs no more to find than
//     the greedy answer
//   - the result is decoded back and compared against the source, because
//     every byte-saving swap is a chance to emit something cheaper but wrong
//
// Budget, not the wall. A Heartwood ESP32 advertises max_sign_bytes of 20480
// and enforces it from firmware v0.14.0, refusing anything over 20480 + 512
// outright. That is the wall. The budget is far below it, to leave room for
// the event scaffolding, the JSON escaping of every escape sequence, and a
// signer with less headroom than the one on the desk.
//
// Monochrome is the mode a hole should use. Kind 31436 menu display text may
// not carry control characters, so a coloured banner is only legal in a type 0
// body, never in the info lines of a type 1 document. Nothing is lost but the
// colour: '█', '▀', '▄' and a space are a complete two-pixels-per-cell alphabet
// for a 1-bit source, so the doubled vertical resolution survives, and a
// background left as a space takes the reader's own terminal colour instead of
// painting a dark rectangle onto a light theme.
//
// usage: node tools/halfblock.mjs <image> <columns> [rows] [colours] [--mono]
//                                 [--threshold=0-255]
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const mono = argv.includes('--mono')
const thresholdArg = argv.find((a) => a.startsWith('--threshold='))
const positional = argv.filter((a) => !a.startsWith('--'))

const file = positional[0]
const cols = Number(positional[1])
const rows = Number(positional[2] ?? 0) || Math.round(cols / 2)
const colours = Number(positional[3] ?? 0)
const RESET = '\x1b[0m'

// Nearest neighbour, not a smoothing filter. A logo drawn as pixel art has a
// native cell grid; interpolating across it invents in-between colours that
// smear the drawing and, because every new colour is another escape sequence,
// cost bytes to say something worse.
const args = [file, '-filter', 'Point', '-resize', `${cols}x${rows * 2}!`]
if (colours > 0) args.push('-colors', String(colours), '-dither', 'None')
args.push('-depth', '8', 'rgb:-')
const raw = execFileSync('magick', args, { maxBuffer: 1 << 26 })

if (mono) {
  // Rec. 709 luma, then one threshold. Logo art is bimodal, so the midpoint of
  // the range actually present separates ink from ground without tuning; a
  // photograph would need dithering and has no business in a menu anyway.
  const luma = []
  for (let o = 0; o < cols * rows * 2 * 3; o += 3) {
    luma.push(0.2126 * raw[o] + 0.7152 * raw[o + 1] + 0.0722 * raw[o + 2])
  }
  const threshold =
    thresholdArg !== undefined
      ? Number(thresholdArg.split('=')[1])
      : (Math.min(...luma) + Math.max(...luma)) / 2
  const ink = luma.map((l) => l > threshold)

  // Four glyphs cover every pair of 1-bit pixels exactly, so there is nothing
  // to optimise and no state to carry between cells.
  const GLYPH = { '11': '█', '10': '▀', '01': '▄', '00': ' ' }

  // --ink colours the glyphs and never touches the background, which is how
  // baud.baby's menu art sits happily on any terminal theme. The old coloured
  // banner set a background on every cell and so painted a near-black slab
  // across a light terminal. One sequence per line, reset at the end.
  // `--ink=R,G,B` for the human; SGR wants semicolons, and a comma left in
  // would produce a sequence no terminal honours and no SGR pattern matches.
  const inkArg = argv.find((a) => a.startsWith('--ink='))
  const inkRgb = inkArg === undefined ? '' : inkArg.split('=')[1].replace(/,/g, ';')
  if (inkArg !== undefined && !/^\d{1,3};\d{1,3};\d{1,3}$/.test(inkRgb)) {
    throw new Error(`--ink wants R,G,B with values 0-255, got "${inkArg.split('=')[1]}"`)
  }
  const inkColour = inkArg === undefined ? '' : `\x1b[38;2;${inkRgb}m`
  const reset = inkColour === '' ? '' : '\x1b[0m'

  const lines = []
  for (let row = 0; row < rows * 2; row += 2) {
    let line = ''
    for (let column = 0; column < cols; column++) {
      const top = ink[row * cols + column] ? '1' : '0'
      const bottom = ink[(row + 1) * cols + column] ? '1' : '0'
      line += GLYPH[top + bottom]
    }
    // Trailing ground is invisible and costs a byte a cell.
    const trimmed = line.replace(/ +$/, '')
    lines.push(trimmed === '' ? '' : `${inkColour}${trimmed}${reset}`)
  }
  const art = `${lines.join('\n')}\n`

  // Same guarantee the colour path gives: decode it back and insist it still
  // draws the source. Trimmed trailing cells decode as ground.
  const decoded = []
  // Split off the final newline only. A blank row is a row of ground and must
  // keep its place; dropping it would slide every row below it up by one.
  const artLines = art.split('\n')
  artLines.pop()
  const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:]*m`, 'g')
  for (const line of artLines) {
    const top = []
    const bottom = []
    // Colour is not a cell. Strip the sequences before counting glyphs.
    for (const ch of line.replace(SGR, '')) {
      top.push(ch === '█' || ch === '▀')
      bottom.push(ch === '█' || ch === '▄')
    }
    while (top.length < cols) {
      top.push(false)
      bottom.push(false)
    }
    decoded.push(top, bottom)
  }
  for (let y = 0; y < rows * 2; y++)
    for (let x = 0; x < cols; x++) {
      if (decoded[y][x] !== ink[y * cols + x]) {
        throw new Error(`decode mismatch at ${x},${y}: the art does not draw the source`)
      }
    }
  // What goes into a kind 31436 menu must survive SPEC.md's rule: SGR is
  // allowed in a display, every other control character is not.
  for (const ch of art.replace(SGR, '').replace(/\n/g, '')) {
    const code = ch.codePointAt(0)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      throw new Error(`art has a non-SGR control character U+${code.toString(16)}`)
    }
  }

  process.stderr.write(
    `${cols}x${rows} cells, ${Buffer.byteLength(art)} bytes, ${inkColour === '' ? 'monochrome' : 'coloured ink'}, decode verified\n`,
  )
  process.stdout.write(art)
  process.exit(0)
}

// xterm 256: the 6x6x6 cube and the grey ramp. The first sixteen are skipped
// deliberately, because terminals re-theme them and the art would change
// colour depending on whose shell it landed in.
const LEVELS = [0, 95, 135, 175, 215, 255]
const palette = []
for (let r = 0; r < 6; r++)
  for (let g = 0; g < 6; g++)
    for (let b = 0; b < 6; b++)
      palette.push({ i: 16 + 36 * r + 6 * g + b, r: LEVELS[r], g: LEVELS[g], b: LEVELS[b] })
for (let s = 0; s < 24; s++) {
  const v = 8 + s * 10
  palette.push({ i: 232 + s, r: v, g: v, b: v })
}

const cache = new Map()
function quantise(r, g, b) {
  const key = (r << 16) | (g << 8) | b
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let best = 0
  let bestD = Infinity
  for (const p of palette) {
    const d = 2 * (p.r - r) ** 2 + 4 * (p.g - g) ** 2 + 3 * (p.b - b) ** 2
    if (d < bestD) {
      bestD = d
      best = p.i
    }
  }
  cache.set(key, best)
  return best
}

const pixels = []
for (let y = 0; y < rows * 2; y++)
  for (let x = 0; x < cols; x++) {
    const o = (y * cols + x) * 3
    pixels.push(quantise(raw[o], raw[o + 1], raw[o + 2]))
  }

function sequence(fg, bg, haveFg, haveBg) {
  const p = []
  if (fg !== haveFg) p.push(38, 5, fg)
  if (bg !== haveBg) p.push(48, 5, bg)
  return p.length === 0 ? '' : `\x1b[${p.join(';')}m`
}

function renderRow(row) {
  let states = new Map([['start', { cost: 0, fg: null, bg: null, glyph: '', previous: null }]])
  for (let column = 0; column < cols; column++) {
    const top = pixels[row * cols + column]
    const bottom = pixels[(row + 1) * cols + column]
    const next = new Map()
    for (const state of states.values()) {
      const options =
        top === bottom
          ? [
              // A full block only pins the foreground and a space only pins the
              // background, so one of the two carries the other colour forward
              // untouched.
              { glyph: '█', fg: top, bg: state.bg ?? top },
              { glyph: ' ', fg: state.fg ?? top, bg: top },
            ]
          : [
              { glyph: '▀', fg: top, bg: bottom },
              { glyph: '▄', fg: bottom, bg: top },
            ]
      for (const option of options) {
        const cost =
          state.cost +
          Buffer.byteLength(sequence(option.fg, option.bg, state.fg, state.bg)) +
          Buffer.byteLength(option.glyph)
        const key = `${option.fg},${option.bg}`
        const seen = next.get(key)
        if (seen !== undefined && seen.cost <= cost) continue
        next.set(key, { ...option, cost, previous: state })
      }
    }
    states = next
  }
  let winner = null
  for (const s of states.values()) if (winner === null || s.cost < winner.cost) winner = s
  const chain = []
  for (let n = winner; n !== null && n.previous !== null; n = n.previous) chain.push(n)
  chain.reverse()
  let line = ''
  let fg = null
  let bg = null
  for (const n of chain) {
    line += sequence(n.fg, n.bg, fg, bg) + n.glyph
    fg = n.fg
    bg = n.bg
  }
  // Every line ends neutral. A line that leaked its background would tint
  // whatever the client printed next.
  return `${line}${RESET}`
}

const lines = []
for (let row = 0; row < rows * 2; row += 2) lines.push(renderRow(row))
const art = `${lines.join('\n')}\n`

// Decode it the way a terminal would and check it is still the picture we were
// given. This is the only check that the byte-saving swaps above did not emit
// something cheaper but wrong.
const decoded = []
for (const line of art.split('\n').filter((l) => l !== '')) {
  const top = []
  const bottom = []
  let fg = null
  let bg = null
  for (let o = 0; o < line.length; ) {
    if (line[o] === '\x1b') {
      const m = /^\x1b\[([\d;]*)m/.exec(line.slice(o))
      if (m === null) throw new Error('rendered art contains a non-SGR control')
      const p = m[1] === '' ? [0] : m[1].split(';').map(Number)
      for (let i = 0; i < p.length; i++) {
        if (p[i] === 0) {
          fg = null
          bg = null
        } else if (p[i] === 38 && p[i + 1] === 5) {
          fg = p[i + 2]
          i += 2
        } else if (p[i] === 48 && p[i + 1] === 5) {
          bg = p[i + 2]
          i += 2
        }
      }
      o += m[0].length
      continue
    }
    const ch = line[o]
    if (ch === '▀') {
      top.push(fg)
      bottom.push(bg)
    } else if (ch === '▄') {
      top.push(bg)
      bottom.push(fg)
    } else if (ch === '█') {
      top.push(fg)
      bottom.push(fg)
    } else {
      top.push(bg)
      bottom.push(bg)
    }
    o++
  }
  decoded.push(top, bottom)
}
for (let y = 0; y < rows * 2; y++)
  for (let x = 0; x < cols; x++) {
    if (decoded[y][x] !== pixels[y * cols + x]) {
      throw new Error(`decode mismatch at ${x},${y}: the art does not draw the source`)
    }
  }

process.stderr.write(`${cols}x${rows} cells, ${Buffer.byteLength(art)} bytes, decode verified\n`)
process.stdout.write(art)
