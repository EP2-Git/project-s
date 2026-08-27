# Asset provenance

Status: current tracked asset inventory cleared for the public pre-alpha on
2026-08-26. Any new asset requires a new provenance review.

| Asset | Current source | Status | Required action |
|---|---|---|---|
| `public/favicon.svg` | Self-contained SVG first recorded in the private publication candidate on 2026-08-19; the Project S rename changed only its accessible label | Cleared by owner on 2026-08-26 | Ethan Patten attests that, to the best of his knowledge, the SVG was created for the private project, was not copied from a third-party vector asset, is controlled by the project owner, and may be redistributed and modified with Project S Core under Apache-2.0. This does not claim trademark registration or grant trademark rights beyond Apache-2.0 section 6. |
| Lucide interface icons | `lucide-react` dependency | Cleared | ISC; covered by package/license review. |
| Radix/shadcn-derived UI | Source components and dependencies | Cleared with notice | MIT upstream; preserve relevant notices and review local modifications. |

The historic `favicon.ico`, fake PNG favicon/apple-touch files, generated placeholder, and their HTML/manifest references were removed. The application now uses system font fallbacks and makes no remote Google Fonts request. Those removed files are not approved for reintroduction from repository history.

No screenshot, photo, customer logo, booking export, or database dump is approved for the public distribution unless added to this table with creator, source URL or source record, date obtained, license/ownership basis, modifications, and reviewer.

The public pre-alpha tracks no photos, screenshots, customer logos, custom font
files, booking exports, or database dumps. Generated demo evidence remains ignored
and is not part of the source distribution.

Legacy wordmark/logo files outside the repository are not automatically approved merely because they exist on the developer machine. Explicit owner attestation is required before copying them into the candidate.
