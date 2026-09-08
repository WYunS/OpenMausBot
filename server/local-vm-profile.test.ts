import { describe, expect, it } from "vitest";

import { IMAGE, localVmRuntimeProfile } from "./container-computer.ts";

describe("Local VM runtime profiles", () => {
  it("shares the immutable image but isolates installed and development runtimes", () => {
    const development = localVmRuntimeProfile("development");
    const installed = localVmRuntimeProfile("installed");

    expect(development.image).toBe(IMAGE);
    expect(installed.image).toBe(IMAGE);
    expect(development.containerName).not.toBe(installed.containerName);
    expect(development.viewerPort).not.toBe(installed.viewerPort);
  });
});
