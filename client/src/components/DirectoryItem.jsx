import ContextMenu from "../components/ContextMenu";

function DirectoryItem({
  item,
  handleRowClick,
  activeContextMenu,
  contextMenuPos,
  handleContextMenu,
  isUploading,
  uploadProgress,
  handleCancelUpload,
  handleDeleteFile,
  handleDeleteDirectory,
  openRenameModal,
  BASE_URL,
}) {
  const isUploadingItem = item.id.toString().startsWith("temp-");

  // Get file type label and icon class
  function getFileTypeInfo(filename) {
    if (!filename) return { label: "File", badge: "FILE", typeClass: "" };
    const ext = filename.split(".").pop().toLowerCase();
    switch (ext) {
      case "png":
        return { label: "PNG Image", badge: "IMG", typeClass: "type-img" };
      case "jpg":
      case "jpeg":
        return { label: "JPEG Image", badge: "IMG", typeClass: "type-img" };
      case "gif":
        return { label: "GIF Image", badge: "IMG", typeClass: "type-img" };
      case "pdf":
        return { label: "PDF Document", badge: "PDF", typeClass: "type-doc" };
      case "doc":
      case "docx":
        return { label: "Word Doc", badge: "DOC", typeClass: "type-doc" };
      case "xls":
      case "xlsx":
        return { label: "Spreadsheet", badge: "XLS", typeClass: "type-xls" };
      case "mp4":
      case "mov":
      case "avi":
        return { label: "Video", badge: "VID", typeClass: "type-img" };
      case "zip":
      case "rar":
      case "tar":
      case "gz":
        return { label: "Archive", badge: "ZIP", typeClass: "type-doc" };
      case "js":
      case "jsx":
      case "ts":
      case "tsx":
      case "html":
      case "css":
      case "py":
      case "java":
        return { label: "Code", badge: "SRC", typeClass: "type-xls" };
      default:
        return { label: "File", badge: "FILE", typeClass: "" };
    }
  }

  // Format file size
  function formatSize(bytes) {
    if (!bytes) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  }

  const typeInfo = item.isDirectory
    ? { label: "Folder", badge: "DIR", typeClass: "type-xls" }
    : getFileTypeInfo(item.name);

  return (
    <>
      <tr
        className="file-row"
        onClick={() =>
          !(activeContextMenu || isUploading)
            ? handleRowClick(item.isDirectory ? "directory" : "file", item.id)
            : null
        }
        onContextMenu={(e) => handleContextMenu(e, item.id)}
      >
        <td>
          <div className="file-name-cell">
            {item.isDirectory ? (
              <div className="file-icon type-xls">
                <svg
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </div>
            ) : (
              <div className={`file-icon ${typeInfo.typeClass}`}>
                {typeInfo.badge}
              </div>
            )}
            <span>{item.name}</span>
          </div>
        </td>
        <td>{formatSize(item.size)}</td>
        <td>{typeInfo.label}</td>
        <td>
          <button
            className="row-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleContextMenu(e, item.id);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        </td>
      </tr>

      {/* Upload progress sub-row */}
      {isUploadingItem && (
        <tr className="upload-progress-row">
          <td colSpan="4">
            <div className="upload-progress-bar-container">
              <div
                className="upload-progress-bar-fill"
                style={{
                  width: `${uploadProgress}%`,
                  backgroundColor:
                    uploadProgress === 100 ? "#4A6348" : "var(--accent-black)",
                }}
              ></div>
              <span className="upload-progress-text">
                {Math.floor(uploadProgress)}%
              </span>
            </div>
          </td>
        </tr>
      )}

      {/* Context menu */}
      {activeContextMenu === item.id && (
        <ContextMenu
          item={item}
          contextMenuPos={contextMenuPos}
          isUploadingItem={isUploadingItem}
          handleCancelUpload={handleCancelUpload}
          handleDeleteFile={handleDeleteFile}
          handleDeleteDirectory={handleDeleteDirectory}
          openRenameModal={openRenameModal}
          handleRowClick={handleRowClick}
          BASE_URL={BASE_URL}
        />
      )}
    </>
  );
}

export default DirectoryItem;
