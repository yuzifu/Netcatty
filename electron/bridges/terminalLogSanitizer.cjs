/**
 * Terminal log sanitizer.
 *
 * This is intentionally stateful: terminal output is a stream of cursor and
 * erase operations, not plain text with decoration. The renderer below keeps a
 * small virtual text buffer so plain-text and HTML logs reflect what common
 * line-editing output actually leaves on screen.
 */

const CSI_FINAL_RE = /[@-~]/;

class TerminalTextRenderer {
  constructor() {
    this.lines = [[]];
    this.row = 0;
    this.col = 0;
    this.state = "normal";
    this.escapeBuffer = "";
  }

  feed(input) {
    if (!input) return;

    for (const ch of input) {
      this.#consume(ch);
    }
  }

  finish() {
    this.state = "normal";
    this.escapeBuffer = "";
    return this.toString();
  }

  toString() {
    return this.lines
      .map((line) => line.join("").replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\n+$/g, "");
  }

  #consume(ch) {
    if (this.state === "esc") {
      this.#consumeEsc(ch);
      return;
    }
    if (this.state === "csi") {
      this.escapeBuffer += ch;
      if (CSI_FINAL_RE.test(ch)) {
        this.#applyCsi(this.escapeBuffer);
        this.state = "normal";
        this.escapeBuffer = "";
      }
      return;
    }
    if (this.state === "osc") {
      if (ch === "\x07") {
        this.state = "normal";
        this.escapeBuffer = "";
        return;
      }
      if (ch === "\x1b") {
        this.state = "oscEsc";
      }
      return;
    }
    if (this.state === "oscEsc") {
      this.state = ch === "\\" ? "normal" : "osc";
      return;
    }

    switch (ch) {
      case "\x1b":
        this.state = "esc";
        this.escapeBuffer = "";
        break;
      case "\b":
        this.col = Math.max(0, this.col - 1);
        break;
      case "\r":
        this.col = 0;
        break;
      case "\n":
        this.row += 1;
        this.col = 0;
        this.#ensureLine();
        break;
      case "\t":
        this.#writeText(" ".repeat(8 - (this.col % 8)));
        break;
      default:
        if (this.#isPrintable(ch)) this.#writeText(ch);
        break;
    }
  }

  #consumeEsc(ch) {
    if (ch === "[") {
      this.state = "csi";
      this.escapeBuffer = "";
      return;
    }
    if (ch === "]") {
      this.state = "osc";
      this.escapeBuffer = "";
      return;
    }
    // Single-character ESC sequences are terminal controls. Ignore them for
    // logs, but consume them so they never leak into txt/html output.
    this.state = "normal";
    this.escapeBuffer = "";
  }

  #applyCsi(sequence) {
    const final = sequence.at(-1);
    const params = sequence.slice(0, -1);
    const values = params
      .replace(/[?><=]/g, "")
      .split(";")
      .map((part) => {
        if (part === "") return undefined;
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : undefined;
      });
    const n = values[0] || 1;

    switch (final) {
      case "A":
        this.row = Math.max(0, this.row - n);
        this.#ensureLine();
        break;
      case "B":
      case "E":
        this.row += n;
        if (final === "E") this.col = 0;
        this.#ensureLine();
        break;
      case "C":
        this.col += n;
        break;
      case "D":
        this.col = Math.max(0, this.col - n);
        break;
      case "F":
        this.row = Math.max(0, this.row - n);
        this.col = 0;
        this.#ensureLine();
        break;
      case "G":
        this.col = Math.max(0, n - 1);
        break;
      case "H":
      case "f":
        this.row = Math.max(0, (values[0] || 1) - 1);
        this.col = Math.max(0, (values[1] || 1) - 1);
        this.#ensureLine();
        break;
      case "J":
        this.#eraseDisplay(values[0] || 0);
        break;
      case "K":
        this.#eraseLine(values[0] || 0);
        break;
      default:
        // SGR and unsupported CSI controls are intentionally ignored.
        break;
    }
  }

  #writeText(text) {
    this.#ensureLine();
    const line = this.lines[this.row];
    while (line.length < this.col) line.push(" ");
    for (const ch of text) {
      line[this.col] = ch;
      this.col += 1;
    }
  }

  #eraseLine(mode) {
    this.#ensureLine();
    const line = this.lines[this.row];
    if (mode === 1) {
      for (let i = 0; i <= this.col && i < line.length; i += 1) line[i] = " ";
      return;
    }
    if (mode === 2) {
      this.lines[this.row] = [];
      this.col = 0;
      return;
    }
    line.length = Math.min(line.length, this.col);
  }

  #eraseDisplay(mode) {
    this.#ensureLine();
    if (mode === 2 || mode === 3) {
      this.lines = [[]];
      this.row = 0;
      this.col = 0;
      return;
    }
    if (mode === 1) {
      this.lines = this.lines.slice(this.row);
      this.row = 0;
      this.#eraseLine(1);
      return;
    }
    this.#eraseLine(0);
    this.lines.length = this.row + 1;
  }

  #ensureLine() {
    while (this.lines.length <= this.row) this.lines.push([]);
  }

  #isPrintable(ch) {
    const code = ch.codePointAt(0);
    if (code === undefined) return false;
    return code >= 0x20 && code !== 0x7f;
  }
}

function terminalDataToPlainText(terminalData) {
  const renderer = new TerminalTextRenderer();
  renderer.feed(terminalData || "");
  return renderer.finish();
}

function createTerminalTextRenderer() {
  return new TerminalTextRenderer();
}

module.exports = {
  TerminalTextRenderer,
  createTerminalTextRenderer,
  terminalDataToPlainText,
};
