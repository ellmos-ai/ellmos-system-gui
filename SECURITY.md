# Security policy

Please use GitHub private vulnerability reporting for security issues in this repository. Avoid posting credentials, private host details, or user data in public issues.

The static frontend relies on each consumer's authenticated API adapter. A release archive contains no API credentials or server configuration. Consumer deployments must validate source revision and artifact hashes before installation.

## Mermaid / KaTeX transitive dependency experiment

Mermaid remains pinned to 11.17.2. Its declared KaTeX range is `^0.16.47`; the root package manifest and lockfile narrowly override Mermaid's KaTeX dependency to 0.18.7 to address [GHSA-238p-pmpm-9mq7](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7). This compatibility experiment does not certify every diagram input or HTML insertion path as safe. The memory page continues to initialize Mermaid with `securityLevel: "strict"`; diagram content and any downstream HTML handling must still be treated carefully. This change does not add a Content Security Policy or make a CSP guarantee.
