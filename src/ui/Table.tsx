import type { ReactElement, ReactNode } from 'react';

export interface Column<T> {
  readonly header: string;
  /** Right-aligned and tabular, so digits line up down the column. */
  readonly numeric?: boolean;
  readonly cell: (row: T) => ReactNode;
}

/**
 * A list of rows with a header, zebra striping, and something to say when there are none.
 *
 * Columns are keyed by position, not by header: the first thing this table has to show is a
 * conflict side by side (`CLAUDE.md` §6), which is two columns with the same heading.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  /** What the table says instead of nothing at all. */
  readonly empty: string;
}): ReactElement {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-grey-300 px-4 py-8 text-center text-grey-500">
        {empty}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-grey-300">
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={`px-3 py-2 text-sm font-semibold text-grey-600 ${column.numeric === true ? 'text-right' : ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-grey-200 even:bg-grey-50">
              {columns.map((column, index) => (
                <td
                  key={index}
                  className={`px-3 py-2 align-top text-grey-800 ${column.numeric === true ? 'text-right tabular-nums' : ''}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
