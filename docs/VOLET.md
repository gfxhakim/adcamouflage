# Taking payments with Volet.com (Hosted Checkout)

This is a click-by-click guide for connecting this app to a verified
Volet.com account (see section 2 for which kind) so customers can pay on
Volet's hosted payment page. There
is no server to run: Volet hosts the payment page, the customer pays from a
Volet balance or a crypto wallet, and the money is credited to your Volet
account, from which you withdraw it. The app's own plans, prices and order
history are the same whether a customer pays through Volet or through
BTCPay ([BTCPAY.md](BTCPAY.md)); you can run one of the two or both.

Plan on an hour for the setup, plus the time Volet takes to verify the
account and approve the new payment gateway (see section 2).

Everything here was checked against Volet's published documentation on
2026-10-30. Volet's technical document still calls the feature the **SCI**
(Shopping Cart Interface); the account dashboard now calls it **Hosted
Checkout**. The parameters and links are the same. Where a screen could not
be verified, the step says **check in your Volet account**; Volet changes its
dashboard, so if a button is not where this guide says, look for the same
words nearby.

## What the app needs from you

When you are done you will paste four values into Railway, on the `api`
service (see section 4):

| Variable | What it is | Example |
| --- | --- | --- |
| `ADCAM_VOLET_ACCOUNT_EMAIL` | The e-mail address of your Volet.com account (the one you log in with) | `you@example.com` |
| `ADCAM_VOLET_SCI_NAME` | The name you give the Hosted Checkout when you create it (section 3) | `blucloack` |
| `ADCAM_VOLET_SCI_SECRET` | The Hosted Checkout password (the SCI password) you set when you create it (section 3) | a long random string |
| `ADCAM_PUBLIC_URL` | The public address of this app, where customers are sent back after paying; 40 characters or fewer | `https://blucloack.online` |

The app talks to Volet in two directions:

- **App to Volet**: when a customer clicks Subscribe (or buys a top-up), the
  app records a pending order and opens a small page of its own,
  `https://blucloack.online/api/v1/billing/orders/<order id>/pay`, that says
  "Taking you to Volet…" and forwards the customer's browser to Volet's
  payment page at `https://account.volet.com/sci/` with the amount, currency,
  order id and a signature computed from the Hosted Checkout password. Volet
  checks the signature before showing the payment page.
- **Volet to app**: when the payment is complete, Volet sends a **status
  notification** in the background to
  `https://blucloack.online/api/v1/billing/volet/status`. The public web
  domain forwards everything under `/api` to the private `api` service on
  Railway, so Volet only ever needs to reach `blucloack.online`. The app
  checks the notification's hash (computed with the same password) and that
  it was sent from one of Volet's own addresses before trusting it, then
  credits the order once. The notification is the only thing that credits a
  Volet order: unlike BTCPay, there is no second check with Volet when the
  customer comes back, so section 6 matters.

Until the first three variables are set, Volet does not appear on the plan
page. If BTCPay is not set up either, the app answers every purchase attempt
with "Payments are not set up yet." and the plan page shows "Payments are
being set up". That is expected; nothing is broken.

## Words you will meet

- **Hosted Checkout / SCI**: Volet's hosted payment page and the settings
  that go with it (a name, a password, three addresses). One Hosted Checkout
  is one "store" on the Volet side. Volet's SCI document says a merchant may
  create up to 20 of them.
- **Hosted Checkout password** (SCI password): a secret you choose when
  creating the Hosted Checkout. The app uses it to sign each payment request
  and to check each status notification. Volet's guide says: "Keep it
  private and do not expose it in client-side code."
- **Status URL / status notification**: Volet calling the app's address in
  the background when a payment changes status. It is what credits tokens.
- **Success URL / Failed URL**: where Volet sends the customer's browser
  after a completed or a cancelled payment.
- **Custodial**: the money is held in your Volet account rather than in a
  wallet you control. You withdraw it to a bank, a card or your own crypto
  wallet (section 7).
- **Order id**: the app's reference for one purchase. It travels to Volet
  as `ac_order_id` and comes back in the notification, which is how the app
  knows which order to credit.

---

## 1. What Volet gives you, and what it does not

