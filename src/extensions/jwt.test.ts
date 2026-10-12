import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { extensionVoterId, signExtensionJwt, verifyExtensionJwt } from "./jwt.js";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("extension JWT", () => {
  const secret = Buffer.from("test-secret-bytes-32chars!!!!!!").toString("base64");

  it("verifies a signed helper-style JWT", () => {
    const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const body = b64url(
      Buffer.from(
        JSON.stringify({
          exp: Math.floor(Date.now() / 1000) + 3600,
          opaque_user_id: "U123",
          channel_id: "999",
          role: "viewer",
        }),
      ),
    );
    const sig = b64url(
      createHmac("sha256", Buffer.from(secret, "base64"))
        .update(`${header}.${body}`)
        .digest(),
    );
    const payload = verifyExtensionJwt(`${header}.${body}.${sig}`, secret);
    assert.ok(payload);
    assert.equal(payload!.opaque_user_id, "U123");
    assert.equal(extensionVoterId(payload!), "U123");
  });

  it("rejects expired tokens", () => {
    const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const body = b64url(
      Buffer.from(
        JSON.stringify({
          exp: Math.floor(Date.now() / 1000) - 10,
          opaque_user_id: "U123",
        }),
      ),
    );
    const sig = b64url(
      createHmac("sha256", Buffer.from(secret, "base64"))
        .update(`${header}.${body}`)
        .digest(),
    );
    assert.equal(verifyExtensionJwt(`${header}.${body}.${sig}`, secret), null);
  });

  it("signs an external JWT", () => {
    const token = signExtensionJwt(secret, { user_id: "42", role: "external" });
    const payload = verifyExtensionJwt(token, secret);
    assert.ok(payload);
    assert.equal(payload!.user_id, "42");
    assert.equal(payload!.role, "external");
  });
});
