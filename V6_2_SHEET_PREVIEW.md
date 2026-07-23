# ConnectChat Pro Enterprise v6.2

## Double-click preview

An authorized user can double-click a calculation-sheet card or select **Open**.

- PDF files open inside a secure preview.
- XLSX workbooks display as a scrollable table.
- Workbook worksheet tabs can be selected.
- CSV files display as a table.
- The original file can be downloaded from the preview.

All preview requests repeat the same administrator-only and selected-user
authorization checks used for downloads.

## Formula results

For XLSX workbooks, ConnectChat displays the formula results saved in the
uploaded workbook. It does not recalculate or alter engineering formulas. Open
and save the workbook in Excel before uploading when the latest calculated
values must be shown.

Legacy binary XLS files remain downloadable but are not parsed on the server.
Save them as XLSX to enable preview.

No additional database migration is required beyond the v6/v6.1 sheet
permissions migration.
