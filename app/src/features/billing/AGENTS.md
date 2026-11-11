# Billing UI

- Settings manages existing subscriptions only. Never mount purchase banners,
  offer cards, plan selectors or invitation components; their retained source is
  historical and has no app composition entry point.
- Stripe owns subscription facts. Cache in memory per Clerk user; mount, focus
  and billing returns requery. Never persist hosted links, card details or status.
- Unmount invalidates pending browser handoffs. Failed reads remain errors and
  disable management actions; they never mean unsubscribed.
- Desktop opens validated Stripe links. Return/focus triggers queries and never
  proves payment success. Shared Query/Sonner owns operational errors.
- Preserve the Subscription route for old deep links and existing customers.
  An account with no subscription sees an explanation of free Desktop and
  retired market data, without a purchase action.
- Use Settings Card/CardItem and shared controls. Current subscription states,
  scheduled cancellation and billing dates remain visible even after retirement.
