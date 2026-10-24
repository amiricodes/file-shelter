import DirectoryItem from "./DirectoryItem";

function DirectoryList({
  items,
  handleRowClick,
  activeContextMenu,
  contextMenuPos,
  handleContextMenu,
  isUploading,
  progressMap,
  handleCancelUpload,
  handleDeleteFile,
  handleDeleteDirectory,
  openRenameModal,
  BASE_URL,
}) {
  return (
    <table className="files-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Size</th>
          <th>Type</th>
          <th style={{ width: "40px" }}></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const uploadProgress = progressMap[item.id] || 0;

          return (
            <DirectoryItem
              key={item.id}
              item={item}
              handleRowClick={handleRowClick}
              activeContextMenu={activeContextMenu}
              contextMenuPos={contextMenuPos}
              handleContextMenu={handleContextMenu}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              handleCancelUpload={handleCancelUpload}
              handleDeleteFile={handleDeleteFile}
              handleDeleteDirectory={handleDeleteDirectory}
              openRenameModal={openRenameModal}
              BASE_URL={BASE_URL}
            />
          );
        })}
      </tbody>
    </table>
  );
}

export default DirectoryList;
