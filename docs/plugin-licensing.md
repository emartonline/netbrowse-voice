# Community Edition and Future Commercial Module Policy

## Current public Community Edition

The Netbrowse Voice Community Edition is copyright © 2026 Netbrowse Media
(PTY) LTD and is licensed under the GNU General Public License, version 3 or
(at your option) any later version (GPL-3.0-or-later). The current public
repository and Community Edition release archives include the PBX control plane,
web interfaces, installer, first-party modules, documented extension points and
`@netbrowse-voice/module-sdk`.

The GPL applies to material that Netbrowse Media (PTY) LTD has authority to
license. It does not replace the licences of operating-system packages,
Asterisk, audio libraries, npm dependencies, external APIs or other
third-party components.

## Future independent commercial offerings

Netbrowse Media (PTY) LTD may later publish premium modules, hosted services,
managed deployments or support plans under separate commercial terms. No such
component is included in the current Community Edition or required to operate
the functionality demonstrated in this repository.

Any future proprietary offering must be independently deployable and must not
copy, link with or require undisclosed modifications to GPL-covered Community
Edition source. It should communicate through a documented network API, event
contract or separately operated service boundary. Importing, linking to or
embedding GPL-covered code can create GPL obligations; this document does not
grant an exception or decide that legal question.

Before any commercial release, Netbrowse Media (PTY) LTD should obtain advice
from qualified counsel on the actual implementation, distribution model,
dependency licences and applicable jurisdictions.

## Community modules

Community contributors retain their copyright in original contributions, subject
to the contribution licence in [CONTRIBUTING.md](../CONTRIBUTING.md).
Compatibility with Netbrowse Voice does not transfer ownership, grant trademark
rights or constitute an endorsement by Netbrowse Media (PTY) LTD.

## Trademarks and attribution

GPL-3.0-or-later licences code; it does not grant rights to the names, logos or
other marks of Netbrowse Media (PTY) LTD or Netbrowse Voice. Use the product
name only to accurately describe compatibility or origin, and retain required
copyright and third-party notices when redistributing the Community Edition.
See [TRADEMARKS.md](../TRADEMARKS.md).

## Asterisk integration

Netbrowse Voice controls Asterisk through external service interfaces. The
project does not grant rights in Asterisk itself or in any third-party telephony
software. Native Asterisk loadable-module work, redistributed third-party media
and any future proprietary integration should receive a separate licensing
review before commercial release.
