export type ScreenPreviewFailurePhase = "cancelled" | "unavailable" | "error";

export type ScreenPreviewStartResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; phase: ScreenPreviewFailurePhase; message: string };

type ScreenPreviewRequest = {
  beginIntent: () => boolean;
  getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
};

export type SkillRecorderPermission = {
  supported: boolean;
  reason?: string;
  captureMode?: "native-events" | "visual";
};

type SkillRecordingScreenRequest = ScreenPreviewRequest & {
  permission: SkillRecorderPermission;
};

export function requestSkillRecordingScreen({
  permission,
  beginIntent,
  getDisplayMedia,
}: SkillRecordingScreenRequest): Promise<{
  permission: SkillRecorderPermission;
  preview: ScreenPreviewStartResult;
}> {
  if (!permission.supported) {
    return Promise.resolve({
      permission,
      preview: {
        ok: false as const,
        phase: "unavailable" as const,
        message: "Skill recording is currently available in the macOS and Windows desktop apps.",
      },
    });
  }
  const preview = requestScreenPreview({ beginIntent, getDisplayMedia });
  return preview.then((result) => ({ permission, preview: result }));
}

export function stopScreenPreview(stream: Pick<MediaStream, "getTracks"> | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function screenPreviewFailure(error: unknown): Exclude<ScreenPreviewStartResult, { ok: true }> {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return {
      ok: false,
      phase: "cancelled",
      message: "Screen selection was cancelled. Nothing is being shared.",
    };
  }
  if (
    name === "NotFoundError" ||
    name === "NotReadableError" ||
    name === "NotSupportedError" ||
    name === "SecurityError"
  ) {
    return {
      ok: false,
      phase: "unavailable",
      message: "Screen preview isn't available right now.",
    };
  }
  return { ok: false, phase: "error", message: "Couldn't start screen preview." };
}

export async function requestScreenPreview({
  beginIntent,
  getDisplayMedia,
}: ScreenPreviewRequest): Promise<ScreenPreviewStartResult> {
  try {
    // Keep these synchronous and adjacent so Chromium sees the media request
    // in the same user gesture that armed the one-shot main-process intent.
    if (!beginIntent()) {
      return {
        ok: false,
        phase: "unavailable",
        message: "Screen preview isn't available from this window.",
      };
    }
    const stream = await getDisplayMedia({
      // The local viewer supplies the visible pointer itself. Capturing the
      // Windows pointer as well creates a delayed duplicate over the video.
      video: { cursor: "never" } as MediaTrackConstraints,
      audio: false,
    });
    if (stream.getVideoTracks().length === 0) {
      stopScreenPreview(stream);
      return {
        ok: false,
        phase: "unavailable",
        message: "The selected source did not provide a video stream.",
      };
    }
    return { ok: true, stream };
  } catch (error) {
    return screenPreviewFailure(error);
  }
}
