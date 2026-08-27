# License decision

Status: accepted by the project owner on 2026-08-26.

## Decision: Apache License 2.0

Project S Core is distributed under the Apache License 2.0 (`Apache-2.0`). The
repository includes the unmodified official license text in `LICENSE`, and the
root and workspace package manifests use the same SPDX identifier.

The owner selected this permissive license because it supports broad use,
modification, contribution, and independent hosting while adding explicit patent
grants and a defined patent-termination mechanism. Downstream hosted forks are not
required to publish their changes solely because they operate over a network.

## Core and Cloud consequence

Project S Cloud may charge for managed operation, upgrades, monitoring, and
convenience. It must run the same authority and scheduling correctness boundary as
Core; managed operation is not permission to move, bypass, or fork consequential
authority logic into proprietary cloud-only code.

## Contributions and marks

Intentional contributions are accepted only under Apache-2.0 on the same inbound
and outbound terms and without additional restrictions. A contributor must have
the right to submit the work; an incompatible notice is not an opt-out that the
project will accept. Section 6 of the license does not grant trademark rights.
“Project S” is a working open-source project identity, not a claim of trademark
registration or clearance.

No project-level `NOTICE` file is included because the current attribution review
found no project-specific notice that must be propagated. Third-party dependency
licenses and notices remain governed by their upstream terms and are summarized in
`THIRD_PARTY_NOTICES.md`.
