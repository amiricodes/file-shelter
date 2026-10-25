export default function UploadStatus({ upload, onRetry, onCancel, onDismiss }) {
  if (!upload) return null;
  const labels = {
    initiating: "Preparing upload…",
    uploading: `Uploading: ${Math.floor(upload.progress)}%`,
    verifying: "Transfer finished. Confirming upload…",
    cancelling: "Cancelling upload…",
    "completion-error": "Transfer finished. Confirmation failed; retry without uploading again.",
    "transfer-error": "Transfer failed.",
    "cancel-error": "Cancellation failed. Your upload reservation is still pending.",
    "terminal-error": "Upload failed.",
    recovery: "Upload was interrupted. Retry completion if the transfer finished, or cancel the reservation.",
  };
  const canRetry = ["completion-error", "recovery"].includes(upload.status);
  const canCancel = ["uploading", "completion-error", "transfer-error", "cancel-error", "recovery"].includes(upload.status);
  return (
    <section className="upload-status" aria-label="Upload status" aria-live="polite">
      <strong>{upload.name}</strong>
      <p>{labels[upload.status]}</p>
      {upload.status === "uploading" && (
        <progress aria-label="File transfer" value={upload.progress} max="100" />
      )}
      {upload.error && <p role="alert">{upload.error}</p>}
      <div className="upload-status-actions">
        {canRetry && (
          <button className="profile-secondary-btn" onClick={onRetry}>Retry completion</button>
        )}
        {canCancel && <button className="profile-secondary-btn" onClick={onCancel}>Cancel upload</button>}
        {upload.status === "terminal-error" && <button className="profile-secondary-btn" onClick={onDismiss}>Dismiss</button>}
      </div>
    </section>
  );
}
