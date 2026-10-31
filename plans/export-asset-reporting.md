---
id: export-asset-reporting
status: done
track: reliability
depends: []
touches: [export/export.ts, export/export.test.ts]
owner: ai
---

# Report unavailable export assets

Configured asset directories that cannot be read must appear in the returned warnings, including
their source path and the filesystem error. An omitted asset list remains valid. Keep exporting
readable mounts so the caller can inspect the partial result, with warnings available to its gate.

- [x] Add regressions for missing mounts and an invalid directory path.
- [x] Record directory failures in the export report without discarding successful mounts.
- [x] Run the focused tests and the repository gates.
