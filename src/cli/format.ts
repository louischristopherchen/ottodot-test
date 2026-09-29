// Small helpers for readable terminal output in the CLI scripts.

const sgt = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatSgt(iso: string): string {
  return `${sgt.format(new Date(iso))} SGT`;
}

export function table(headers: string[], rows: string[][], indent = '  '): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: string[]) =>
    indent + cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('   ').trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}
