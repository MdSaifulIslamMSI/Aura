export const extractJsonReport = (output) => {
  const starts = [...output.matchAll(/[\[{]/g)].map((match) => match.index);
  for (const start of starts) {
    const closing = output[start] === '{' ? '}' : ']';
    let end = output.lastIndexOf(closing);
    while (end > start) {
      try {
        return `${JSON.stringify(JSON.parse(output.slice(start, end + 1)), null, 2)}\n`;
      } catch {
        end = output.lastIndexOf(closing, end - 1);
      }
    }
  }
  throw new Error('Scanner did not produce a valid JSON report');
};
