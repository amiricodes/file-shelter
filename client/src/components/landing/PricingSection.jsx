import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  createSubscription,
  upgradeSubscription,
} from "../../apis/subscriptionApi";
import { fetchUser } from "../../apis/userApi";

const RAZORPAY_KEY_ID = import.meta.env.VITE_RZP_KEY_ID;

const PRICING_PLANS = [
  {
    name: "Free",
    monthlyPrice: 0,
    yearlyDiscount: 0,
    highlighted: false,
    features: [
      "50 GB secure storage",
      "File upload limit: 100 MB per file",
      "Access from 1 device",
      "Standard download speed",
      "Basic email support",
    ],
  },
  {
    name: "Pro",
    monthlyPrice: 199,
    yearlyPrice: 149,
    yearlyDiscount: 50,
    highlighted: true,
    rzpPlanIds: {
      monthly: import.meta.env.VITE_RZP_PLAN_PRO_MONTHLY,
      yearly: import.meta.env.VITE_RZP_PLAN_PRO_YEARLY,
    },
    features: [
      "200 GB secure storage",
      "File upload limit: 2 GB per file",
      "Access from up to 3 devices",
      "Priority upload/download speed",
      "Email & chat support",
    ],
  },
  {
    name: "Premium",
    monthlyPrice: 649,
    yearlyPrice: 499,
    yearlyDiscount: 100,
    highlighted: false,
    rzpPlanIds: {
      monthly: import.meta.env.VITE_RZP_PLAN_PREMIUM_MONTHLY,
      yearly: import.meta.env.VITE_RZP_PLAN_PREMIUM_YEARLY,
    },
    features: [
      "2 TB secure storage",
      "File upload limit: 10 GB per file",
      "Access from up to 3 devices",
      "Priority upload/download speed",
      "Priority customer support",
    ],
  },
];

function openRazorpayPopup({ subscriptionId }) {
  if (!RAZORPAY_KEY_ID) {
    console.error("Missing VITE_RZP_KEY_ID_TEST in client env");
    return;
  }

  const rzp = new Razorpay({
    key: RAZORPAY_KEY_ID,
    description: "Storage subscription payment",
    name: "File Shelter",
    subscription_id: subscriptionId,
    handler: function () {
      window.location.href = "/app";
    },
  });

  rzp.on("payment.failed", function (response) {
    console.error("Razorpay payment failed", response);
  });

  rzp.open();
}

