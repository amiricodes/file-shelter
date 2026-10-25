import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import CreateDirectoryModal from "../components/CreateDirectoryModal";
import RenameModal from "../components/RenameModal";
import DirectoryList from "../components/DirectoryList";
import Breadcrumb from "../components/Breadcrumb";
import {
  getDirectoryItems,
  createDirectory,
  renameDirectory,
  deleteDirectory,
} from "../apis/directoryApi";
import {
  deleteFile,
  renameFile,
} from "../apis/fileApi";
import { fetchUser } from "../apis/userApi";
import useFileUpload from "../hooks/useFileUpload";
import UploadStatus from "../components/UploadStatus";

function DirectoryListSkeleton() {
  return (
    <table className="files-table directory-skeleton-table" aria-label="Loading folder contents">
      <tbody>
        {Array.from({ length: 6 }, (_, index) => (
          <tr key={index}>
            <td><span className="loading-skeleton loading-skeleton-file" /></td>
            <td><span className="loading-skeleton loading-skeleton-meta" /></td>
            <td><span className="loading-skeleton loading-skeleton-type" /></td>
            <td><span className="loading-skeleton loading-skeleton-action" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DirectoryView() {
  const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;
  const { dirId } = useParams();
  const navigate = useNavigate();

  // Breadcrumb trail
  const [breadcrumbTrail, setBreadcrumbTrail] = useState([
    { id: null, name: "All Files" },
  ]);

  // Current directory page. Items are already ordered newest-first by the API.
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Error state
  const [errorMessage, setErrorMessage] = useState("");

  // User + storage state for sidebar
  const [sidebarUser, setSidebarUser] = useState({
    accountId: null,
    role: null,
    usedStorage: 0,
    maxStorage: 0,
  });
  const [storageLoading, setStorageLoading] = useState(true);

  // Modal states
  const [showCreateDirModal, setShowCreateDirModal] = useState(false);
  const [newDirname, setNewDirname] = useState("New Folder");

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameType, setRenameType] = useState(null); // "directory" or "file"
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Uploading states
  const fileInputRef = useRef(null);

  // Context menu
  const [activeContextMenu, setActiveContextMenu] = useState(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /**
   * Fetch directory contents
   */
  const getDirectoryItemsHandler = useCallback(async ({
    cursor = null,
    append = false,
    signal,
  } = {}) => {
    setErrorMessage(""); // clear any existing error
    if (append) setLoadingMore(true);
    else setDirectoryLoading(true);
    try {
      const data = await getDirectoryItems(dirId, { cursor, signal });
      if (signal?.aborted) return;

      setBreadcrumbTrail(
        Array.isArray(data.breadcrumbTrail) && data.breadcrumbTrail.length > 0
          ? data.breadcrumbTrail
          : [{ id: null, name: "All Files" }],
      );

      setItems((previous) =>
        append ? [...previous, ...(data.items || [])] : data.items || [],
      );
      setNextCursor(data.nextCursor || null);
    } catch (error) {
      if (error.name === "AbortError") return;
      if (error.message === "Unauthorized") {
        navigate("/login");
      } else {
        setErrorMessage(error.message);
      }
    } finally {
      if (!signal?.aborted) {
        setDirectoryLoading(false);
        setLoadingMore(false);
      }
    }
  }, [dirId, navigate]);

  const getUserStorageInfo = useCallback(async () => {
    setStorageLoading(true);
    try {
      const user = await fetchUser();
      setSidebarUser({
        accountId: user.email || null,
        role: user.role || null,
        usedStorage: Number(user.usedStorage) || 0,
        maxStorage: Number(user.maxStorage) || 0,
      });
    } catch (error) {
      if (error.message === "Unauthorized") {
        navigate("/login");
      }
      // Keep sidebar with safe fallback values if user fetch fails.
    } finally {
      setStorageLoading(false);
    }
  }, [navigate]);

  const {
    upload,
    start: startUpload,
    retryCompletion,
    cancel: handleCancelUpload,
    dismiss,
  } = useFileUpload({
    accountId: sidebarUser.accountId,
    onSettled: () => {
      getDirectoryItemsHandler();
      getUserStorageInfo();
    },
    onUnauthorized: () => navigate("/login"),
  });
  const isUploading = Boolean(upload);

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setNextCursor(null);
    setBreadcrumbTrail([{ id: null, name: "All Files" }]);
    setDirectoryLoading(true);
    getDirectoryItemsHandler({ signal: controller.signal });
    getUserStorageInfo();
    // Reset context menu
    setActiveContextMenu(null);
    return () => controller.abort();
  }, [dirId, getDirectoryItemsHandler, getUserStorageInfo]);

  /**
   * Click row to open directory or file
   */
  function handleRowClick(type, id) {
    if (type === "directory") {
      navigate(`/app/directory/${id}`);
    } else {
      window.location.href = `${import.meta.env.VITE_BACKEND_BASE_URI}/file/${id}`;
    }
  }

  /**
   * Select a file and start upload
   */
  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (isUploading) {
      setErrorMessage("Finish or cancel the pending upload before selecting another file.");
      return;
    }
    setErrorMessage("");
    startUpload(file, dirId);
  }

  /**
   * Delete a file/directory
   */
  async function handleDeleteFile(id) {
    setErrorMessage("");
    try {
      await deleteFile(id);
      getDirectoryItemsHandler();
      getUserStorageInfo();
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function handleDeleteDirectory(id) {
    setErrorMessage("");
    try {
      await deleteDirectory(id);
      getDirectoryItemsHandler();
      getUserStorageInfo();
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  /**
   * Create a directory
   */
  async function handleCreateDirectory(e) {
    e.preventDefault();
    setErrorMessage("");
    try {
      await createDirectory(dirId || "", newDirname);
      setNewDirname("New Folder");
      setShowCreateDirModal(false);
      getDirectoryItemsHandler();
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  /**
   * Rename
   */
  function openRenameModal(type, id, currentName) {
    setRenameType(type);
    setRenameId(id);
    setRenameValue(currentName);
    setShowRenameModal(true);
  }

  async function handleRenameSubmit(e) {
    e.preventDefault();
    setErrorMessage("");
    try {
      if (renameType === "file") {
        await renameFile(renameId, renameValue);
      } else {
        await renameDirectory(renameId, renameValue);
      }

      setShowRenameModal(false);
      setRenameValue("");
      setRenameType(null);
      setRenameId(null);
      getDirectoryItemsHandler();
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  /**
   * Context Menu
   */
  function handleContextMenu(e, id) {
    e.stopPropagation();
    e.preventDefault();
    const clickX = e.clientX;
    const clickY = e.clientY;

    if (activeContextMenu === id) {
      setActiveContextMenu(null);
    } else {
      const menuWidth = window.innerWidth <= 768 ? 180 : 198;
      const menuHeight = 320;
      const edgePadding = 8;
      const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
      const normalizedX = clickX / bodyZoom;
      const normalizedY = clickY / bodyZoom;
      const viewportWidth = window.innerWidth / bodyZoom;
      const viewportHeight = window.innerHeight / bodyZoom;

      const clampedX = Math.max(
        edgePadding,
        Math.min(normalizedX - menuWidth + 26, viewportWidth - menuWidth - edgePadding),
      );
      const clampedY = Math.max(
        edgePadding,
        Math.min(normalizedY, viewportHeight - menuHeight - edgePadding),
      );

      setActiveContextMenu(id);
      setContextMenuPos({ x: clampedX, y: clampedY });
    }
  }

  useEffect(() => {
    function handleDocumentClick() {
      setActiveContextMenu(null);
    }
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  const currentPathParts = breadcrumbTrail
    .slice(1)
    .map((entry) => entry.name)
    .filter(Boolean);
  const currentPath =
    currentPathParts.length > 0 ? `/${currentPathParts.join("/")}` : "/";

  function buildItemPath(name) {
    if (!name) return currentPath;
    return currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
  }

  const displayItems = items.map((item) => ({
    ...item,
    pathDisplay: buildItemPath(item.name),
  }));

  const isAccessError =
    errorMessage === "Directory not found or you do not have access to it!";

  return (
    <div className="app-container">
      {/* Sidebar overlay for mobile */}
      <div
        className={`sidebar-overlay${sidebarOpen ? " sidebar-overlay-visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <Sidebar
        onCreateFolderClick={() => setShowCreateDirModal(true)}
        onUploadFilesClick={() => fileInputRef.current.click()}
        disabled={isAccessError}
        role={sidebarUser.role}
        usedStorage={sidebarUser.usedStorage}
        maxStorage={sidebarUser.maxStorage}
        storageLoading={storageLoading}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content */}
      <div className="main-content">
        <TopBar
          onUploadFilesClick={() => fileInputRef.current.click()}
          fileInputRef={fileInputRef}
          handleFileSelect={handleFileSelect}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />

        <div className="content-scroll">
          {/* Error message (non-access errors) */}
          {errorMessage && !isAccessError && (
            <div className="error-banner">{errorMessage}</div>
          )}

          <UploadStatus
            upload={upload}
            onRetry={retryCompletion}
            onCancel={handleCancelUpload}
            onDismiss={dismiss}
          />

          {/* Section Header */}
          <div className="section-header">
            <Breadcrumb trail={breadcrumbTrail} />
            <div className="section-header-actions">
              <div className="sort-label">Sort by: Date Modified</div>
              <div className="view-mode-toggle">
                <button className="view-mode-btn active">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
                <button className="view-mode-btn">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Create Directory Modal */}
          {showCreateDirModal && (
            <CreateDirectoryModal
              newDirname={newDirname}
              setNewDirname={setNewDirname}
              onClose={() => setShowCreateDirModal(false)}
              onCreateDirectory={handleCreateDirectory}
            />
          )}

          {/* Rename Modal */}
          {showRenameModal && (
            <RenameModal
              renameType={renameType}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              onClose={() => setShowRenameModal(false)}
              onRenameSubmit={handleRenameSubmit}
            />
          )}

          {directoryLoading ? (
            <DirectoryListSkeleton />
          ) : displayItems.length === 0 ? (
            isAccessError ? (
              <p className="empty-state-text">
                Directory not found or you do not have access to it!
              </p>
            ) : (
              <p className="empty-state-text">
                This folder is empty. Upload files or create a folder to see
                some data.
              </p>
            )
          ) : (
            <DirectoryList
              items={displayItems}
              handleRowClick={handleRowClick}
              activeContextMenu={activeContextMenu}
              contextMenuPos={contextMenuPos}
              handleContextMenu={handleContextMenu}
              isUploading={isUploading}
              progressMap={{}}
              handleCancelUpload={handleCancelUpload}
              handleDeleteFile={handleDeleteFile}
              handleDeleteDirectory={handleDeleteDirectory}
              openRenameModal={openRenameModal}
              BASE_URL={BASE_URL}
            />
          )}
          {nextCursor && !isAccessError && (
            <div className="directory-load-more">
              <button
                type="button"
                className="profile-secondary-btn"
                disabled={loadingMore}
                onClick={() =>
                  getDirectoryItemsHandler({ cursor: nextCursor, append: true })
                }
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DirectoryView;
