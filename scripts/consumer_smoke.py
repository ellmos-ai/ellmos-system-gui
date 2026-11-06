"""Consumer smoke: run the BACH page gate over every page of a built dist.

Mandatory release step (RELEASE_GATE.md). BACH answers a shared page with 503
shared_gui_page_missing unless its own parser accepts dist/page-reads.v1.json
and lists the page; an invalid manifest takes down EVERY page (0.2.34 shipped
that way). This script applies BACH's real verification, not a copy of it.

    python scripts/consumer_smoke.py --bach <bach checkout> [--dist dist] [--commit <sha>]

Exit 0 only if the dist is verified and every page passes. The commit defaults
to dist-manifest.json source_commit (pass --commit to pin it independently).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--bach", required=True, help="BACH checkout containing system/hub")
    parser.add_argument("--dist", default=str(Path(__file__).resolve().parent.parent / "dist"))
    parser.add_argument("--commit", help="expected source commit (default: from dist-manifest.json)")
    args = parser.parse_args()
    dist = Path(args.dist).resolve()
    system = Path(args.bach).resolve() / "system"
    if not (system / "hub" / "_services" / "gui_contract_service.py").is_file():
        print(f"FAIL: no BACH consumer code under {system}")
        return 2
    sys.path.insert(0, str(system))
    from hub._services.gui_contract_service import verify_installed_dist  # BACH's own gate

    commit = args.commit or json.loads((dist / "dist-manifest.json").read_text(encoding="utf-8"))["source_commit"]
    base = verify_installed_dist(dist, expected_commit=commit)
    pages = base.get("page_paths", [])
    print(f"dist {dist}: verified={base.get('verified')} commit={commit[:12]} page_count={base.get('page_count')} paths={len(pages)}")
    failures = []
    if not base.get("verified") or not pages:
        failures.append(("(dist)", base.get("reason_code", "not verified")))
    for page in pages:
        info = verify_installed_dist(dist, expected_commit=commit, requested_page=page)
        reads = info.get("page_reads", {})
        if not (info.get("verified") is True and reads.get("state") == "available"
                and page in reads.get("pages", {}) and isinstance(info.get("page_payload"), bytes)):
            failures.append((page, reads.get("reason_code") or info.get("reason_code")))
    for page, reason in failures:
        print(f"FAIL {page}: {reason}")
    print(f"{len(pages) - len([f for f in failures if f[0] != '(dist)'])}/{len(pages)} pages pass the BACH gate")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
