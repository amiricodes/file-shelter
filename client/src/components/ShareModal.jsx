import { useEffect, useState } from "react";
import {
  createShare,
  updateShare,
  revokeShare,
} from "../apis/shareApi";

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never", ms: null },
  { value: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { value: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
];

function parseEmails(text) {
  const emails = text
    .split(/[,;\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

function expiryChoiceFor(share) {
  if (!share?.expiresAt) return "never";
  const expiresAt = new Date(share.expiresAt).getTime();
  const match = EXPIRY_OPTIONS.find(
    (option) =>
      option.ms && Math.abs(expiresAt - (new Date(share.updatedAt || Date.now()).getTime() + option.ms)) < 60_000,
  );
  return match ? match.value : "custom";
}

function ShareModal({ item, onClose }) {
  const [share, setShare] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const [accessType, setAccessType] = useState("public");
  const [emailsText, setEmailsText] = useState("");
  const [expiryChoice, setExpiryChoice] = useState("never");

  const resourceType = item.isDirectory ? "directory" : "file";
  const shareLink = share ? `${window.location.origin}/share/${share.token}` : "";

  useEffect(() => {
    let cancelled = false;

    createShare(resourceType, item.id)
      .then((data) => {
        if (cancelled) return;
        setShare(data);
        setAccessType(data.accessType === "restricted" ? "restricted" : "public");
        setEmailsText((data.allowedEmails || []).join(", "));
        setExpiryChoice(expiryChoiceFor(data));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [resourceType, item.id]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", shareLink);
    }
  };

  const handleSave = async () => {
    const allowedEmails = parseEmails(emailsText);
    if (accessType === "restricted" && allowedEmails.length === 0) {
      setActionError("Add at least one email address for a restricted link.");
      return;
    }

    const option = EXPIRY_OPTIONS.find((o) => o.value === expiryChoice);
    setSaving(true);
    setActionError("");
    try {
      const updated = await updateShare(share.id, {
        accessType,
        allowedEmails,
        expiresAt:
          option && option.ms
            ? new Date(Date.now() + option.ms).toISOString()
            : null,
      });
      setShare(updated);
      setExpiryChoice(expiryChoiceFor(updated));
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm("Revoke this share link? Anyone with the link will lose access.")) {
      return;
    }

    try {
      await revokeShare(share.id);
      onClose();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleContentClick = (e) => e.stopPropagation();

  const isDirty =
    share &&
    (accessType !== (share.accessType || "public") ||
      expiryChoice !== expiryChoiceFor(share) ||
      (accessType === "restricted" &&
        emailsText !== (share.allowedEmails || []).join(", ")));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={handleContentClick}>
        <h2 className="modal-title">Share &quot;{item.name}&quot;</h2>

        {loadError && <div className="error-banner">{loadError}</div>}

        {!share && !loadError && (
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
            Creating link…
          </p>
        )}

        {share && (
          <div className="modal-form">
            <div className="share-link-row">
              <input
                type="text"
                readOnly
                className="modal-input"
                value={shareLink}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="modal-btn modal-btn-primary"
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <label className="share-field">
              Who can open this link?
              <select
                className="modal-input"
                value={accessType}
                onChange={(e) => setAccessType(e.target.value)}
              >
                <option value="public">Anyone with the link</option>
                <option value="restricted">Specific email addresses</option>
              </select>
            </label>

            {accessType === "restricted" && (
              <label className="share-field">
                Allowed emails (comma separated)
                <textarea
                  className="modal-input"
                  rows={3}
                  placeholder="friend@example.com, colleague@work.com"
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                />
              </label>
            )}

            <label className="share-field">
              Link expires
              <select
                className="modal-input"
                value={expiryChoice}
                onChange={(e) => setExpiryChoice(e.target.value)}
              >
                {expiryChoice === "custom" && (
                  <option value="custom">Custom</option>
                )}
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {actionError && <div className="error-banner">{actionError}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-primary"
                onClick={handleSave}
                disabled={saving || !isDirty}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-secondary share-revoke-btn"
                onClick={handleRevoke}
              >
                Revoke link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ShareModal;
