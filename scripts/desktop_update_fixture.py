"""Shared fixture for signed desktop update installation on hosted runners."""

import hashlib
import json
import os
import shutil
import ssl
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args, timeout=30, check=True, env=None):
    result = subprocess.run(args, check=False, timeout=timeout, capture_output=True, text=True, encoding="utf-8", env=env)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr[-2048:]}")
    return result


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def receipt_bundle(directory, receipt, kind, suffix, pin=None):
    relative = receipt["bundles"][kind]["file"]
    path = directory / relative
    require(path.parent == directory / "bundles" and path.name.endswith(suffix)
            and path.is_file() and not path.is_symlink()
            and path.resolve().is_relative_to(directory.resolve()), f"Invalid {kind} bundle path")
    sha256 = digest(path)
    metadata = receipt["files"][relative]
    require(sha256 == metadata["sha256"] and path.stat().st_size == metadata["bytes"], f"{kind} bundle changed")
    require(pin is None or sha256 == pin, f"{kind} bundle does not match the supplied SHA-256")
    return path, sha256


def sign_package(source, scratch, version):
    package = scratch / source.name
    shutil.copyfile(source, package)
    cli = Path(".github/desktop-toolchain/node_modules/@tauri-apps/cli/tauri.js").resolve()
    key = scratch / "update-key"
    run("node", str(cli), "signer", "generate", "--ci", "--password=", "--write-keys", str(key))
    try:
        run("node", str(cli), "signer", "sign", "--password=", "--private-key-path", str(key),
            "--app-version", version, str(package))
    finally:
        key.unlink()
    return package.read_bytes(), Path(str(package) + ".sig").read_text(encoding="utf-8").strip()


def fixture_tls(scratch):
    ca, ca_key = scratch / "update-ca.pem", scratch / "update-ca.key"
    cert, cert_key = scratch / "update-server.pem", scratch / "update-server.key"
    csr = scratch / "update-server.csr"
    ca_config = scratch / "update-ca.cnf"
    ca_config.write_text(
        "[req]\ndistinguished_name=dn\nx509_extensions=ca\n"
        "[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
        encoding="ascii",
    )
    extensions = scratch / "update-server.cnf"
    extensions.write_text(
        "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n",
        encoding="ascii",
    )
    run("openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1",
        "-config", str(ca_config), "-subj", "/CN=Ocean CI Update CA", "-keyout", str(ca_key), "-out", str(ca))
    run("openssl", "req", "-new", "-nodes", "-newkey", "rsa:2048",
        "-subj", "/CN=Ocean CI Update", "-keyout", str(cert_key), "-out", str(csr))
    run("openssl", "x509", "-req", "-days", "1", "-in", str(csr), "-CA", str(ca),
        "-CAkey", str(ca_key), "-set_serial", "1", "-extfile", str(extensions), "-out", str(cert))
    ca_key.unlink()
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, cert_key)
    return tls


def run_signed_update(source, scratch, version):
    package, signature = sign_package(source, scratch, version)
    routes = {
        "/valid/package": ("application/octet-stream", package),
        "/tampered/package": ("application/octet-stream", bytes([package[0] ^ 1]) + package[1:]),
    }

    class UpdateHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            payload = routes.get(self.path)
            if payload is None:
                self.send_error(404)
                return
            content_type, body = payload
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            pass

    tls = fixture_tls(scratch)
    with ThreadingHTTPServer(("127.0.0.1", 0), UpdateHandler) as server:
        origin = f"https://127.0.0.1:{server.server_port}"
        for variant, advertised_version, artifact in (
            ("valid", version, "valid"),
            ("tampered", version, "tampered"),
            ("wrong-version", "2.0.0", "valid"),
        ):
            manifest = {"version": advertised_version, "url": f"{origin}/{artifact}/package", "signature": signature}
            routes[f"/{variant}/latest.json"] = ("application/json", json.dumps(manifest).encode())
        (scratch / "update-origin").write_text(origin, encoding="ascii")
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            tests = run(
                "cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--release", "--locked",
                "desktop_updates::tests::signed_update_installs_verified_package",
                "--", "--ignored", "--exact", timeout=900, check=False,
                env={**os.environ, "OCEAN_SIGNED_UPDATE_FIXTURE": str(scratch)},
            )
            require(tests.returncode == 0, tests.stdout[-3000:] + tests.stderr[-3000:])
            print(tests.stdout, flush=True)
        finally:
            server.shutdown()
            thread.join()
    return {
        "package_sha256": hashlib.sha256(package).hexdigest(),
        "tampered_payload_rejected": True,
        "incorrect_version_rejected": True,
    }