Source: <https://volet.com/docs/guides/accept-payments/accept-payments-overview>
and <https://volet.com/business/fees>.

- **What the customer can pay with.** Volet's overview describes two
  payment methods for a Hosted Checkout: cryptocurrency from an external
  wallet, and the customer's own Volet.com account balance. The page says
  customers who want to pay from fiat must first "fund their Volet.com
  account using a card, bank transfer, or cryptocurrency," and then pay from
  that balance. It also says: "Volet.com does not provide traditional card
  acquiring (direct Visa/Mastercard payments on your website)." So a customer
  cannot type a card number on the payment page; which methods actually show
  depends on what you enable in section 3 and on what Volet offers the
  customer: **check in your Volet account**.
- **Where the money lands.** "Funds received through custodial payments are
  credited to your Volet.com account." and "Funds become available
  immediately after the payment is completed." The page also states that
  "Volet.com does not apply rolling reserves to completed payments." You then
  withdraw from the Volet balance (section 7).
- **Currencies.** The overview says: "Settlements are available in USD, EUR,
  stablecoins, and cryptocurrencies." The app sends each order in the
  currency set in the admin panel (Settings tab; `USD` unless you changed
  it), and only credits an order whose notification comes back in that same
  currency (section 6). Whether your Volet account receives that currency
  as-is or converts it is decided on the Volet side: **check in your Volet
  account**.
- **Fees.** The overview says: "Processing fees start at 0.25% for
  stablecoin payments. No setup fees, no monthly fees." and "You can choose
  whether the processing fee is paid by you or added to the customer's
  payment amount." The business fee page, as read on 2026-10-30, lists under
  Payment tools "Accept payments from Volet.com users: 0.25%" and "Accept
  stablecoins and crypto payments: From 0.25%", and separate fees for
  withdrawals (section 7). Its FAQ says the exact percentage "depends on the
  payment method and your plan". Rates change; the current ones are at
  <https://volet.com/business/fees> and in your account.
- **No test mode.** None of the pages read mentions a sandbox or test mode,
  so the first test is a small real payment (section 5).

---

## 2. Account requirements

Sources: <https://volet.com/docs/guides/overview/verification> and
<https://volet.com/docs/guides/accept-payments/accept-payments-overview>.

1. **Most likely a business account.** Volet's verification page lists the
   payment gateway only under a fully verified business account: "Business
   accounts require company verification before you can accept payments,
   send payouts, and access banking services." The business account levels
   it lists are "Registration only" (e-mail confirmed, dashboard access only)
   and "Fully verified", which asks for company documents and the identity
   of the responsible persons (directors, beneficiaries) and unlocks the
   payment gateway, mass payouts, banking transfers and the APIs. The
   accept-payments overview, though, only says "you need a verified
   Volet.com account" and links to both the personal and the business
   verification pages, so a verified **personal** account may be allowed as
   well; Volet does not say either way. If you already have a verified
   personal account, look before you apply for anything: open **Payment
   Tools** in the dashboard (older menu: Profile > API, SDK > Manage SCI).
   If it lets you create a payment gateway, use it; the app works the same
   with either account type. If the option is missing, or Volet refuses the
   gateway at the compliance review (point 3), open a business account.
2. **Full verification.** The overview says: "To use custodial payment
   solutions, you need a verified Volet.com account." On timing, the
   verification page says: "Most verification checks are completed
   automatically through SumSub and typically take only a few minutes," and
   that some applications "may require additional review and take longer to
   process." Have the company documents and an ID for each director ready
   before you start.
3. **A compliance review of the new gateway.** The overview says: "New
   custodial payment gateways require a compliance review before activation.
   Approval is typically completed within a few hours." Volet e-mails you
   when the Hosted Checkout is approved; until then it cannot take live
   payments (section 3, step 5).

While you wait, enable two-factor authentication on the Volet account and
keep the recovery codes offline. Where that setting lives: **check in your
Volet account**.

---

## 3. Create the Hosted Checkout

Two menu paths are documented, because Volet renamed the feature. Field
names below come from
<https://volet.com/docs/guides/accept-payments/create-payment-gateway>
(the current dashboard) and from the SCI document
<https://volet.com/files/documents/volet-sci-v1.0-en.pdf> (older wording).

