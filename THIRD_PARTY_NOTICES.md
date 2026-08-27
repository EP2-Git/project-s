# Third-party notices

Project S uses open-source packages recorded exactly in `package-lock.json`. `npm run licenses:check` reads every installed package manifest, fails on missing or unreviewed license expressions, and prints the reviewed license-family counts.

The current allowlisted dependency license families are:

- 0BSD, ISC, MIT, MIT-0, and MIT AND ISC
- Apache-2.0 and Apache-2.0 AND MIT
- BSD-2-Clause and BSD-3-Clause
- BlueOak-1.0.0
- CC0-1.0 and CC-BY-4.0
- MPL-2.0
- Python-2.0

Notable direct projects include React (MIT), Vite (MIT), Supabase JS/CLI (MIT), Radix UI (MIT), Tailwind CSS (MIT), Lucide (ISC), Playwright (Apache-2.0), Axe integration tooling (MPL-2.0), and Vitest (MIT).

This file is a release-review summary, not a replacement for upstream copyright/license texts. Before a tagged release, archive the exact `package-lock.json`, the successful license-check output, and any notices required by Apache-2.0 or an upstream dependency. A newly introduced license expression blocks CI until reviewed deliberately.

The baseline uses system font fallbacks and bundles no font files. If a font is later bundled or loaded from a remote service, record its source and license in `ASSET_PROVENANCE.md`, include any required license text, and update the privacy disclosure.

## Bundled source notices

Portions of `src/components/ui/`, `src/hooks/use-mobile.tsx`,
`src/hooks/use-toast.ts`, and `src/lib/utils.ts` were derived from or adapted
from [shadcn/ui](https://github.com/shadcn-ui/ui). Project S includes local
modifications. These portions are redistributed under the following MIT
License:

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
