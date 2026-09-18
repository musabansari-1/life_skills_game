/**
 * Incremental Server-Sent Events parser. Pure, no DOM/Node APIs: feed it text
 * chunks as they arrive (from `fetch` body readers, React Native streaming
 * fetch, or an XHR onprogress handler) and it emits complete events.
 */
export interface SSEEvent {
  event: string;
  data: string;
}

export class SSEParser {
  private buffer = "";

  /** Feed a decoded text chunk; returns any events completed by it. */
  push(chunk: string): SSEEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const out: SSEEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const ev = parseBlock(block);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Flush a trailing event that wasn't terminated by a blank line. */
  end(): SSEEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    const ev = rest ? parseBlock(rest) : null;
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): SSEEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon >= 0 ? line.slice(0, colon) : line;
    const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, "") : "";
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}
