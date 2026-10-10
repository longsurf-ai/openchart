// Purpose: Decode a Workspace Dataset's CSV text into declared timeseries rows, naming the row and column at fault.
import { DateTime, Option } from "effect";
import type { DatasetColumn } from "@openchart/server/resources/workspace-dataset/entity";

/**
 * Splits RFC 4180 CSV text into records. Commas separate fields; LF or CRLF
 * ends a record; a field that starts with a double quote may hold commas, line
 * breaks and doubled quotes. A byte-order mark and a final line break are ignored.
 * @throws If the text ends inside a quoted field.
 * @example parseCsv('a,b\n1,"x,y"\n'); // [["a","b"],["1","x,y"]]
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("The file ends inside a quoted field");
  if (field !== "" || record.length > 0) records.push([...record, field]);
  return records;
}

/** One decoded observation: epoch-millisecond time plus each declared column. */
export type DatasetRow = { readonly time: number } & Record<
  string,
  number | string | boolean | null
>;

function parseTime(text: string, line: number, column: string): number {
  const value = text.trim();
  const time = DateTime.make(/^-?\d+$/.test(value) ? Number(value) : value);
  if (Option.isNone(time))
    throw new Error(
      `Row ${line}: "${column}" must be epoch milliseconds or an ISO 8601 time, not "${text}"`,
    );
  return DateTime.toEpochMillis(time.value);
}

function parseValue(
  text: string,
  { name, type }: DatasetColumn,
  line: number,
): number | string | boolean | null {
  // CSV has no null; an empty cell is a missing value of any type.
  if (text.trim() === "") return null;
  if (type === "string") return text;
  if (type === "boolean") {
    if (/^true$/i.test(text.trim())) return true;
    if (/^false$/i.test(text.trim())) return false;
  } else {
    const value = Number(text);
    if (!Number.isNaN(value) || text.trim() === "NaN") return value;
  }
  throw new Error(`Row ${line}: "${name}" must be a ${type}, not "${text}"`);
}

/**
 * Reads the declared time column and observation columns from CSV text.
 * Headers are trimmed and matched exactly; other columns are ignored and
 * blank lines skipped. Times may be epoch milliseconds or ISO 8601 (a date
 * alone is UTC midnight). Rows are returned in ascending time order, since
 * collected files are often newest first; repeated times remain an error for
 * the DataFrame to report.
 * @throws With the first header, row or cell that does not match the declaration.
 * @example decodeRows("date,cpi\n2024-01-01,308.4\n", {time: {column: "date"}, columns: [{name: "cpi", type: "number"}]});
 */
export function decodeRows(
  text: string,
  declaration: {
    readonly time: { readonly column: string };
    readonly columns: readonly DatasetColumn[];
  },
): DatasetRow[] {
  const [header, ...records] = parseCsv(text).filter(
    (record) => record.length > 1 || record[0]!.trim() !== "",
  );
  if (!header) throw new Error("The file has no header row");
  const names = header.map((name) => name.trim());
  const indexOf = (name: string) => {
    const index = names.indexOf(name);
    if (index < 0) throw new Error(`The header has no "${name}" column`);
    return index;
  };
  const { column: timeColumn } = declaration.time;
  if (declaration.columns.some((column) => column.name === timeColumn))
    throw new Error(
      `"${timeColumn}" is the time column and cannot also be an observation column`,
    );
  const time = indexOf(timeColumn);
  const columns = declaration.columns.map(
    (column) => [column, indexOf(column.name)] as const,
  );
  const rows = records.map((record, index) => {
    const line = index + 2;
    if (record.length !== names.length)
      throw new Error(
        `Row ${line} has ${record.length} fields; the header has ${names.length}`,
      );
    const row: Record<string, number | string | boolean | null> = {
      time: parseTime(record[time]!, line, timeColumn),
    };
    for (const [column, at] of columns)
      row[column.name] = parseValue(record[at]!, column, line);
    return row as DatasetRow;
  });
  return rows.sort((left, right) => left.time - right.time);
}