- Current dashboard: log in, open **Payment Tools**, and click **Create** in
  the **Hosted Checkout** section.
- SCI document: log in, open **Profile**, then **API, SDK**, click
  **Manage SCI**, then **Create**. The document adds: "Your SCI will not work
  properly if you do not follow these steps."

If your dashboard shows neither, look for the words "Hosted Checkout",
"SCI" or "payment gateway": **check in your Volet account**.

### Step 1: Payment methods

The current guide lists two methods to enable:

- **Volet.com users**: customers pay from their Volet.com account balance.
- **Crypto wallets**: customers pay in supported tokens from any crypto
  wallet.

Enable both unless you have a reason not to. For each method there is a
**Who pays fee** choice: **Merchant pays** takes the processing fee out of
the amount you receive, **Buyer pays** adds it to what the customer pays.
Either is fine for the app, which compares the order amount with the amount
Volet reports as funded to you; if a test payment is left pending with the
activity line described in section 6, try the other setting.

### Step 2: Settings

Under **Payment processing options**:

- **Use a digital signature in Hosted Checkout requests**: **ON**. Volet's
  guide recommends keeping it on in production. The app always signs its
  requests and rejects notifications without a valid hash, so with this off
  payments cannot be credited.
- **Accept underpayment**: off. **Accept overpayment**: off. The app only
  credits an order whose reported amount equals the price it asked for; a
  different amount is logged and left for you to settle by hand (section 6).

Under **Hosted Checkout configuration**:

