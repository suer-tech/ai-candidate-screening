// Shared by the sender and processor so a recording is rejected before download.
export const DEFAULT_MEDIA_INPUT_BYTES = 2 * 1024 * 1024 * 1024;

export function mediaInputLimit(value?: string | number) {
  const limit = Number(value ?? DEFAULT_MEDIA_INPUT_BYTES);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("MEDIA_PROCESSOR_MAX_INPUT_BYTES_INVALID");
  return limit;
}
