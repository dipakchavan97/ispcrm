import { SubscriptionStatus } from './enums';

/**
 * Finite State Transition Matrix for Subscriptions
 */
export const ALLOWED_SUBSCRIPTION_TRANSITIONS: Record<
  SubscriptionStatus,
  SubscriptionStatus[]
> = {
  [SubscriptionStatus.PENDING]: [
    SubscriptionStatus.ACTIVE, // activate
    SubscriptionStatus.CANCELLED, // cancel
  ],
  [SubscriptionStatus.ACTIVE]: [
    SubscriptionStatus.ACTIVE, // renew, upgrade, downgrade (same status, extended date/plan)
    SubscriptionStatus.GRACE, // entered grace period
    SubscriptionStatus.SUSPENDED, // suspend
    SubscriptionStatus.EXPIRED, // expired
    SubscriptionStatus.CANCELLED, // cancel
  ],
  [SubscriptionStatus.GRACE]: [
    SubscriptionStatus.ACTIVE, // renew / payment collected
    SubscriptionStatus.SUSPENDED, // suspend
    SubscriptionStatus.EXPIRED, // grace period elapsed
    SubscriptionStatus.CANCELLED, // cancel
  ],
  [SubscriptionStatus.SUSPENDED]: [
    SubscriptionStatus.ACTIVE, // reactivate, renew
    SubscriptionStatus.EXPIRED, // expire while suspended
    SubscriptionStatus.CANCELLED, // cancel
  ],
  [SubscriptionStatus.EXPIRED]: [
    SubscriptionStatus.ACTIVE, // renew from expired
    SubscriptionStatus.CANCELLED, // cancel
  ],
  [SubscriptionStatus.CANCELLED]: [
    // Terminal state. No transitions allowed out of CANCELLED.
  ],
};

/**
 * Validates a requested subscription status transition.
 * Returns true if valid, or throws an error explaining why the transition is prohibited.
 */
export function validateSubscriptionTransition(
  fromStatus: SubscriptionStatus,
  toStatus: SubscriptionStatus,
  actionName?: string,
): boolean {
  if (fromStatus === SubscriptionStatus.CANCELLED) {
    throw new Error(
      `Cannot perform action${actionName ? ` '${actionName}'` : ''}: subscription is CANCELLED (terminal state)`,
    );
  }

  const allowed = ALLOWED_SUBSCRIPTION_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Invalid subscription state transition from '${fromStatus}' to '${toStatus}'${
        actionName ? ` for action '${actionName}'` : ''
      }`,
    );
  }

  return true;
}

/**
 * Checks if a transition is allowed without throwing.
 */
export function canTransitionSubscription(
  fromStatus: SubscriptionStatus,
  toStatus: SubscriptionStatus,
): boolean {
  if (fromStatus === SubscriptionStatus.CANCELLED) return false;
  const allowed = ALLOWED_SUBSCRIPTION_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}
