# Security policy

Please use GitHub private vulnerability reporting for security issues in this repository. Avoid posting credentials, private host details, or user data in public issues.

The static frontend relies on each consumer's authenticated API adapter. A release archive contains no API credentials or server configuration. Consumer deployments must validate source revision and artifact hashes before installation.

## Mermaid / KaTeX transitive dependency experiment

Mermaid remains pinned to 11.17.2. Its declared KaTeX range is `^0.16.47`; the root package manifest and lockfile narrowly override Mermaid's KaTeX dependency to 0.18.7 to address [GHSA-238p-pmpm-9mq7](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7). This compatibility experiment does not certify every diagram input or HTML insertion path as safe. The memory page continues to initialize Mermaid with `securityLevel: "strict"`; diagram content and any downstream HTML handling must still be treated carefully. This change does not add a Content Security Policy or make a CSP guarantee.


## DOMPurify lockfile patch (2026-10-23)

The lockfile resolves Mermaid's existing DOMPurify range to 3.4.17. No direct
dependency, override, Mermaid upgrade, or sanitizer configuration change is added.
The maintainer's [3.4.17 release](https://github.com/cure53/DOMPurify/releases/tag/3.4.17)
addresses [split shadow-root templates](https://github.com/advisories/GHSA-cg2g-xh64-v4q7),
[detached in-place nodes](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr), and
[the XHTML SMIL guard](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f).

The current application call site uses Mermaid strict mode, string diagram input
and SVG output, without the non-default DOMPurify modes used by these advisories.
This source inspection is not a claim that every diagram parser or deployment is
safe. Synthetic browser regressions cover the affected modes separately from the
production call site. Run them explicitly with an existing Chromium executable:

    node tests/run-dompurify-browser.mjs /path/to/chromium receipt.json

The runner uses a fresh temporary profile, blocks hostname resolution, and never
connects to a consumer API or downloads a browser. It fails on missing browser
output or any failed case. Normal Node tests also check the installed sanitizer,
lockfile integrity, unchanged Mermaid/KaTeX pins and strict/theme configuration.
A source or audit result does not update already installed consumer archives.
