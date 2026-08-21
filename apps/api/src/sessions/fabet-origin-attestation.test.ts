import { describe, expect, it } from "vitest";

import { attestFabetOrigin, type FabetOriginEvidence } from "./fabet-origin-attestation.js";

const validEvidence: FabetOriginEvidence = {
  entryUrl: "https://fabet.monster/" as FabetOriginEvidence["entryUrl"],
  finalUrl: "https://current-fabet-mirror.example/home",
  finalHostname: "current-fabet-mirror.example",
  loginFormPresent: true,
  lobbyPresent: true,
  authenticatedControlPresent: true,
  sameOriginApiObserved: true,
};

describe("attestFabetOrigin", () => {
  it("accepts a dynamic HTTPS mirror only with Fabet UI and same-origin API evidence", () => {
    expect(attestFabetOrigin(validEvidence)).toEqual({
      finalUrl: "https://current-fabet-mirror.example/home",
      finalHostname: "current-fabet-mirror.example",
    });
  });

  it.each([
    [{ ...validEvidence, entryUrl: "https://fabet.com/" }, "root"],
    [{ ...validEvidence, finalUrl: "http://current-fabet-mirror.example/home" }, "HTTPS"],
    [{ ...validEvidence, finalUrl: "https://user:pass@current-fabet-mirror.example/home" }, "credentials"],
    [{ ...validEvidence, finalUrl: "https://127.0.0.1/home", finalHostname: "127.0.0.1" }, "IP"],
    [{ ...validEvidence, finalUrl: "https://[::1]/home", finalHostname: "[::1]" }, "IP"],
    [{ ...validEvidence, finalHostname: "other.example" }, "hostname"],
    [{ ...validEvidence, loginFormPresent: false, lobbyPresent: false }, "controls"],
    [{ ...validEvidence, authenticatedControlPresent: false }, "authenticated"],
    [{ ...validEvidence, sameOriginApiObserved: false }, "API"],
  ] as const)("rejects untrusted redirect evidence %#", (evidence, message) => {
    expect(() => attestFabetOrigin(evidence as FabetOriginEvidence)).toThrow(message);
  });

  it("does not require the login form after an already authenticated redirect", () => {
    expect(attestFabetOrigin({
      ...validEvidence,
      loginFormPresent: false,
      lobbyPresent: true,
    })).toEqual({
      finalUrl: validEvidence.finalUrl,
      finalHostname: validEvidence.finalHostname,
    });
  });
});
