# Asset provenance

Status: current tracked asset inventory cleared for the public pre-alpha on
2026-08-26. The two 0.1.1 repository-presentation assets below are approved for
public draft review; merge and GitHub social-preview upload remain owner review
gates.

| Asset | Current source | Status | Required action |
|---|---|---|---|
| `public/favicon.svg` | Self-contained SVG first recorded in the private publication candidate on 2026-08-19; the Project S rename changed only its accessible label | Cleared by owner on 2026-08-26 | Ethan Patten attests that, to the best of his knowledge, the SVG was created for the private project, was not copied from a third-party vector asset, is controlled by the project owner, and may be redistributed and modified with Project S Core under Apache-2.0. This does not claim trademark registration or grant trademark rights beyond Apache-2.0 section 6. |
| `docs/assets/authority-boundary-overview.webp` | Project-owned derivative regenerated from the real synthetic Authority Boundary capture path on 2026-08-28. Inputs: `02-review-mobile.png`, `03-human-authority-recorded-mobile.png`, and `04-committed-booking.png` from `npm run demo:authority:capture`; composition: `scripts/render-public-repository-assets.mjs` | Approved for public draft review; owner merge review required | The joined test ran the real local stdio MCP, browser approval, PostgreSQL commit/replay, authenticated dashboard, and cancellation flow. Captures use only the seeded fictional fixture and remove the preparation fragment before screenshots. The 780×2727 single-column composition keeps its state labels and explanatory captions readable when rendered at 390×1364. Output SHA-256: `ca8fb325d310d0e56b5ff212adc47220bf5db750efb8d52f5962c745aeebccf8`. The image captions explain the assertions; the screenshot alone is not represented as transactional proof. |
| `docs/assets/project-s-social-preview.png` | Project-owned repository card generated on 2026-08-29 by `scripts/render-public-repository-assets.mjs`. The composition uses the cleared `public/favicon.svg` mark and a synthetic booking surface derived from the fictional `Demo Host` fixture in `SelectedDirection.tsx`; all other shapes and copy are native HTML/CSS with system fonts. | Candidate for owner approval and manual GitHub upload | No customer data, hosted-service claim, third-party logo, stock asset, or generated imagery. The 1280x640 PNG is 73,044 bytes; its primary headline and booking surface were visually checked at 640x320 and 320x160. Output SHA-256: `b3c86b9456164b96135413b411e4cef247ee76e66de889b86986b632201b9f04`. Keep the repository homepage URL empty and do not upload until owner review. |
| Lucide interface icons | `lucide-react` dependency | Cleared | ISC; covered by package/license review. |
| Radix/shadcn-derived UI | Source components and dependencies | Cleared with notice | MIT upstream; preserve relevant notices and review local modifications. |

The historic `favicon.ico`, fake PNG favicon/apple-touch files, generated placeholder, and their HTML/manifest references were removed. The application now uses system font fallbacks and makes no remote Google Fonts request. Those removed files are not approved for reintroduction from repository history.

No other screenshot, photo, customer logo, booking export, or database dump is
approved for the public distribution unless added to this table with creator,
source URL or source record, date obtained, license/ownership basis,
modifications, and reviewer.

The public pre-alpha tracks no photos, customer logos, custom font files, booking
exports, or database dumps. Raw generated demo evidence remains ignored and is
not part of the source distribution; only the reviewed derivative listed above
is tracked.

Legacy wordmark/logo files outside the repository are not automatically approved merely because they exist on the developer machine. Explicit owner attestation is required before copying them into the candidate.
