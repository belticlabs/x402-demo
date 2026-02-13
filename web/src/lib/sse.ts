/**
 * Simple line-buffer parser for streamed text.
 * Handles chunk boundaries where a logical line may be split across reads.
 */
export function createLineBufferParser() {
  let buffer = '';

  return {
    push(chunk: string): string[] {
      if (!chunk) return [];
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return lines.map((line) =>
        line.endsWith('\r') ? line.slice(0, -1) : line
      );
    },

    flush(): string[] {
      if (!buffer) return [];
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      buffer = '';
      return line ? [line] : [];
    },
  };
}

export function parseSseDataLine(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  return line.slice(5).trimStart();
}
