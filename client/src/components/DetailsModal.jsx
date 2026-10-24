function DetailsModal({ item, onClose }) {
  if (!item) return null;

  const resolvedPath = item.pathDisplay || "/";

  const formatSize = (bytes = 0) => {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;

    if (bytes >= GB) return (bytes / GB).toFixed(2) + " GB";
    if (bytes >= MB) return (bytes / MB).toFixed(2) + " MB";
    if (bytes >= KB) return (bytes / KB).toFixed(2) + " KB";
    return bytes + " B";
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content details-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">Details</h2>
        <div className="details-modal-body">
          <div>
            <strong>Name:</strong>{" "}
            <span className="details-modal-value">{item.name}</span>
          </div>
          <div>
            <strong>Path:</strong>{" "}
            <span className="details-modal-value">{resolvedPath}</span>
          </div>
          <div>
            <strong>Size:</strong>{" "}
            <span className="details-modal-value">{formatSize(item.size)}</span>
          </div>
          <div>
            <strong>Created At:</strong>{" "}
            <span className="details-modal-value">
              {item.createdAt
                ? new Date(item.createdAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })
                : "N/A"}
            </span>
          </div>
          <div>
            <strong>Updated At:</strong>{" "}
            <span className="details-modal-value">
              {item.updatedAt
                ? new Date(item.updatedAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })
                : "N/A"}
            </span>
          </div>
        </div>
        <div className="modal-actions details-modal-actions">
          <button
            className="modal-btn modal-btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default DetailsModal;
