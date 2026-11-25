import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A throwaway self-signed certificate for `receiver.test`, generated with the
 * system `openssl` when a test file loads.
 *
 * The key is generated per run rather than checked in: the repository ignores
 * `*.pem`, and a committed private key trips secret scanning.
 */
export interface TlsFixture {
  cert: string;
  key: string;
}

/** Generates a P-256 self-signed certificate whose CN and SAN are `receiver.test`. */
export function createReceiverTlsFixture(): TlsFixture {
  const dir = mkdtempSync(join(tmpdir(), "mcp-use-events-tls-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=receiver.test",
        "-addext",
        "subjectAltName=DNS:receiver.test",
      ],
      { stdio: "ignore" }
    );
    return {
      cert: readFileSync(certPath, "utf8"),
      key: readFileSync(keyPath, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
