export const UPLOAD_RECOVERY_KEY = "file-shelter:pending-upload";
export const UPLOAD_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const RECOVERY_VERSION = 1;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function normalizeUploadOwner(accountId) {
  return typeof accountId === "string" ? accountId.trim().toLowerCase() : "";
}

function removeRecoveryRecord() {
  try {
    sessionStorage.removeItem(UPLOAD_RECOVERY_KEY);
  } catch {
    // Uploads still work when browser storage is unavailable.
  }
}

export function readRecoveryRecord(accountId) {
  let value;
  try {
    value = sessionStorage.getItem(UPLOAD_RECOVERY_KEY);
  } catch {
    return null;
  }
  if (!value) return null;

  try {
    const record = JSON.parse(value);
    const now = Date.now();
    const valid =
      record?.version === RECOVERY_VERSION &&
      typeof record.owner === "string" &&
      record.owner === accountId &&
      typeof record.fileId === "string" &&
      record.fileId.trim().length > 0 &&
      typeof record.name === "string" &&
      record.name.trim().length > 0 &&
      Number.isFinite(record.createdAt) &&
      record.createdAt <= now + MAX_CLOCK_SKEW_MS &&
      now - record.createdAt < UPLOAD_RECOVERY_MAX_AGE_MS;

    if (!valid) {
      removeRecoveryRecord();
      return null;
    }
    return record;
  } catch {
    removeRecoveryRecord();
    return null;
  }
}

export function persistRecoveryRecord(attempt) {
  try {
    sessionStorage.setItem(
      UPLOAD_RECOVERY_KEY,
      JSON.stringify({
        version: RECOVERY_VERSION,
        owner: attempt.owner,
        fileId: attempt.fileId,
        name: attempt.name,
        createdAt: attempt.createdAt,
      }),
    );
  } catch {
    // Uploads still work when browser storage is unavailable.
  }
}

export function clearRecoveryRecord(attempt) {
  let record;
  try {
    record = JSON.parse(sessionStorage.getItem(UPLOAD_RECOVERY_KEY));
  } catch {
    removeRecoveryRecord();
    return;
  }
  if (record?.owner === attempt.owner && record?.fileId === attempt.fileId) {
    removeRecoveryRecord();
  }
}