- **Hosted Checkout name**: a short name, letters and digits, 50 characters
  at most (the SCI document's limit for `ac_sci_name`). Example:
  `blucloack`. This is `ADCAM_VOLET_SCI_NAME` and must match exactly,
  including capitalisation.
- **Website, mobile app, bot, or AI agent URL**: `https://blucloack.online`.
  Volet shows it to customers during payment.
- **Notification email**: optional; Volet sends transaction notifications
  there. Useful while testing.
- **Email displayed in Hosted Checkout**: the guide says this is reserved
  for future use; leave it.
- **Hosted Checkout password**: choose a long random string (a password
  manager can generate one of 32 or more characters) and store it there.
  This is `ADCAM_VOLET_SCI_SECRET`. It is never shown to customers. If Volet
  limits the characters it accepts: **check in your Volet account**.

Under **Status URLs configuration** (Volet's guide says these may be omitted
or set in the payment request form; the app sends per-order addresses with
every payment, so these act as the defaults):

- **Success URL**: `https://blucloack.online/app/plan`, request method
  **GET**.
- **Failed URL**: `https://blucloack.online/app/plan?cancelled=1`, request
  method **GET**.
- **Status URL**: `https://blucloack.online/api/v1/billing/volet/status`,
  request method **POST** (the app also accepts GET, but POST is what it is
  set up for).

Type them exactly, with `https`, and no trailing slash. The SCI document
limits each of the three addresses to 100 characters.

### Step 3: Appearance (optional)

The guide says you can add your logo and brand colours here, and that it can
be done later.

### Step 4: Save and wait for approval

Save the Hosted Checkout. Volet's guide says new gateways need administrator
approval before accepting live payments, that approval "typically takes a
few hours," and that you receive an e-mail when it is approved. You can put
the variables into Railway (section 4) meanwhile; just do not test until the
e-mail arrives. The guide also says: "You can update these settings at any
time after creating the gateway."

---

## 4. Put the variables into Railway

Railway layout and the other variables are described in
[RAILWAY.md](RAILWAY.md). These go on the **`api`** service, not on `web`.

1. Open your Railway project, click the **api** service, open **Variables**.
2. Click **New Variable** and add, one at a time:

   ```bash
   ADCAM_VOLET_ACCOUNT_EMAIL=<the e-mail of your Volet.com account>
   ADCAM_VOLET_SCI_NAME=<the Hosted Checkout name from section 3>
   ADCAM_VOLET_SCI_SECRET=<the Hosted Checkout password from section 3>
   ADCAM_PUBLIC_URL=https://blucloack.online
   ```

   No quotes, no spaces around `=`, no trailing slash on the URL. Paste the
   password into Railway only; never send it in chat, e-mail or a ticket. If
   it is ever exposed, change it in Volet and in Railway at the same time.
3. `ADCAM_PUBLIC_URL` is required for Volet and must be short. Without it
   the app cannot tell Volet where to send the status notification, so
   every Volet checkout stops with a message saying the link has no site
   address. Volet limits each address the app sends to 100 characters, and
   the longest one the app builds is
   `<ADCAM_PUBLIC_URL>/app/plan?order=<32-character order id>&cancelled=1`,
   which is the public URL plus 60 characters. So the public URL may be at
   most **40 characters** (`https://blucloack.online` is 24). With a longer
   one, every Volet checkout fails with a message saying the address is too
   long; use a shorter domain.
4. Railway stages variable changes and shows a **Deploy** button (sometimes
   a banner saying changes are pending). Click it. The exact wording depends
   on the Railway UI version: **check in your Railway dashboard**. Wait until
   the service shows as deployed.
5. Check it took: open `https://blucloack.online/app/plan` as a signed-in
   user. The plan cards show **Subscribe** buttons. If BTCPay is also set
   up, a **Pay with** choice appears above the cards (section 5).

Volet's payment page address (`https://account.volet.com/sci/`) is built
into the app; there is an optional `ADCAM_VOLET_SCI_URL` variable only for
the case where Volet publishes a new one.

One more optional variable, `ADCAM_VOLET_NOTIFY_IPS`, says which addresses
a status notification may come from. The app only acts on a notification
sent from one of the addresses Volet's SCI document lists as its senders,
`50.7.115.5`, `51.255.40.139` and `13.53.55.89`; that list is built in, so
normally there is nothing to set. Set the variable only if Volet announces
a new address (comma-separated addresses or ranges such as
`203.0.113.0/24`), or to an empty value to turn the check off and rely on
the hash alone (section 6 says when that is needed and what it costs).

---

## 5. Test with a small real payment

Do this before announcing anything, and only after Volet's approval e-mail
has arrived. There is no test mode, so use real money on the smallest item:
the cheapest plan, or, if the test account already has a plan, the smallest
top-up amount.

1. Sign in to `https://blucloack.online` as an ordinary (non-admin) test
   account.
2. Open `/app/plan`. If both BTCPay and Volet are set up, the page shows a
   small **Pay with** control above the plan cards with one button per
   method, labelled **Crypto wallet (BTCPay)** and **Volet**, the first one
   selected, and the note "Applies to plans and top-ups." Click **Volet**.
   With only Volet set up there is no control; Volet is used for every
   purchase.
3. Click **Subscribe** on the cheapest plan (or pick the smallest top-up).
   A page titled "Taking you to Volet…" appears for a moment and forwards
   you to Volet's payment page; if it does not move on by itself, click its
   **Continue to Volet** button. The page shows the amount, currency and plan
   in plain text.
4. Pay on Volet's page, from a Volet balance or a crypto wallet.
5. Volet sends you back to `https://blucloack.online/app/plan?order=...`.
   The page says "Waiting for your payment to be confirmed…" and polls for
   up to two minutes. When Volet's status notification reaches the app with
   status `COMPLETED`, you get a success message and the plan status, period
   end date and token balance update.
6. Also try the other way out: start a second purchase and cancel on Volet's
   page. You should land back on the plan page with the message "Payment
   cancelled — nothing was charged." and the order in the order history
   stays `pending` (it is reused if you try again within a short while, and
   closed as `expired` if Volet reports it cancelled).

What to check afterwards, in this order:

- **Volet dashboard**: the payment is listed with its order id and status.
  Where the transaction list lives in the dashboard and what the columns are
  called: **check in your Volet account**. The notification e-mail from
  section 3, if you set one, arrives too.
- **App admin panel** (`/admin`, see RAILWAY.md): **Users** > the test
  user's detail panel shows the subscription state, balances and the ledger
  entries for the payment; the orders list there shows the order with a
  **Volet** tag and status `paid`. The activity feed contains a line such as
  `Paid $37.5 for Starter period (Volet)`. **Overview** counts it in token
  revenue.
- **The user's own `/app/plan`**: the order appears in the order history
  with a muted **Volet** tag and status `paid`. BTCPay orders carry a
  **BTCPay** tag instead.

If the page still says it is waiting after two minutes, go to section 6.

---

## 6. Troubleshooting

The `api` service's deploy log on Railway has one line for every Volet
checkout (`Volet checkout started for order …`) and one for every status
notification the app receives: with the order id and the status Volet
reported (`Volet notification for order …: COMPLETED`) when it was
accepted, or `refused` / `ignored` with the reason when it was not. Open it
first.

**Subscribe answers "Payments are not set up yet."** No payment method is
complete. For Volet, all three of `ADCAM_VOLET_ACCOUNT_EMAIL`,
`ADCAM_VOLET_SCI_NAME` and `ADCAM_VOLET_SCI_SECRET` must be on the `api`
service, and the service must have redeployed since you added them.

**Subscribe answers "That payment method is not set up."** The browser asked
for a method whose variables are missing, usually because the page was open
while you changed variables. Reload the plan page.

**Checkout fails with a message about an address being too long.**
`ADCAM_PUBLIC_URL` is over 40 characters (section 4, step 3).

**Checkout fails with a message saying a link has no site address.**
`ADCAM_PUBLIC_URL` is not set on the `api` service (section 4, step 3).

**Volet's page shows an error instead of the payment form.** The signature
did not match, so one of `ADCAM_VOLET_ACCOUNT_EMAIL`, `ADCAM_VOLET_SCI_NAME`
or `ADCAM_VOLET_SCI_SECRET` differs from what is in Volet (check
capitalisation and trailing spaces), or the Hosted Checkout has not been
approved yet, or the currency the app sends is not one your Hosted Checkout
accepts. The exact text Volet shows: **check in your Volet account**.

**The notification was answered `401` ("Bad notification hash.")** The
app's `ADCAM_VOLET_SCI_SECRET` differs from the Hosted Checkout password in
Volet, or the **Use a digital signature** setting is off so Volet sent no
hash. Fix the password or the setting; the money is in your Volet account,
and the order can be settled by hand (below).

**The notification was answered `403` and the log says it was refused as
not one of Volet's addresses.** The notification did not come from one of
the sender addresses in Volet's SCI document, so the app did not act on it;
the log line shows the address it did come from. If that is a new address
Volet has announced, add it to `ADCAM_VOLET_NOTIFY_IPS` (section 4). If
another service sits between the internet and Railway (a CDN or a proxy of
your own), the app sees that service's address instead of Volet's: either
have it pass the sender's address on, or set `ADCAM_VOLET_NOTIFY_IPS` to an
empty value to turn the check off. With the check off, the hash is the only
protection, and the hash does not cover the status field, so leave the
check on when you can.

**The notification was answered `503`.** A Volet variable is missing on the
`api` service (or the deploy that adds it has not finished). The notification
reached the app, so the Status URL is right.

**The order stays `pending` and nothing is in the log.** The notification
never arrived. Check, in Volet, that the Status URL is exactly
`https://blucloack.online/api/v1/billing/volet/status` with method **POST**,
that the gateway is approved, and that the web domain is reachable from the
public internet. If you put a firewall or allow-list in front of the domain,
the SCI document lists the addresses Volet sends notifications from:
`50.7.115.5`, `51.255.40.139` and `13.53.55.89` (the same ones the app
accepts, section 4). Whether Volet retries a failed notification, and
whether its dashboard shows a delivery log: **check in your Volet account**.

**The order stays `pending` and the log shows the notification with status
`PENDING` or `PROCESS`.** Volet has told the app that the payment is on its
way but not finished (for example a crypto transfer waiting for
confirmations). Nothing is credited until a `COMPLETED` notification
arrives. Look at the transaction's status in Volet; if Volet shows it as
completed and no `COMPLETED` line appears in the log after a while, settle
by hand (below).

**The order stays `pending` and the log says the notification was ignored.**
The notification arrived with a valid hash, but its amount or currency did
not match the order, so the app did not credit it. The user's activity (admin
panel > Users > the user) shows a line like `Volet notification for order …
ignored: amount or currency differs`. Causes: the admin panel's currency
setting differs from the currency Volet settled in; the customer paid a
different amount (underpayment or overpayment accepted on the Volet side);
or, if Volet reports the amount after its fee, the **Who pays fee** setting.
Fix the setting for next time and settle this order by hand.

