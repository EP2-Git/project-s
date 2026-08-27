import { describe, expect, it } from "vitest";

import {
  isForbiddenPath,
  isIgnoredPublicationPath,
  scanText,
} from "../../scripts/scan-repository.mjs";

describe("publication safety scanner", () => {
  it("rejects files that never belong in the publication candidate", () => {
    expect(isForbiddenPath(".env")).toBe(true);
    expect(isForbiddenPath(".env.local")).toBe(true);
    expect(isForbiddenPath("src/old-source.zip")).toBe(true);
    expect(isForbiddenPath("private\\credentials.json")).toBe(true);
    expect(isForbiddenPath("private/server.pem")).toBe(true);
    expect(isForbiddenPath(".env.example")).toBe(false);
    expect(isForbiddenPath("src/config.ts")).toBe(false);
  });

  it("rejects release-boundary credential, archive, database, and video files", () => {
    for (const extension of [
      ".p12",
      ".pfx",
      ".7z",
      ".rar",
      ".tar",
      ".tgz",
      ".sqlite",
      ".db",
      ".mp4",
      ".mov",
      ".webm",
    ]) {
      expect(isForbiddenPath(`evidence/publication-candidate${extension}`)).toBe(true);
    }

    expect(isForbiddenPath("evidence/publication-candidate.MP4")).toBe(true);
  });

  it("ignores ephemeral local Supabase CLI state", () => {
    expect(isIgnoredPublicationPath("supabase/.temp")).toBe(true);
    expect(isIgnoredPublicationPath("supabase/.temp/pooler-url")).toBe(true);
    expect(isIgnoredPublicationPath("supabase\\.temp\\project-ref")).toBe(true);
    expect(isIgnoredPublicationPath("supabase/config.toml")).toBe(false);
  });

  it("detects production backends without echoing the value", () => {
    const projectReference = "abcdefghijklmnopqrst";
    const findings = scanText(
      "src/client.ts",
      `const url = "https://${projectReference}.supabase.co";`,
    );

    expect(findings).toEqual([
      expect.objectContaining({
        file: "src/client.ts",
        label: "hosted Supabase project URL",
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain(projectReference);
  });

  it("detects generic Windows user-profile paths and file URLs", () => {
    const backslashPath = ["C:", "Users", "developer", "project-s"].join("\\");
    const slashPath = ["D:", "Users", "owner", "project-s"].join("/");
    const fileUrl = ["file:", "", "", "C:", "Users", "developer", "project-s"].join("/");
    const findings = scanText(
      "release-notes.md",
      [backslashPath, slashPath, fileUrl].join("\n"),
    );

    expect(findings).toEqual([
      expect.objectContaining({ label: "absolute Windows workstation path" }),
      expect.objectContaining({ label: "absolute Windows workstation path" }),
      expect.objectContaining({ label: "absolute Windows workstation path" }),
    ]);
  });

  it("permits example-only public configuration", () => {
    expect(
      scanText(
        ".env.example",
        "VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=\n",
      ),
    ).toEqual([]);
  });

  it("flags non-example email addresses and browser-exposed secrets", () => {
    const privateEmail = ["owner", "private.test"].join("@");
    const browserSecret = ["VITE_GOOGLE_CLIENT", "SECRET=not-safe"].join("_");
    const findings = scanText(
      "example.ts",
      `${privateEmail}\n${browserSecret}`,
    );

    expect(findings.map(({ label }) => label)).toEqual([
      "non-example email address",
      "secret assigned to a VITE_ variable",
    ]);
  });

  it("allows synthetic example and hosted-commit email addresses", () => {
    const commitDomain = ["users.noreply", "github.com"].join(".");
    const text = `person@example.com\n12345@${commitDomain}`;

    expect(scanText("safe.md", text)).toEqual([]);
  });

  it("does not treat dependency metadata contacts as project identifiers", () => {
    const metadataContact = ["maintainer", "upstream.test"].join("@");
    expect(scanText("package-lock.json", metadataContact)).toEqual([]);
  });

  it("detects every blocked credential and hosted-service signature", () => {
    const token = [
      `eyJ${"a".repeat(12)}`,
      "b".repeat(12),
      "c".repeat(12),
    ].join(".");
    const lines = [
      ["https://lovable.dev", "projects", "01234567-89ab-cdef-0123-456789abcdef"].join("/"),
      ["https://cdn.gpteng.co", "runtime.js"].join("/"),
      token,
      ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
      ["sk", "proj", "abcdefghijklmnop"].join("-"),
      'project_id = "abcdefghijklmnopqrst"',
    ].join("\n");

    expect(scanText("unsafe.txt", lines).map(({ label }) => label)).toEqual([
      "Lovable private project URL",
      "GPT Engineer runtime CDN",
      "JSON web token",
      "private key material",
      "provider credential",
      "hosted Supabase project identifier",
    ]);
  });
});
