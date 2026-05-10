/**
 * RFC 4180-flavoured CSV parser. Hand-rolled because the import path is
 * small (one Bitwarden export at a time) and pulling `papaparse` for ~80
 * lines of logic isn't a fair trade on a security-conscious app.
 *
 * Handles:
 *  - quoted fields with embedded commas/newlines
 *  - escaped quotes (`""` → `"`)
 *  - LF and CRLF line endings
 *  - empty trailing rows (a Bitwarden export ends with a newline)
 *
 * Returns an array of rows; each row is an array of cells. The header is
 * the first row; the caller is responsible for mapping it.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n" || c === "\r") {
        // Treat \r\n as one terminator.
        if (c === "\r" && input[i + 1] === "\n") i++;
        row.push(cell);
        cell = "";
        // Skip empty rows from trailing newlines.
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        cell += c;
      }
    }
  }
  // Flush a trailing partial row that didn't end with a newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}
