// TCP is a stream: one `data` event can hold half a message or three messages.
// LineSplitter collects chunks and hands out complete lines ("\n"-terminated).
// It refuses to buffer more than maxBytes without a newline (protects memory).

export type LineResult = { readonly lines: readonly string[]; readonly overflow: boolean };

export class LineSplitter {
  private buffer = "";

  constructor(private readonly maxBytes: number) {}

  push(chunk: string): LineResult {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    const lines = parts.map((line) => line.replace(/\r$/, "")).filter((line) => line !== "");
    const overflow =
      this.buffer.length > this.maxBytes || lines.some((line) => line.length > this.maxBytes);
    return { lines, overflow };
  }
}