**The order shows `expired`.** Volet reported the payment as cancelled.
Nothing was charged; the customer can start again.

**Settling by hand.** When Volet shows the payment as completed but the
order is not `paid`, open the admin panel, **Users**, the customer, and in
the billing panel use **Grant period** (pick the plan and the number of
months) for a subscription, or the token adjustment for a top-up, putting
the Volet transaction id in the private notes. This creates a separate
granted order; the original Volet order stays listed as `pending`. If
Volet's notification for it arrives later (for example after you fix the
password or the Status URL), the app credits that order as well, so after
fixing the cause check the customer's ledger and take back a double credit
with a negative token adjustment or by changing the period end date. A
repeated notification for an order that is already `paid` is ignored.

---

## 7. Moving money out of Volet

Payments sit in your Volet account until you withdraw them. Volet's overview
(<https://volet.com/docs/guides/accept-payments/accept-payments-overview>)
lists three ways out:

- "Withdraw to a bank account via SWIFT, local bank transfers, FPS, CIPS,
  and other supported methods."
- "Withdraw to a debit or credit card."
- "Withdraw cryptocurrency to an external wallet."

It adds: "See Withdraw or send funds for available withdrawal methods." The
withdrawal screens themselves are not described on the pages read, so the
menu path is: **check in your Volet account** (look for "Withdraw" or
"Send"). The overview also says "Withdrawal fees depend on the payment method
used."

Fees as listed on <https://volet.com/business/fees> on 2026-10-30 (they
change; the page and your account are authoritative):

