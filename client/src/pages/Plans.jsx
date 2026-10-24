import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import PricingSection from "../components/landing/PricingSection";
import CurrentPlanCard from "../components/landing/CurrentPlanCard";

const Plans = () => {
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleSubscriptionChange = useCallback((subscription) => {
    setCurrentSubscription(subscription);
  }, []);

  const handleSwitched = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div
      className="min-h-screen px-4 py-10 md:py-14"
      style={{
        backgroundColor: "var(--bg-canvas)",
        color: "var(--text-primary)",
      }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-12 md:mb-16">
          <p
            className="text-sm font-semibold uppercase tracking-[0.24em] mb-4"
            style={{ color: "var(--text-tertiary)" }}
          >
            Plans
          </p>
          <h1
            className="text-5xl md:text-6xl font-bold font-['Outfit'] mb-5 tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Choose the storage plan that fits your workflow
          </h1>
          <p
            className="text-lg md:text-xl"
            style={{ color: "var(--text-secondary)" }}
          >
            Compare the subscription tiers from File Shelter and upgrade when
            your team or storage needs grow.
          </p>
        </div>

        <CurrentPlanCard
          key={reloadKey}
          onChange={handleSubscriptionChange}
        />

        <div className="flex justify-center mb-14 md:mb-16">
          <PricingSection
            currentSubscription={currentSubscription}
            onPlanSwitched={handleSwitched}
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/app"
            className="px-6 py-3 rounded-full text-base font-semibold transition-all hover:scale-105"
            style={{
              backgroundColor: "var(--accent-black)",
              color: "var(--bg-canvas)",
              boxShadow: "0 16px 32px rgba(0,0,0,0.12)",
            }}
          >
            Back to app
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Plans;
