# ConnectChat Pro Enterprise v6.2.2

## Fixed page and panel scrolling

- The application stays within the visible browser window.
- Contacts, messages, workspace pages, insights and previews have independent
  scrollbars.
- Mouse-wheel movement is contained inside the panel under the pointer.
- Ctrl/Command plus mouse-wheel zoom is blocked while the application is open,
  preventing accidental page resizing.

## Double-click preview

An authorized user can double-click a calculation-sheet card or select **Open**.

- PDF files open inside a secure preview.
- XLSX workbooks display as a scrollable table.
- If nonessential Excel drawing or validation metadata is incompatible, the
  server retries the workbook without those preview-only parts.
- Workbook worksheet tabs can be selected.
- CSV files display as a table.
- The original file can be downloaded from the preview.

All preview requests repeat the same administrator-only and selected-user
authorization checks used for downloads.

New administrator uploads default to **All approved users**. To make files
uploaded with v6.2 visible to ordinary users, run
`v6.2.1-existing-sheet-visibility-fix.sql` once.

## Formula results

For XLSX workbooks, ConnectChat displays the formula results saved in the
uploaded workbook. It does not recalculate or alter engineering formulas. Open
and save the workbook in Excel before uploading when the latest calculated
values must be shown.

Legacy binary XLS files remain downloadable but are not parsed on the server.
Save them as XLSX to enable preview.

Fresh installations still require the v6 calculation-sheet permissions
migration. Existing v6.2 installations should also run the small v6.2.1
visibility fix described above.
