import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_MAC_ARCHES, resolveCuaMacArches } from "./cua-mac-arches.mjs";

describe("resolveCuaMacArches", () => {
  it("defaults to both packaging targets", () => {
    expect(resolveCuaMacArches({})).toEqual(DEFAULT_MAC_ARCHES);
  });

  it("rejects an empty override even when PARTIAL=1", () => {
    expect(() => resolveCuaMacArches({ OPENMAUSBOT_CUA_ARCHES: "", OPENMAUSBOT_CUA_ARCHES_PARTIAL: "1" })).toThrow(
      /OPENMAUSBOT_CUA_ARCHES is empty/,
    );
    expect(() => resolveCuaMacArches({ OPENMAUSBOT_CUA_ARCHES: " , ", OPENMAUSBOT_CUA_ARCHES_PARTIAL: "1" })).toThrow(
      /OPENMAUSBOT_CUA_ARCHES is empty/,
    );
  });

  it("rejects a one-arch override unless PARTIAL=1", () => {
    expect(() => resolveCuaMacArches({ OPENMAUSBOT_CUA_ARCHES: "arm64" })).toThrow(/omits x64/);
    expect(resolveCuaMacArches({ OPENMAUSBOT_CUA_ARCHES: "arm64", OPENMAUSBOT_CUA_ARCHES_PARTIAL: "1" })).toEqual([
      "arm64",
    ]);
  });
});

describe("macOS CUA release pin", () => {
  it("keeps the SDK, universal binary, and permission status probe on 0.28.1", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const preparation = readFileSync(new URL("./prepare-cua.mjs", import.meta.url), "utf8");

    expect(pkg.dependencies["@trycua/cua-driver"]).toBe("0.28.1");
    expect(preparation).toContain('version: "0.28.1"');
    expect(preparation).toContain('file: "cua-driver-rs-0.28.1-darwin-universal-binary.tar.gz"');
    expect(preparation).toContain('export { currentMacOsPermissionStatus } from "@trycua/cua-driver";');
  });
});