- Fiat withdrawals: SEPA "From 1%"; SWIFT, FPS, CIPS "1.5% + 25 USD"; local
  bank transfers "From 1%"; Visa, Mastercard "From 3%".
- Crypto withdrawals from crypto wallets: USDT TRC-20 "3.5 USDT"; USDT and
  USDC on other chains "0.5 USDT/USDC"; BTC, ETH and other coins "Network
  fee".
- Crypto withdrawals from fiat or stablecoin balances (auto-conversion):
  USDT TRC-20 "0.5% + 3.5 USD"; USDT and USDC on other chains "0.5% + 0.5
  USD"; BTC, ETH and other coins "Network fee".

Minimum amounts and limits are not on that page: **check in your Volet
account**.

Two habits worth keeping:

- When withdrawing crypto, pick the network that matches the receiving
  wallet (for example USDT on TRON to a TRON address starting with `T`). A
  transfer sent on the wrong network is lost.
- Withdraw on a schedule rather than letting a balance build up, and keep
  the withdrawal confirmations for your books together with the app's order
  history (the admin panel can export users and shows every order).

---

## Keep these somewhere safe

- The Volet account e-mail, password and two-factor recovery codes.
- The Hosted Checkout name and password (also visible in Volet and in
  Railway).
- The four Railway values.
- The receiving details you withdraw to (bank account, card, wallet
  address and network).

---

## Sources checked

- SCI technical document (request fields, signature and hash formulas,
  status notification fields and statuses, sender addresses, creation path
  via Profile > API, SDK > Manage SCI, the 20-store and 100-character
  limits): <https://volet.com/files/documents/volet-sci-v1.0-en.pdf>
- Account verification (account types, business levels, what verification
  unlocks, timing): <https://volet.com/docs/guides/overview/verification>
- Payment gateway overview (custodial vs non-custodial, payment methods,
  where funds land, compliance review, currencies, fees, withdrawals):
  <https://volet.com/docs/guides/accept-payments/accept-payments-overview>
- Creating a Hosted Checkout (Payment Tools path, field names, signature
  setting, status URLs, approval):
  <https://volet.com/docs/guides/accept-payments/create-payment-gateway>
- Business fees (payment tools, top-ups, withdrawals):
  <https://volet.com/business/fees>

The app-side behaviour described here (addresses, variables, messages,
what is credited and when) comes from this repository's billing code and
tests, not from Volet.
