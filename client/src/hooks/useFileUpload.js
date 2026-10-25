import { useEffect, useRef, useState } from "react";
import { uploadInitiate, uploadComplete, uploadCancel } from "../apis/fileApi";
import {
  clearRecoveryRecord,
  normalizeUploadOwner,
  persistRecoveryRecord,
  readRecoveryRecord,
} from "./uploadRecovery";

// A pending attempt keeps its server reservation until completion or acknowledged
// cancellation. In particular, retrying completion must never initiate a new PUT.
export default function useFileUpload({ accountId, onSettled, onUnauthorized }) {
  const [upload, setUpload] = useState(null);
  const attemptRef = useRef(null);
  const mounted = useRef(true);
  // An upload can outlive a folder change while this page remains mounted.
  const callbacks = useRef({ onSettled, onUnauthorized });
  callbacks.current = { onSettled, onUnauthorized };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attemptRef.current?.xhr?.abort();
    };
  }, []);

  useEffect(() => {
    const owner = normalizeUploadOwner(accountId);
    if (!owner) return;

    const current = attemptRef.current;
    if (current) {
      if (current.owner === owner) return;
      current.cancelled = true;
      current.xhr?.abort();
      attemptRef.current = null;
      setUpload(null);
    }

    const recovery = readRecoveryRecord(owner);
    if (!recovery) return;

    attemptRef.current = {
      busy: false,
      cancelled: false,
      fileId: recovery.fileId,
      name: recovery.name,
      owner,
      createdAt: recovery.createdAt,
      putSucceeded: true,
    };
    setUpload({ name: recovery.name, status: "recovery", progress: 0, error: "" });
  }, [accountId]);

  function update(attempt, values) {
    if (mounted.current && attemptRef.current === attempt) {
      setUpload((previous) => ({ ...previous, ...values }));
    }
  }

  function fail(attempt, error, status) {
    attempt.busy = false;
    update(attempt, { status, error: error.message });
    if (error.status === 401 && mounted.current) callbacks.current.onUnauthorized();
  }

  async function complete(attempt) {
    attempt.busy = true;
    update(attempt, { status: "verifying", error: "" });
    try {
      await uploadComplete(attempt.fileId);
    } catch (error) {
      // These responses mean the reservation is gone or the file is invalid.
      const terminal = [400, 404, 410].includes(error.status);
      fail(attempt, error, terminal ? "terminal-error" : "completion-error");
      if (terminal) {
        clearRecoveryRecord(attempt);
        attempt.fileId = null;
      }
      return;
    }
    clearRecoveryRecord(attempt);
    if (!mounted.current || attemptRef.current !== attempt) return;
    attemptRef.current = null;
    setUpload(null);
    callbacks.current.onSettled();
  }

  async function start(file, parentDirId) {
    // Set the lock before initiation, including the period before React renders.
    if (attemptRef.current) return;
    const owner = normalizeUploadOwner(accountId);
    if (!owner) {
      setUpload({
        name: file.name,
        status: "terminal-error",
        progress: 0,
        error: "Account details are still loading. Please try again.",
      });
      return;
    }
    const attempt = {
      busy: true,
      cancelled: false,
      name: file.name,
      owner,
      createdAt: Date.now(),
    };
    attemptRef.current = attempt;
    setUpload({ name: file.name, status: "initiating", progress: 0, error: "" });
    let data;
    try {
      data = await uploadInitiate({
        name: file.name, size: file.size, contentType: file.type, parentDirId,
      });
    } catch (error) {
      fail(attempt, error, "terminal-error");
      return;
    }
    attempt.fileId = data.fileId;
    persistRecoveryRecord(attempt);
    if (!mounted.current) return;
    attempt.busy = false;
    update(attempt, { status: "uploading" });
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        attempt.xhr = xhr;
        xhr.open("PUT", data.uploadUrl);
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            update(attempt, { progress: (event.loaded / event.total) * 100 });
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`File transfer failed (HTTP ${xhr.status}). Cancel and select the file again.`));
        });
        xhr.addEventListener("error", () => reject(new Error("File transfer failed. Check your connection, then cancel and select the file again.")));
        xhr.addEventListener("timeout", () => reject(new Error("File transfer timed out. Cancel and select the file again.")));
        xhr.addEventListener("abort", () => reject(new Error("File transfer stopped. Cancel and select the file again.")));
        xhr.send(file);
      });
    } catch (error) {
      if (!attempt.cancelled) fail(attempt, error, "transfer-error");
      return;
    }
    attempt.xhr = null;
    if (!mounted.current || attempt.cancelled) return;
    attempt.putSucceeded = true;
    update(attempt, { progress: 100 });
    await complete(attempt);
  }

  async function retryCompletion() {
    const attempt = attemptRef.current;
    if (!attempt?.putSucceeded || !attempt.fileId || attempt.busy) return;
    await complete(attempt);
  }

  async function cancel() {
    const attempt = attemptRef.current;
    if (!attempt?.fileId || attempt.busy) return;
    attempt.cancelled = true;
    attempt.busy = true;
    update(attempt, { status: "cancelling", error: "" });
    attempt.xhr?.abort();
    try {
      await uploadCancel(attempt.fileId);
    } catch (error) {
      fail(attempt, error, attempt.putSucceeded ? "completion-error" : "cancel-error");
      return;
    }
    clearRecoveryRecord(attempt);
    if (!mounted.current || attemptRef.current !== attempt) return;
    attemptRef.current = null;
    setUpload(null);
    callbacks.current.onSettled();
  }

  function dismiss() {
    if (attemptRef.current?.fileId) return;
    attemptRef.current = null;
    setUpload(null);
  }

  return { upload, start, retryCompletion, cancel, dismiss };
}
