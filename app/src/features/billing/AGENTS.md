# Billing UI

- Cloud/Stripe owns subscription facts. Cache in memory per Clerk user; mount,
  focus and browser return requery. Never persist hosted links, card details,
  or subscription status.
- Unmount invalidates pending browser handoffs. Failed reads never mean
  unsubscribed.
- Desktop opens validated Stripe links. Return/focus only trigger queries;
  neither proves checkout succeeded. Shared Query/Sonner owns operational errors.
- SubscriptionPlanCard owns the unsubmitted month/year choice without Settings,
  routing or transport dependencies. `offersSubscription` is the one eligibility
  rule; Subscription (Settings), SubscribeBanner (sidebar) and CloudOfferCard
  own checkout. Failed reads never enable an offer. Active/trialing accounts see
  Invite friends; the app owns Subscription navigation.
- CloudOfferCard shows [lib/upsell](../../lib/upsell/AGENTS.md) moments
  only to accounts without Cloud access.
- Only a status change from the cached one reports `onStatusChange`; providers
  check access at start, and the sidebar keeps the cache for the session.
- Subscriptions reuse Settings Card/CardItem and shared controls.
  Terminal subscriptions can resubscribe without a billing-management action.
- Invitations/access share the cache. Cloud owns three lifetime codes and one
  redemption; self-redemption is forbidden. UI blocks known own codes.
  Issue once per mount; retry writes manually.
  Confirmed redemption reports `onAccessChange` to refresh providers, retaining
  `none` and the subscribe banner. Unmount drops callbacks.
