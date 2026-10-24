import { useCallback, useEffect, useState } from "react";
import {
  cancelSubscription,
  getMySubscription,
  getMySubscriptionBillingDetails,
  pauseSubscription,
  resumeSubscription,
} from "../../apis/subscriptionApi";

const PLAN_LABELS = {
  [import.meta.env.VITE_RZP_PLAN_PRO_MONTHLY]: "Pro (Monthly)",
  [import.meta.env.VITE_RZP_PLAN_PRO_YEARLY]: "Pro (Yearly)",
  [import.meta.env.VITE_RZP_PLAN_PREMIUM_MONTHLY]: "Premium (Monthly)",
  [import.meta.env.VITE_RZP_PLAN_PREMIUM_YEARLY]: "Premium (Yearly)",
};

const labelForPlan = (planId) => PLAN_LABELS[planId] || "Active plan";

const formatRzpDate = (epochSeconds) => {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const STATUS_COPY = {
  created: "Awaiting first payment",
  authenticated: "Awaiting first payment",
  active: "Active",
  pending: "Payment pending",
  halted: "Payment failed",
  paused: "Paused",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  completed: "Completed",
  complete: "Completed",
  expired: "Expired",
};

function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onCancel]);

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        <p
          style={{
            color: "var(--text-secondary)",
            marginBottom: "1.25rem",
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>
        <div className="modal-actions">
          <button
            className="modal-btn modal-btn-primary"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
          <button
            className="modal-btn modal-btn-secondary"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            Keep plan
          </button>
        </div>
      </div>
    </div>
  );
}

const CurrentPlanCard = ({ onChange }) => {
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // "pause" | "resume" | "cancel" | null
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMySubscription();
      const summary = data?.subscription ?? null;
      setSubscription(summary);
      onChange?.(summary);
      if (summary) {
        getMySubscriptionBillingDetails()
          .then((billing) => {
            setSubscription((current) =>
              current ? { ...current, ...(billing?.subscription ?? {}) } : current,
            );
          })
          .catch(() => {});
      }
    } catch (error) {
      if (error.message !== "Unauthorized") {
        setErrorMsg(error.message);
      }
      setSubscription(null);
      onChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    load();
  }, [load]);

  const status = subscription?.status;
  const statusLabel = (status && STATUS_COPY[status]) || status || "";
  const nextBilling = subscription
    ? formatRzpDate(subscription.chargeAt || subscription.currentEnd)
    : null;
  const isPaused = status === "paused";
  const isCancelled = status === "cancelled" || status === "canceled";
  const isTerminal =
    isCancelled || status === "completed" || status === "complete";
  const open = loading || Boolean(subscription);

  const runAction = async (action) => {
    setActionBusy(true);
    setErrorMsg("");
    try {
      if (action === "pause") await pauseSubscription();
      else if (action === "resume") await resumeSubscription();
      else if (action === "cancel")
        await cancelSubscription({ cancelAtCycleEnd: true });
      await load();
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      setActionBusy(false);
      setConfirm(null);
    }
  };

  return (
    <>
      <div
        className="overflow-hidden"
        style={{
          maxHeight: open ? "1000px" : "0px",
          opacity: open ? 1 : 0,
          marginBottom: open ? "2.5rem" : "0px",
          transition:
            "max-height 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease-out, margin-bottom 320ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {loading ? (
          <div
            className="rounded-2xl p-6 md:p-8 border flex items-center justify-center gap-3"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              boxShadow: "var(--shadow-float)",
              minHeight: "112px",
            }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin"
              style={{ color: "var(--text-tertiary)" }}
            />
            <span
              className="text-sm font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Loading your current plan…
            </span>
          </div>
        ) : subscription ? (
          <div
            className="rounded-2xl p-6 md:p-8 border"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              boxShadow: "var(--shadow-float)",
            }}
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <p
                  className="text-sm font-semibold uppercase tracking-[0.18em] mb-2"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Your current plan
                </p>
                <h3
                  className="text-2xl md:text-3xl font-bold mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  {labelForPlan(subscription.planId)}
                </h3>
                <p style={{ color: "var(--text-secondary)" }}>
                  <span
                    className="inline-block rounded-full px-3 py-1 text-xs font-semibold mr-2"
                    style={{
                      backgroundColor: isTerminal
                        ? "rgba(220, 53, 69, 0.12)"
                        : isPaused
                          ? "rgba(255, 159, 28, 0.15)"
                          : "rgba(46, 139, 87, 0.15)",
                      color: isTerminal
                        ? "#dc3545"
                        : isPaused
                          ? "#b06b00"
                          : "#2e8b57",
                    }}
                  >
                    {statusLabel}
                  </span>
                  {nextBilling && !isTerminal ? (
                    <span>
                      {isCancelled || status === "cancelled"
                        ? "Access until "
                        : "Next billing on "}
                      {nextBilling}
                    </span>
                  ) : null}
                </p>
                {errorMsg ? (
                  <p className="mt-3 text-sm" style={{ color: "#dc3545" }}>
                    {errorMsg}
                  </p>
                ) : null}
              </div>

              {!isTerminal ? (
                <div className="flex flex-wrap gap-3">
                  {isPaused ? (
                    <button
                      type="button"
                      onClick={() => setConfirm("resume")}
                      disabled={actionBusy}
                      className="px-5 py-2.5 rounded-full text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                      style={{
                        backgroundColor: "var(--accent-black)",
                        color: "var(--bg-canvas)",
                      }}
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirm("pause")}
                      disabled={actionBusy}
                      className="px-5 py-2.5 rounded-full text-sm font-semibold border transition-all hover:opacity-90 disabled:opacity-50"
                      style={{
                        backgroundColor: "transparent",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    >
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirm("cancel")}
                    disabled={actionBusy}
                    className="px-5 py-2.5 rounded-full text-sm font-semibold border transition-all hover:opacity-90 disabled:opacity-50"
                    style={{
                      backgroundColor: "transparent",
                      borderColor: "#dc3545",
                      color: "#dc3545",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {confirm === "pause" ? (
        <ConfirmModal
          title="Pause subscription?"
          message="Pausing stops future charges. Your storage quota stays the same until you resume or cancel."
          confirmLabel="Pause subscription"
          busy={actionBusy}
          onConfirm={() => runAction("pause")}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {confirm === "resume" ? (
        <ConfirmModal
          title="Resume subscription?"
          message="Resuming reactivates billing on your next cycle."
          confirmLabel="Resume subscription"
          busy={actionBusy}
          onConfirm={() => runAction("resume")}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {confirm === "cancel" ? (
        <ConfirmModal
          title="Cancel subscription?"
          message={
            nextBilling
              ? `You'll keep access until ${nextBilling}, then your storage will return to the free tier.`
              : "Your storage will return to the free tier at the end of the current billing cycle."
          }
          confirmLabel="Cancel subscription"
          busy={actionBusy}
          onConfirm={() => runAction("cancel")}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
};

export default CurrentPlanCard;
