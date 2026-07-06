// Public API of the subscriptions module. Cross-module consumers import from
// here only (enforced by dependency-cruiser).
export { default as subscriptionRoutes } from './subscription.controller.ts';
export { notifyRelease } from './subscription.notifications.ts';
// Compensation adapter for the saga (wired at the composition root).
export { deleteByConfirmToken } from './subscription.repository.ts';
