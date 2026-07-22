export function createReport() {
  const lines = [];
  return {
    add(line) { lines.push(String(line)); },
    toString() { return lines.join('\n'); },
    lines,
  };
}
