const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

/**
 * Utility: handle fetch errors
 */
async function handleFetchErrors(response) {
  if (!response.ok) {
    let errMsg = `Request failed with status ${response.status}`;
    let code = null;
    try {
      const data = await response.json();
      if (data.error) errMsg = data.error;
      if (data.code) code = data.code;
    } catch {
      // If JSON parsing fails, default errMsg stays
    }
    const err = new Error(errMsg);
    if (code) err.code = code;
    throw err;
  }
  return response;
}

export const createSubscription = async (planId) => {
  const response = await fetch(`${BASE_URL}/subscriptions/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ planId }),
    credentials: "include",
  });

  await handleFetchErrors(response);
  return response.json();
};

export const getMySubscription = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/my-plan`, {
    credentials: "include",
  });

  await handleFetchErrors(response);
  return response.json();
};

export const getMySubscriptionBillingDetails = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/my-plan/details`, {
    credentials: "include",
  });

  await handleFetchErrors(response);
  return response.json();
};

export const upgradeSubscription = async (planId) => {
  const response = await fetch(`${BASE_URL}/subscriptions/upgrade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ planId }),
    credentials: "include",
  });

  await handleFetchErrors(response);
  return response.json();
};

export const pauseSubscription = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/pause`, {
    method: "POST",
    credentials: "include",
  });

  await handleFetchErrors(response);
  return response.json();
};

export const resumeSubscription = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/resume`, {
    method: "POST",
    credentials: "include",
  });

  await handleFetchErrors(response);
  return response.json();
};

export const cancelSubscription = async ({ cancelAtCycleEnd = true } = {}) => {
  const response = await fetch(`${BASE_URL}/subscriptions/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cancelAtCycleEnd }),
    credentials: "include",
  });

  await handleFetchErrors(response);
  return response.json();
};
