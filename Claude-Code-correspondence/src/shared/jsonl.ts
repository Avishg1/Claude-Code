/**
 * Tolerant, incremental JSONL line parser.
 *
 * - Feed decoded text chunks with push(); complete physical lines are emitted immediately.
 * - Physical line numbers are 1-based and count blank lines too (blank lines are skipped).
 * - A UTF-8 BOM at the very start is removed. CRLF line endings are accepted.
 * - A malformed line yields a { kind: 'malformed' } entry and parsing continues.
 * - A final line without a trailing newline that does not parse is reported as 'pending'
 *   (the file may still be being written); one that parses is accepted as a normal record.
 */

export type ParsedLine =
  | { kind: 'ok'; line: number; value: unknown; noTrailingNewline?: boolean }
  | { kind: 'malformed'; line: number; rawText: string; error: string }
  | { kind: 'pending'; line: number; rawText: string; error: string };

export class JsonlLineParser {
  private buffer = '';
  private lineNo = 0;
  private sawFirstChunk = false;
  private finished = false;

  private readonly emit: (entry: ParsedLine) => void;

  constructor(emit: (entry: ParsedLine) => void) {
    this.emit = emit;
  }

  push(chunk: string): void {
    if (this.finished) throw new Error('parser already finished');
    if (!this.sawFirstChunk && chunk.length > 0) {
      this.sawFirstChunk = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    // Only scan the newly appended text for newlines (avoids O(n²) on very long lines).
    let scanFrom = this.buffer.length;
    this.buffer += chunk;
    let start = 0;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n', scanFrom)) !== -1) {
      scanFrom = nl + 1;
      let line = this.buffer.slice(start, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.lineNo++;
      this.handleLine(line, this.lineNo, false);
      start = nl + 1;
    }
    this.buffer = start === 0 ? this.buffer : this.buffer.slice(start);
  }

  /** Flush the trailing partial line (if any). */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.buffer.length === 0) return;
    let line = this.buffer;
    this.buffer = '';
    if (line.endsWith('\r')) line = line.slice(0, -1);
    this.lineNo++;
    this.handleLine(line, this.lineNo, true);
  }

  get physicalLines(): number {
    return this.lineNo;
  }

  private handleLine(text: string, line: number, isFinalUnterminated: boolean): void {
    if (text.trim() === '') return;
    try {
      const value: unknown = JSON.parse(text);
      this.emit(isFinalUnterminated ? { kind: 'ok', line, value, noTrailingNewline: true } : { kind: 'ok', line, value });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit(isFinalUnterminated ? { kind: 'pending', line, rawText: text, error } : { kind: 'malformed', line, rawText: text, error });
    }
  }
}

/** Convenience helper for tests and small inputs. */
export function parseJsonlText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const p = new JsonlLineParser((e) => out.push(e));
  p.push(text);
  p.finish();
  return out;
}
