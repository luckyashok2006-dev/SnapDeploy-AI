/**
 * Stream-safe, boundary-aware ANSI escape tracker and reset utility.
 * 
 * Preserves legitimate multi-chunk ANSI formatting sequences and explicit resets
 * while ensuring that unclosed formatting from one logical segment or line
 * never bleeds into subsequent normal lines or prompt output.
 */

const ANSI_SGR_REGEX = /\x1b\[([0-9;]*)m/g;

export interface AnsiState {
  hasActiveFormatting: boolean;
  isBold: boolean;
  isUnderline: boolean;
  hasColor: boolean;
}

export class AnsiStreamTracker {
  private hasActiveStyle = false;
  private isBold = false;
  private isUnderline = false;
  private hasColor = false;
  private pendingPartial = '';

  /**
   * Processes a streaming chunk. Buffers partial escape sequences that cross chunk
   * boundaries and accurately maintains whether SGR styling is currently active.
   */
  public processChunk(rawChunk: string): { output: string; hasActiveStyle: boolean } {
    const fullText = this.pendingPartial + rawChunk;
    this.pendingPartial = '';

    // Check if the chunk ends with an incomplete escape sequence (e.g. \x1b or \x1b[3)
    const incompleteMatch = fullText.match(/\x1b(\[[0-9;]*)?$/);
    let completeText = fullText;
    if (incompleteMatch && incompleteMatch.index !== undefined) {
      this.pendingPartial = fullText.slice(incompleteMatch.index);
      completeText = fullText.slice(0, incompleteMatch.index);
    }

    // Inspect all complete SGR sequences in this chunk
    ANSI_SGR_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ANSI_SGR_REGEX.exec(completeText)) !== null) {
      const paramStr = match[1] ?? '';
      const params = paramStr === '' ? [0] : paramStr.split(';').map((p) => parseInt(p, 10) || 0);

      for (const p of params) {
        if (p === 0) {
          // Explicit reset
          this.hasActiveStyle = false;
          this.isBold = false;
          this.isUnderline = false;
          this.hasColor = false;
        } else if (p === 1) {
          this.isBold = true;
          this.hasActiveStyle = true;
        } else if (p === 22) {
          this.isBold = false;
          this.checkOverallActive();
        } else if (p === 4) {
          this.isUnderline = true;
          this.hasActiveStyle = true;
        } else if (p === 24) {
          this.isUnderline = false;
          this.checkOverallActive();
        } else if ((p >= 30 && p <= 39) || (p >= 90 && p <= 97) || (p >= 40 && p <= 49) || (p >= 100 && p <= 107)) {
          if (p === 39 || p === 49) {
            this.hasColor = false;
            this.checkOverallActive();
          } else {
            this.hasColor = true;
            this.hasActiveStyle = true;
          }
        } else {
          this.hasActiveStyle = true;
        }
      }
    }

    return {
      output: completeText,
      hasActiveStyle: this.hasActiveStyle
    };
  }

  private checkOverallActive() {
    this.hasActiveStyle = this.isBold || this.isUnderline || this.hasColor;
  }

  /**
   * Returns whether formatting is currently open/unreset.
   */
  public hasActiveFormatting(): boolean {
    return this.hasActiveStyle;
  }

  public getState(): AnsiState {
    return {
      hasActiveFormatting: this.hasActiveStyle,
      isBold: this.isBold,
      isUnderline: this.isUnderline,
      hasColor: this.hasColor
    };
  }

  /**
   * At a logical boundary (e.g. between discrete log lines or at command completion),
   * emits \x1b[0m ONLY if formatting was left unclosed by the process.
   * If already clean or explicitly reset, returns empty string without redundant resets.
   */
  public boundaryReset(): string {
    if (this.hasActiveStyle) {
      this.hasActiveStyle = false;
      this.isBold = false;
      this.isUnderline = false;
      this.hasColor = false;
      this.pendingPartial = '';
      return '\x1b[0m';
    }
    this.pendingPartial = '';
    return '';
  }

  /**
   * Resets internal tracker state completely.
   */
  public reset(): void {
    this.hasActiveStyle = false;
    this.isBold = false;
    this.isUnderline = false;
    this.hasColor = false;
    this.pendingPartial = '';
  }
}

/**
 * Format a discrete log line, ensuring that if it opened formatting without resetting,
 * an explicit reset is appended strictly at the boundary so subsequent lines stay normal.
 */
export function formatBoundarySafeLog(line: string): string {
  if (!line) return line;
  const tracker = new AnsiStreamTracker();
  const { output } = tracker.processChunk(line);
  const reset = tracker.boundaryReset();
  return output + reset;
}
