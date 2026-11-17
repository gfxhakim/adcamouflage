# Referral and partner program

Two separate ways customers bring in customers. Everything is run from
**Admin > Affiliates**, and customers see their side under **Invite & earn**.

A customer belongs to one channel only, and codes never stack. The last link
or code used before the first payment wins. A link keeps counting for 30 days
after the click.

## 1. Friend referral

Every active subscriber gets a personal link and a coupon code.

| | Default |
|---|---|
| Friend's discount | 10% off the first Pro or Max payment (not Starter) |
| Referrer's reward | 300 tokens if the friend buys Starter, 750 for Pro, 1,250 for Max |
| When | 7 days after the friend's first payment |
| Limit | 10 rewards per month |

Reward tokens are used after the plan's own tokens and before paid top-ups.
They do not roll over, do not expire while the referrer stays subscribed, and
are written off when the referrer cancels or lets the plan lapse.

No reward when the friend cancels or is refunded inside the 7 days, or when
the referrer has no active plan on the day the reward is due.

## 2. Creator partners

A creator applies from **Invite & earn** with the code they want. You approve
or reject it in Admin and can change the code before approving.

| | Default |
|---|---|
| Audience discount | 15% off the first payment, any plan |
| Commission | A share of what their customers actually pay: plans, renewals, upgrades, top-ups |
| Tiers | Up to 19 paying customers in the month 25%, 20 to 49 30%, 50 or more 35% |
| Ready to pay | 30 days after the customer paid |
| Minimum payout | $50 |

The tier is worked out for each month by itself and applies to all of that
month's revenue. Nothing is recalculated for earlier months.

Commission runs for as long as the customer stays subscribed. If their plan
ends and they come back later, the commission does not start again.

### Paying a partner

The app never sends money. Open the partner in Admin > Affiliates, send the
"Ready to pay" amount yourself (USDT, Volet), then press **Mark paid** with
the transaction id. Under the minimum, the app asks before it lets you pay.

## Refunds

After you send a customer's money back, open the customer in Admin > Users
and press **Mark refunded** on that order. This:

- cancels the referrer's pending reward, or takes the tokens back if it was
  already given;
- cancels the partner's commission, or takes it off their next payout if it
  was already paid.

It does not change the customer's own plan or tokens. Use **Cancel now** in
the plan tools for that.

## Self-referral checks

A referral is blocked when the new account shares the referrer's mailbox
(plus-tags and Gmail dots are ignored), the same browser, or the same
paying Whop account. The same network alone is only flagged, because friends
and offices share networks. You can **Allow** a blocked referral or **Cancel**
any referral from the list.

These checks stop the easy cases. Someone using a different browser, email
and payment account still looks like a new customer, so have a look at
**Flagged** now and then.

## Suspending a partner

**Suspend** turns their code off and cancels commissions still on hold.
Money already paid is not touched. **Reinstate** turns the code back on.

## Batch costs

Admin > Sales > **Batch costs** shows what each batch cost on hosting: render
time (CPU and memory) plus download bandwidth. It is measured per output from
the moment this version is live, so older batches are not listed.

The prices are Railway's usage rates and can be edited with **Edit rates**
when Railway changes them.
