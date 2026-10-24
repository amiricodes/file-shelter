import { useEffect, useRef } from "react";

function RenameModal({
  renameType,
  renameValue,
  setRenameValue,
  onClose,
  onRenameSubmit,
}) {
  const inputRef = useRef(null);
  const initialRenameValue = useRef(renameValue);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();

      const dotIndex = initialRenameValue.current.lastIndexOf(".");
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleContentClick = (e) => {
    e.stopPropagation();
  };

  const handleOverlayClick = () => {
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={handleContentClick}>
        <h2 className="modal-title">
          Rename {renameType === "file" ? "File" : "Folder"}
        </h2>
        <form onSubmit={onRenameSubmit} className="modal-form">
          <input
            ref={inputRef}
            type="text"
            className="modal-input"
            placeholder="Enter new name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
          />
          <div className="modal-actions">
            <button className="modal-btn modal-btn-primary" type="submit">
              Save
            </button>
            <button
              className="modal-btn modal-btn-secondary"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RenameModal;
