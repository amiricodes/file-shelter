import { parseApiResponse } from "./apiResponse";

const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

export const createSubscription = async (planId) => {
  const response = await fetch(`${BASE_URL}/subscriptions/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ planId }),
    credentials: "include",
  });

  return parseApiResponse(response);
};

export const getMySubscription = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/my-plan`, {
    credentials: "include",
  });

  return parseApiResponse(response);
};

export const getMySubscriptionBillingDetails = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/my-plan/details`, {
    credentials: "include",
  });

  return parseApiResponse(response);
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

  return parseApiResponse(response);
};

export const pauseSubscription = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/pause`, {
    method: "POST",
    credentials: "include",
  });

  return parseApiResponse(response);
};

export const resumeSubscription = async () => {
  const response = await fetch(`${BASE_URL}/subscriptions/resume`, {
    method: "POST",
    credentials: "include",
  });

  return parseApiResponse(response);
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

  return parseApiResponse(response);
};
