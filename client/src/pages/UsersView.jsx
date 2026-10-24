import { useCallback, useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import { useNavigate } from "react-router-dom";
import { fetchUser, fetchAllUsers } from "../apis/userApi";

function UsersView() {
  const [users, setUsers] = useState([]);

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [contextMenuUser, setContextMenuUser] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [editingDetailsUser, setEditingDetailsUser] = useState(null);
  const [editingRoleUser, setEditingRoleUser] = useState(null);
  const [updateCredentials, setUpdateCredentials] = useState(false);

  const [editDetailsForm, setEditDetailsForm] = useState({
    name: "",
    email: "",
  });

  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");

  const [editRoleForm, setEditRoleForm] = useState({ role: "user" });

  const navigate = useNavigate();

  const handleFetchAllUsers = useCallback(async () => {
    try {
      const data = await fetchAllUsers();
      setUsers(data);
    } catch (error) {
      if (error.message === "Forbidden") {
        navigate("/app");
      } else {
        console.log("Error finding users:", error.message);
      }
    }
  }, [navigate]);

  const handleFetchUser = useCallback(async () => {
    try {
      const data = await fetchUser();
      setUserName(data.name);
      setUserRole(data.role);
    } catch (error) {
      if (error.message === "Unauthorized") {
        navigate("/app");
      } else {
        console.error("Error fetching user info:", error.message);
      }
    }
  }, [navigate]);

  useEffect(() => {
    handleFetchAllUsers();
    handleFetchUser();
  }, [handleFetchAllUsers, handleFetchUser]);

  const handleEditClick = (e, user) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // position the menu just below the button
    setMenuPos({ top: rect.bottom + 8, left: rect.left - 40 });
    setContextMenuUser(user);
  };

  const openDetailsModal = () => {
    setEditingDetailsUser(contextMenuUser);
    setEditDetailsForm({
      name: contextMenuUser.name,
      email: contextMenuUser.email,
    });
    setUpdateCredentials(false);
    setContextMenuUser(null);
  };

  const openRoleModal = () => {
    setEditingRoleUser(contextMenuUser);
    setEditRoleForm({ role: contextMenuUser.role || "user" });
    setContextMenuUser(null);
  };

  const handleEditDetailsSave = (e) => {
    e.preventDefault();
    setUsers((prev) =>
      prev.map((u) =>
        u.id === editingDetailsUser.id ? { ...u, ...editDetailsForm } : u,
      ),
    );
    setEditingDetailsUser(null);
  };

  const handleEditRoleSave = (e) => {
    e.preventDefault();
    setUsers((prev) =>
      prev.map((u) =>
        u.id === editingRoleUser.id ? { ...u, ...editRoleForm } : u,
      ),
    );
    setEditingRoleUser(null);
  };

  // Context Menu State for users, although here we just use inline buttons
  // but keeping it simple as per mockup
  const handleLogout = (userId) => {
    // In a real app this would send a trigger to backend, here we just show alert or console
    console.log(`Action: Logout user ${userId}`);
    alert(`Logged out user ${userId}`);
  };

  const handleDelete = (userId) => {
    if (window.confirm("Are you sure you want to delete this user?")) {
      setUsers((prev) => prev.filter((user) => user.id !== userId));
    }
  };

  return (
    <div className="app-container">
      <div
        className={`sidebar-overlay${sidebarOpen ? " sidebar-overlay-visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar disabled={false} role={userRole || null} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-content">
        <TopBar searchPlaceholder="Search users..." hideUpload={true} onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />

        <div className="content-scroll">
          <div className="section-header">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h2
                className="section-title"
                style={{ fontSize: "24px", fontWeight: "600", margin: 0 }}
              >
                User Management
              </h2>
              {userName && (
                <span
                  style={{
                    fontSize: "14px",
                    color: "var(--text-secondary)",
                    marginTop: "4px",
                  }}
                >
                  {userName}: <i>{userRole}</i>
                </span>
              )}
            </div>
            <div className="section-header-actions">
              <button className="upload-btn" style={{ padding: "8px 20px" }}>
                + Add User
              </button>
            </div>
          </div>

          <table className="users-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: "16px" }}>NAME</th>
                <th style={{ textAlign: "center" }}>EMAIL ID</th>
                <th style={{ textAlign: "center" }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user._id ?? user.id} className="user-row">
                  <td>
                    <div className="user-name-cell">
                      <div
                        className="user-img-fallback"
                        style={{
                          width: "36px",
                          height: "36px",
                          background: "var(--bg-canvas)",
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </div>
                      <span className="user-name-text">{user.name}</span>
                      {user.role === "admin" && (
                        <span className="admin-badge">Admin</span>
                      )}
                      {user.role === "manager" && (
                        <span
                          className="admin-badge"
                          style={{
                            background: "var(--accent-green-soft)",
                            color: "var(--text-primary)",
                          }}
                        >
                          Manager
                        </span>
                      )}
                      {user.role === "user" && (
                        <span
                          className="admin-badge"
                          style={{
                            background: "var(--bg-canvas)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          User
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="user-email-cell"
                    style={{ textAlign: "center" }}
                  >
                    {user.email}
                  </td>
                  <td>
                    <div className="user-actions">
                      <button
                        className="btn-edit"
                        onClick={(e) => handleEditClick(e, user)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-logout"
                        onClick={() => handleLogout(user.id)}
                      >
                        Logout
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(user.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="empty-state-text">No users found.</p>
          )}
        </div>
      </main>

      {/* Edit Options Context Menu */}
      {contextMenuUser && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
            onClick={() => setContextMenuUser(null)}
          />
          <div
            className="context-menu open"
            style={{
              position: "fixed",
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              zIndex: 9999,
              minWidth: "160px",
            }}
          >
            <button
              className="context-menu-item"
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                textAlign: "left",
                fontFamily: "inherit",
              }}
              onClick={openDetailsModal}
            >
              Update user details
            </button>
            <div className="context-menu-divider"></div>
            <button
              className="context-menu-item"
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                textAlign: "left",
                fontFamily: "inherit",
              }}
              onClick={openRoleModal}
            >
              Update role
            </button>
          </div>
        </>
      )}

      {/* Update User Details Modal */}
      {editingDetailsUser && (
        <div
          className="modal-overlay"
          onMouseDown={() => setEditingDetailsUser(null)}
        >
          <div
            className="modal-content"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ width: "320px", padding: "24px", maxWidth: "90%" }}
          >
            <h4
              className="modal-title"
              style={{ margin: "0 0 16px 0", fontSize: "16px" }}
            >
              Update User Details
            </h4>
            <form
              onSubmit={handleEditDetailsSave}
              className="modal-form"
              style={{ gap: "12px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "4px",
                }}
              >
                <input
                  type="checkbox"
                  id="updateCredentials"
                  checked={updateCredentials}
                  onChange={(e) => setUpdateCredentials(e.target.checked)}
                  style={{ accentColor: "var(--accent-black)" }}
                />
                <label
                  htmlFor="updateCredentials"
                  className="auth-input-label"
                  style={{ marginBottom: 0, cursor: "pointer" }}
                >
                  Update credentials
                </label>
              </div>
              <div>
                <label
                  className="auth-input-label"
                  style={{ marginBottom: "6px" }}
                >
                  Name
                </label>
                <input
                  type="text"
                  className="modal-input"
                  style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    opacity: updateCredentials ? 1 : 0.6,
                  }}
                  value={editDetailsForm.name}
                  onChange={(e) =>
                    setEditDetailsForm({
                      ...editDetailsForm,
                      name: e.target.value,
                    })
                  }
                  required
                  disabled={!updateCredentials}
                />
              </div>
              <div>
                <label
                  className="auth-input-label"
                  style={{ marginBottom: "6px" }}
                >
                  Email
                </label>
                <input
                  type="email"
                  className="modal-input"
                  style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    opacity: updateCredentials ? 1 : 0.6,
                  }}
                  value={editDetailsForm.email}
                  onChange={(e) =>
                    setEditDetailsForm({
                      ...editDetailsForm,
                      email: e.target.value,
                    })
                  }
                  required
                  disabled={!updateCredentials}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: "8px" }}>
                <button
                  type="button"
                  className="modal-btn modal-btn-secondary"
                  style={{ padding: "6px 14px", fontSize: "12px" }}
                  onClick={() => setEditingDetailsUser(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn modal-btn-primary"
                  style={{ padding: "6px 14px", fontSize: "12px" }}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Role Modal */}
      {editingRoleUser && (
        <div
          className="modal-overlay"
          onMouseDown={() => setEditingRoleUser(null)}
        >
          <div
            className="modal-content"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ width: "320px", padding: "24px", maxWidth: "90%" }}
          >
            <h4
              className="modal-title"
              style={{ margin: "0 0 16px 0", fontSize: "16px" }}
            >
              Update User Role
            </h4>
            <form
              onSubmit={handleEditRoleSave}
              className="modal-form"
              style={{ gap: "12px" }}
            >
              <div>
                <label
                  className="auth-input-label"
                  style={{ marginBottom: "6px" }}
                >
                  Role
                </label>
                <select
                  className="modal-input"
                  style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    cursor: "pointer",
                    appearance: "auto",
                  }}
                  value={editRoleForm.role}
                  onChange={(e) =>
                    setEditRoleForm({ ...editRoleForm, role: e.target.value })
                  }
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="modal-actions" style={{ marginTop: "8px" }}>
                <button
                  type="button"
                  className="modal-btn modal-btn-secondary"
                  style={{ padding: "6px 14px", fontSize: "12px" }}
                  onClick={() => setEditingRoleUser(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn modal-btn-primary"
                  style={{ padding: "6px 14px", fontSize: "12px" }}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UsersView;