const PricingSection = ({ currentSubscription = null, onPlanSwitched }) => {
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [busyPlanKey, setBusyPlanKey] = useState(null);
  const [noticeMessage, setNoticeMessage] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  const hasActiveSubscription = Boolean(currentSubscription?.planId);
  const isSubscriptionTerminal =
    currentSubscription?.status === "cancelled" ||
    currentSubscription?.status === "canceled" ||
    currentSubscription?.status === "completed" ||
    currentSubscription?.status === "complete";
  const canUpgrade = hasActiveSubscription && !isSubscriptionTerminal;

  useEffect(() => {
    const razorpayScript = document.querySelector("#razorpay-script");
    if (razorpayScript) return;

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.id = "razorpay-script";
    document.body.appendChild(script);
  }, []);

  const redirectToLogin = () => {
    const from = `${location.pathname}${location.search}${location.hash}`;
    navigate("/login", {
      state: {
        from,
        notice: "Please log in first to buy more storage.",
      },
    });
  };

  const handleBuyClick = async (plan) => {
    const planId = plan.rzpPlanIds?.[billingCycle];
    if (!planId) {
      console.error(
        `Missing Razorpay plan id for ${plan.name} (${billingCycle})`,
      );
      return;
    }

    const planKey = `${plan.name}-${billingCycle}`;
    setBusyPlanKey(planKey);
    setNoticeMessage("");

    try {
      await fetchUser();
    } catch (error) {
      setBusyPlanKey(null);
      if (error.message === "Unauthorized") {
        redirectToLogin();
        return;
      }
      console.error("Failed to check auth state", error);
      return;
    }

    try {
      if (canUpgrade) {
        await upgradeSubscription(planId);
        onPlanSwitched?.();
      } else {
        const { subscriptionId } = await createSubscription(planId);
        if (subscriptionId) {
          openRazorpayPopup({ subscriptionId });
        } else {
          console.error(
            "Missing subscriptionId in createSubscription response",
          );
        }
      }
    } catch (error) {
      if (error.message === "Unauthorized") {
        redirectToLogin();
        return;
      }
      if (error.code === "UPI_UPGRADE_NOT_SUPPORTED") {
        setNoticeMessage(error.message);
        return;
      }
      console.error("Subscription action failed", error);
    } finally {
      setBusyPlanKey(null);
    }
  };

  const planCards = useMemo(
    () =>
      PRICING_PLANS.map((plan) => {
        const monthlyPrice = plan.monthlyPrice;
        const yearlyMonthlyPrice = plan.yearlyPrice ?? monthlyPrice;
        const yearlyTotal = yearlyMonthlyPrice * 12;
        const monthlyEquivalent = yearlyTotal / 12;
        const yearlySavings = (monthlyPrice - yearlyMonthlyPrice) * 12;
        const planId = plan.rzpPlanIds?.[billingCycle];
        const isCurrent =
          canUpgrade && planId && planId === currentSubscription?.planId;

        let buyLabel = null;
        if (plan.name === "Pro" || plan.name === "Premium") {
          const sizeLabel = plan.name === "Pro" ? "200GB" : "2TB";
          if (isCurrent) {
            buyLabel = "Current plan";
          } else if (canUpgrade) {
            buyLabel = `Switch to ${sizeLabel}`;
          } else {
            buyLabel = `Choose ${sizeLabel}`;
          }
        }

        return {
          ...plan,
          planId,
          isCurrent,
          buyLabel,
          priceLabel:
            billingCycle === "monthly"
              ? monthlyPrice === 0
                ? "₹0"
                : `₹${monthlyPrice}/mo`
              : monthlyEquivalent === 0
                ? "₹0"
                : `₹${monthlyEquivalent.toFixed(0)}/mo`,
          billingNote:
            billingCycle === "monthly"
              ? monthlyPrice === 0
                ? "Billed monthly"
                : "Billed every month"
              : `Billed annually at ₹${yearlyTotal.toLocaleString()}`,
          savingsNote:
            billingCycle === "yearly" && plan.yearlyDiscount > 0
              ? `Saves you ₹${yearlySavings.toLocaleString()} per year`
              : "",
        };
      }),
    [billingCycle, canUpgrade, currentSubscription?.planId],
  );

  return (
    <section id="pricing" className="w-full max-w-6xl px-2 sm:px-4">
      <div className="text-center mb-10">
        <h2
          className="text-4xl md:text-5xl font-bold font-['Outfit'] mb-3"
          style={{ color: "var(--text-primary)" }}
        >
          Pricing
        </h2>
        <p style={{ color: "var(--text-secondary)" }}>
          Start free and upgrade when your storage and collaboration needs grow.
        </p>
      </div>

      {noticeMessage ? (
        <div
          role="status"
          className="mx-auto mb-8 max-w-2xl rounded-2xl border px-5 py-4 flex items-start gap-3"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
            boxShadow: "var(--shadow-float)",
          }}
        >
          <span
            aria-hidden="true"
            className="mt-0.5 text-lg"
            style={{ color: "#b06b00" }}
          >
            ⚠
          </span>
          <p className="flex-1 text-sm leading-relaxed">{noticeMessage}</p>
          <button
            type="button"
            onClick={() => setNoticeMessage("")}
            aria-label="Dismiss notice"
            className="text-sm font-semibold"
            style={{ color: "var(--text-tertiary)" }}
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="flex justify-center mb-10">
        <div
          className="inline-flex rounded-full p-1 border"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
            boxShadow: "var(--shadow-float)",
          }}
        >
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className="px-5 py-2 rounded-full text-sm font-semibold transition-all"
            style={{
              backgroundColor:
                billingCycle === "monthly"
                  ? "var(--accent-black)"
                  : "transparent",
              color:
                billingCycle === "monthly"
                  ? "var(--bg-canvas)"
                  : "var(--text-secondary)",
            }}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle("yearly")}
            className="px-5 py-2 rounded-full text-sm font-semibold transition-all"
            style={{
              backgroundColor:
                billingCycle === "yearly"
                  ? "var(--accent-black)"
                  : "transparent",
              color:
                billingCycle === "yearly"
                  ? "var(--bg-canvas)"
                  : "var(--text-secondary)",
            }}
          >
            Yearly
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {planCards.map((plan) => {
          const planKey = `${plan.name}-${billingCycle}`;
          const isBusy = busyPlanKey === planKey;
          const buttonDisabled = plan.isCurrent || isBusy;
          return (
            <div
              key={plan.name}
              className="rounded-2xl p-8 border text-center"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: plan.highlighted
                  ? "var(--accent-black)"
                  : "var(--border-subtle)",
                boxShadow: plan.highlighted ? "var(--shadow-float)" : "none",
              }}
            >
              <p
                className="text-base mb-2"
                style={{ color: "var(--text-primary)" }}
              >
                {plan.name}
              </p>
              <p
                className="text-4xl font-bold mb-4"
                style={{ color: "var(--text-primary)" }}
              >
                {plan.priceLabel}
              </p>
              <p
                className="text-base md:text-lg font-medium mb-4"
                style={{
                  color: "var(--text-primary)",
                }}
              >
                <span>{plan.billingNote}</span>
                {plan.savingsNote ? (
                  <span className="block mt-1" style={{ color: "#2e8b57" }}>
                    {plan.savingsNote}
                  </span>
                ) : null}
              </p>
              <ul
                className="mt-4 pt-3 border-t space-y-2 text-base md:text-[16px] leading-6 font-semibold"
                style={{
                  color: "var(--text-secondary)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[#2e8b57]" aria-hidden="true">
                      ✓
                    </span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {plan.buyLabel ? (
                <button
                  type="button"
                  onClick={() => handleBuyClick(plan)}
                  disabled={buttonDisabled}
                  className="mt-6 w-full cursor-pointer rounded-xl px-4 py-3 text-base md:text-lg font-semibold transition-all duration-150 enabled:hover:opacity-90 enabled:hover:shadow-lg motion-safe:enabled:hover:-translate-y-0.5 motion-safe:enabled:active:translate-y-0 motion-safe:enabled:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent-black)] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: "var(--accent-black)",
                    color: "var(--bg-canvas)",
                  }}
                >
                  {isBusy ? "Please wait…" : plan.buyLabel}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default PricingSection;
