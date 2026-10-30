# Taking payments with BTCPay Server

This is a click-by-click guide for setting up your own BTCPay Server and
connecting it to this app. BTCPay Server is free, open-source payment software
that you run on a small rented server. Customers pay in Bitcoin (and, if you
install the plugin, in USDT on TRON) straight into a wallet only you control.
There is no company in the middle and no monthly fee other than the server.

Plan on one afternoon for the setup, then a wait of one to several days while
the Bitcoin node downloads the blockchain before the first real payment can
settle.

Everything here was checked against the official BTCPay documentation and the
BTCPay source code on 2026-10-30. Where a screen could not be verified, the
step says **check in your BTCPay version**. BTCPay changes its screens from
release to release, so if a button is not where this guide says, look for the
same words nearby.

## What the app needs from you

When you are done you will paste five values into Railway, on the `api`
service (see step 9):

| Variable | What it is | Example |
| --- | --- | --- |
| `ADCAM_BTCPAY_URL` | The address of your BTCPay Server, no trailing slash | `https://pay.blucloack.online` |
| `ADCAM_BTCPAY_STORE_ID` | The ID of the store you create in BTCPay (step 3) | `6HSHAEU4iYWtjxtyRs9KyPjM9GAQp8kw2T9VWbGG1FnZ` |
| `ADCAM_BTCPAY_API_KEY` | The API key you generate in BTCPay (step 7) | a long random string |
| `ADCAM_BTCPAY_WEBHOOK_SECRET` | The secret of the webhook you create in BTCPay (step 8) | a long random string |
| `ADCAM_PUBLIC_URL` | The public address of this app, where customers are sent back after paying | `https://blucloack.online` |

The app talks to BTCPay in two directions:

- **App to BTCPay**: when a customer clicks Subscribe, the app asks BTCPay to
  create an invoice (using the URL, store ID and API key) and sends the
  customer to BTCPay's checkout page.
- **BTCPay to app**: when the invoice is paid, BTCPay calls the app's webhook at
  `https://blucloack.online/api/v1/billing/btcpay/webhook`. The public web
  domain forwards everything under `/api` to the private `api` service on
  Railway, so BTCPay only ever needs to reach `blucloack.online`. The app checks
  the webhook secret before trusting the call.

Until all of the first four variables are set, the app answers every purchase
attempt with "Payments are not set up yet." and the plan page shows
"Payments are being set up". That is expected; nothing is broken.

## Words you will meet

- **xpub** (extended public key): a long string starting with `xpub`, `ypub`
  or `zpub` that lets BTCPay generate fresh receiving addresses for your
  wallet. It can only *watch* and *receive*; it cannot spend. Your seed words
  and private keys never leave your wallet.
- **Store**: BTCPay can run several shops on one server. You need one store.
- **API key**: a password-like string that lets the app create invoices in
  your store, and nothing else.
- **Webhook**: BTCPay sending a message to the app's address when something
  happens to an invoice.
- **TRON RPC provider**: a service that lets the USDT plugin read the TRON
  blockchain (explained in step 6).

---

## 1. Choose where BTCPay runs

BTCPay's own comparison of hosting options is at
<https://docs.btcpayserver.org/Deployment/>. There are two sensible choices for
a non-technical founder.

### Option A: LunaNode one-click (recommended if you do not want a terminal)

LunaNode is a VPS provider with a web wizard that installs BTCPay for you.
The official page is <https://docs.btcpayserver.org/Deployment/LunaNode/>.

- Cost: the LunaNode page says "around US$15.80 per month", which includes a
  Bitcoin full node and a Lightning node. The deployment comparison table lists
  LunaNode at about $10/month; the exact figure depends on the plan you pick in
  the wizard.
- You can use a domain LunaNode generates for you, or your own (for example
  `pay.blucloack.online`).

Steps, quoted from the LunaNode page:

1. Register at LunaNode and add credits. "Note that you need to wait for the
   invoice confirmation."
2. In your LunaNode account, open the API section and create an API key. Keep
   that page open; you need the **API Key** and **API ID**.
3. Go to <https://launchbtcpay.lunanode.com>.
4. Paste the API Key and API ID and continue.
5. "Use your own domain or automatically-generated one by LunaNode." If you
   use your own, create the DNS record first (see "Domain and DNS" below), then
   type the exact name here.
6. "Customize the web-wizard settings according to your needs." The wizard
   lets you pick a plan size and whether to include Lightning (the Lightning
   setup page says web installs "let you pick the implementation from a
   drop-down"). The exact field names in the wizard could not be verified from
   the docs: **check in your BTCPay version**. If unsure, keep the defaults.
7. "Click Launch VM. Wait 6-7 minutes for Virtual Machine deployment."
8. "Visit the domain, create an account and log in." (Continue with step 2 of
   this guide.)

The Bitcoin node then downloads the blockchain. The page says: "Depending on
the plan you used and the number of coins you added, that can take 1-7 days."
There is an optional "US$ 3 one-time charge" to enable more CPU and finish in
1-2 days. A sync pop-up in BTCPay disappears when the node is ready.

### Option B: Docker on any Ubuntu VPS (needs a terminal, more choice of host)

This is BTCPay's recommended production method: "the official Docker
deployment is the recommended installation method"
(<https://docs.btcpayserver.org/Operators/>). Installation page:
<https://docs.btcpayserver.org/Docker/installation/>.

Server size, from <https://docs.btcpayserver.org/Docker/specs/> for a
Bitcoin-only pruned node:

- 2 virtual CPU cores, 4 GB RAM, at least 50 GB SSD (more is better).
- "a low-cost VPS around or below $20 USD per month can usually satisfy this
  profile."
- Any provider with plain Ubuntu/Debian works (Hetzner, DigitalOcean, Vultr,
  Linode and the like). Pick a plan you can upgrade later.

Steps:

1. Rent the server, choose a recent Ubuntu LTS image, and note its public IP.
2. Create the DNS record for your BTCPay domain (see "Domain and DNS" below)
   and wait until it resolves.
3. Log in over SSH (your provider shows how) and run the install commands from
   the official README at
   <https://github.com/btcpayserver/btcpayserver-docker#install-a-bitcoin-deployment>,
   replacing the hostname with yours:

   ```bash
   sudo su -
   mkdir BTCPayServer
   cd BTCPayServer
   git clone https://github.com/btcpayserver/btcpayserver-docker
   cd btcpayserver-docker

   export BTCPAY_HOST="pay.blucloack.online"
   export NBITCOIN_NETWORK="mainnet"
   export BTCPAYGEN_CRYPTO1="btc"
   export BTCPAYGEN_LIGHTNING="none"
   export BTCPAYGEN_REVERSEPROXY="nginx"
   export BTCPAYGEN_ADDITIONAL_FRAGMENTS="opt-save-storage-xs"
   export LETSENCRYPT_EMAIL="you@example.com"
   . ./btcpay-setup.sh -i
   ```

   Notes from the docs: the last line must start with a dot and a space
   ("The script must be sourced with `. ./btcpay-setup.sh`"). `LETSENCRYPT_EMAIL`
   is optional and only used for certificate-expiry e-mails
   (<https://docs.btcpayserver.org/Docker/networking/>). `opt-save-storage-xs`
   keeps about 25 GB of blocks instead of the full chain. If you want
   Lightning later, see step 5.
4. The script installs Docker, generates the stack, starts it and registers a
   system service so BTCPay comes back after a reboot
   (<https://docs.btcpayserver.org/Docker/installation/>).
5. Open `https://pay.blucloack.online` in a browser. The docs say: "The site
   can open before Bitcoin Core and NBXplorer finish synchronizing. Check the
   synchronization status in BTCPay Server before accepting payments."

### Domain and DNS (both options)

- Decide the name, for example `pay.blucloack.online`.
- In your DNS provider (wherever `blucloack.online` is managed), add an
  **A record**: name `pay`, value = the server's public IPv4 address. The
  networking docs say: "Point the DNS records for `BTCPAY_HOST` at the server"
  and "Allow incoming TCP traffic on ports 80 and 443"; "Port 80 must be
  reachable for the default ACME HTTP challenge"
  (<https://docs.btcpayserver.org/Docker/networking/>). HTTPS certificates are
  issued automatically once DNS points at the server.
- Do not put the BTCPay subdomain behind a proxy that hides the server (for
  example an orange-cloud Cloudflare record) unless you know what you are
  doing; a plain DNS record is simplest.

---

## 2. First login and the admin account

Source: <https://docs.btcpayserver.org/Docker/installation/> and
<https://docs.btcpayserver.org/Users/>.

1. Open your BTCPay address in a browser.
2. Click **Register**. "Select Register, enter your email address and
   password, and submit the form."
3. The docs state: "The first registered account becomes the server
   administrator." Use an e-mail you control and a long password; store it in
   a password manager.
4. Once logged in, open the account menu at the top right and enable
   two-factor authentication, as the user guide recommends. Keep the recovery
   codes offline.
5. Optional but wise: after you have your admin account, stop strangers from
   registering. In the top-right menu open **Server Settings** and look for
   the policies page (the FAQ refers to "Server Settings > Policies"); there
   is a setting to disable new registrations. Exact label: **check in your
   BTCPay version**.

---

## 3. Create the store

Source: <https://docs.btcpayserver.org/Users/> ("Create a Store"); screen
titles verified in the BTCPay source
(`BTCPayServer/Views/UIUserStores/CreateStore.cshtml`).

1. After first login BTCPay shows a page titled **Create a new store** ("Create
   a store to begin accepting payments."). If it does not, use the store
   switcher at the top of the left sidebar and choose to create a store.
2. Fill in:
   - **Store Name**: anything, for example `BluCloacking`.
   - **Default currency**: `USD`. The app always creates invoices in USD.
   - Price source: keep the default unless you have a reason to change it.
3. Click **Create Store**.
4. Find the **Store ID**. Open **Settings** in the left sidebar (the store's
   general settings page). Next to the store name there is a copy button
   labelled "Copy store ID" and a QR button labelled "Show store ID QR"
   (`BTCPayServer/Views/UIStores/GeneralSettings.cshtml`). The ID is also in
   every store page address: `https://pay.blucloack.online/stores/<STORE_ID>/...`.
5. Save it; it is `ADCAM_BTCPAY_STORE_ID`.

---

## 4. Connect your Bitcoin wallet with an xpub (never a private key)

The store needs to know *where* to receive money. Give it an **xpub**, not
seed words. With an xpub, BTCPay can create addresses and see payments but can
never spend; even if the server is hacked, the money is safe in your wallet.

Which wallet: use a hardware wallet (Trezor, Ledger, BitBox, Coldcard and
others; BTCPay's supported list is linked from
<https://docs.btcpayserver.org/HardwareWalletIntegration/>) or a mobile wallet
that can show its xpub. The BTCPay import screen names BlueWallet, Cobo Vault,
Passport and Specter DIY as wallets whose QR codes it can read. Create the
wallet on the device, write the seed words on paper, and never type them into
any website, including BTCPay.

Screens below were verified in the BTCPay source
(`BTCPayServer/Plugins/Wallets/Views/UIStoreOnChainWallets/...`). The user guide
section is at <https://docs.btcpayserver.org/Users/> ("Set Up a Wallet").

1. In the left sidebar, under **Wallets**, click **Bitcoin**. A store with no
   wallet opens the setup page titled **Let's get started**.
2. Choose **Connect an existing wallet** ("Import an existing hardware or
   software wallet"). Do not choose **Create a new wallet**: that would make
   the server generate keys, which is less safe.
3. On **Choose your import method**, pick one:
   - **Connect hardware wallet** (marked "Recommended"): "Import your public
     keys using our Vault application". You must install and run BTCPay Server
     Vault on your computer, plug in the device, select the address type and
     confirm. Guide: <https://docs.btcpayserver.org/HardwareWalletIntegration/>.
   - **Enter extended public key**: "Input the key string manually". Use this
     with a mobile wallet. In the wallet app find "Export xpub" or "Wallet
     details" (names vary per app), copy the key, and paste it into the field
     **Extended public key** on the page **Enter your extended public key**.
     The page explains: "This key, also called "xpub", is used to generate
     individual destination addresses for your invoices." Choose the
     **Address type** that matches your wallet (modern wallets use a key
     starting with `zpub`, which is Segwit) and click **Continue**.
   - **Scan wallet QR code**: point your webcam at the xpub QR shown by the
     wallet.
   - **Import wallet file**: upload a file exported from a desktop wallet.
   - **Enter wallet seed** is marked "Not recommended". BTCPay itself warns:
     "You really should not type your seed into a device that is connected to
     the internet." Skip it.
4. On **Confirm addresses**, BTCPay shows a few addresses and says: "Please
   check that your wallet is generating the same addresses as below." Open
   your wallet's receive screen and compare at least the first address
   character by character. If they match, click **Confirm**. If they do not,
   go back and pick a different address type.
5. Done. The Bitcoin wallet now shows a balance of 0 and you can receive.

Two notes:

- You do not need to set a key path or sign anything in BTCPay; that is only
  for spending from inside BTCPay, which you will do from your own wallet
  instead.
- Keep the wallet you used; every payment lands there.

---

## 5. Lightning (optional, can be skipped)

Lightning gives instant, cheap Bitcoin payments but comes with real
operational burden: a Lightning node is a **hot wallet** on the server, it
needs **inbound liquidity** before anyone can pay you, and it has its own
backup rules. The docs say: "Using the Lightning Network can put your money at
risk. Do not use more than you can afford to lose."
(<https://docs.btcpayserver.org/LightningNetwork-Setup/>). You can add it
later; on-chain Bitcoin plus USDT is enough to launch.

If you want it:

1. The node has to exist on the server.
   - LunaNode: pick a Lightning implementation in the launch wizard.
   - Docker: re-run setup with
     `export BTCPAYGEN_LIGHTNING="clightning"` then `. ./btcpay-setup.sh -i`
     from the `btcpayserver-docker` folder. The FAQ recommends Core Lightning
     because "the implementation supports pruned nodes"
     (<https://docs.btcpayserver.org/FAQ/LightningNetwork/>). `lnd` is the
     other common value.
2. Wait for the Bitcoin node to be fully synced ("your blockchain needs to be
   fully synced").
3. In the store sidebar open **Lightning** (page titled **Connect to a
   Lightning node**), choose **Use internal node** and click **Save**. You
   should see "BTC Lightning node updated". Check that the node shows as
   "Online" under Public Node Info.
4. Get inbound capacity: "As a merchant using lightning, having inbound
   capacity is essential for customers to be able to pay you." See the FAQ
   above for how (channel services, friends opening channels to you).
5. Back up the Lightning seed and, for LND, the `channel.backup` file
   (<https://docs.btcpayserver.org/Docker/backup-restore/>).

---

## 6. Accept USDT on TRON (Tether USDt plugin)

Many customers prefer paying in USDT (Tether) on the TRON network because it
is cheap and the amount does not move. BTCPay supports it through the
**Tether USDt** plugin.

Facts from the plugin's directory page
<https://plugin-builder.btcpayserver.org/public/plugins/tether-usdt> (checked
2026-10-30): name "Tether USDt", author `btcpayserver-tether`, description
"Accept USD₮ with BTCPayServer on TRON, Ethereum or Polygon", version 0.7.10,
requires BTCPay Server 2.4.7 or newer. Source and README:
<https://github.com/btcpayserver-tether/BTCPayServer.Plugins.USDt>.

### 6a. What a TRON RPC provider is, and why you need one

Bitcoin payments are seen by the Bitcoin node running on your server. There is
no TRON node on your server, so the plugin has to ask an outside service to
read the TRON blockchain for it. That service is a **TRON RPC provider**; you
get an address (an "endpoint") and usually an API key from it.

The plugin README is blunt about the free default: "The default public TRON
node is provided for demonstration and testing only. It is not suitable for
production because its availability and rate limits are outside your control
and may delay payment detection." For production it says to "use a private
TRON node or a dedicated, authenticated RPC provider" and "Configure its
JSON-RPC endpoint in the plugin's TRON server settings. Providers that use
TronGrid authentication can be configured with the `TRON-PRO-API-KEY` header
in the same settings."

Providers:

- **TronGrid** (run by the TRON Foundation): endpoint `https://api.trongrid.io`,
  free with an API key; without a key "requests are aggressively rate-limited"
  (<https://chainstack.com/learn/how-to/how-to-get-tron-rpc-endpoint-stablecoin-2026/>).
  Getting a key (steps from a third-party guide, so verify on the site):
  register at <https://www.trongrid.io/register>, confirm your e-mail, log in,
  click **API Keys** in the left menu, click **Create API Key**, give it a
  name and click **Create**, then click **Check** next to the key and copy it
  (<https://support.lamassu.is/hc/en-us/articles/25551365327373-Setting-up-TronGrid>).
- **Chainstack**, **GetBlock** and similar: paid providers with free tiers (the
  Chainstack article above lists a free plan with a monthly request cap). They
  give you your own endpoint URL from their dashboard.

Start with TronGrid plus an API key; move to a paid plan only if payments are
detected slowly.

### 6b. Install the plugin

Source: <https://docs.btcpayserver.org/Plugins/>. "Only a server administrator
can install plugins", and "Install plugins only from sources you trust."

1. Click the **Plugins** icon in the top-right menu and select
   **Plugin Directory**.
2. Search for `Tether USDt` and open it. Check the author
   (`btcpayserver-tether`) and that your BTCPay version is at least 2.4.7
   (your version is shown at the bottom of BTCPay's pages and under Server
   Settings).
3. Click **Install** and confirm in the dialog.
4. Click **Restart now** in the notice at the top of the page. BTCPay is
   unavailable for a minute.
5. After the restart open **Plugins** > **Installed Plugins** and confirm the
   plugin is listed. (The plugin README describes the same path with older
   wording: "Settings > Plugin > Available Plugins, and restart.")

### 6c. Configure TRON and the receiving wallet

The README does not document the exact screens, so these two steps are
**check in your BTCPay version**:

1. Server-level settings: look in **Server Settings** for a USDt or TRON
   section. Enter your provider's JSON-RPC endpoint (for TronGrid,
   `https://api.trongrid.io`) and, if the provider gave you a key, the
   `TRON-PRO-API-KEY` value. Save.
2. Store-level wallet: after the plugin is active, the store's **Wallets**
   list gains a USDT on TRON entry (the plugin calls the payment method
   `USDT-TRON`). Open it and set it up. The README's requirement is "A
   compatible wallet for each chain you want to use (e.g., Ledger, MetaMask,
   TrustWallet...) to generate and manage addresses for receiving USDt
   payments." As with Bitcoin, give it only public information (an xpub or
   receiving addresses), never a seed or private key. Make sure the address
   is a **TRON** address (starts with `T`), not an Ethereum one; USDT on TRON
   and USDT on Ethereum are different networks and a wrong network loses
   money.

How settlement works, from the README: the plugin watches the chain, credits
full, partial or overpaid amounts, and keeps watching an invoice's address
after it expires until the store's monitoring period ends; late payments get
BTCPay's `PaidLate` status, which the app does not treat as paid, so you would
handle those by hand (see step 10).

Once both Bitcoin and USDT are enabled, every invoice the app creates offers
both; the customer picks on the checkout page.

---

## 7. Create the API key for the app

Source: <https://docs.btcpayserver.org/Developers/api/authentication/>
("Users can create keys under Account > Manage account > API keys") and the
BTCPay source (`BTCPayServer/Views/UIManage/APIKeys.cshtml`,
`AddApiKey.cshtml`). Permission names and their on-screen labels come from
BTCPay's API description (`swagger.template.json`).

1. Click your account (top-right menu) and choose **Manage account**.
2. Open the **API Keys** tab.
3. Click **Generate Key**. The page **Generate API Key** opens ("Generate a
   new api key to use BTCPay through its API.").
4. **Label**: `adcamouflage-api` (anything that reminds you what it is for).
5. Under **Permissions**, tick exactly these two:
   - **Create an invoice** (`btcpay.store.cancreateinvoice`)
   - **View invoices** (`btcpay.store.canviewinvoices`)

   For each one click **Select specific stores** and choose your store. That
   way the key works only for this store. Leave every other permission
   unticked. The docs warn that an empty permission list does not mean "no
   access": "Omitting permissions when creating a key can produce
   unrestricted access, so do not rely on an empty list to mean no access."
6. Click **Generate API Key**.
7. Back on the API keys list, use **Reveal** next to your key and copy the
   whole string. This is `ADCAM_BTCPAY_API_KEY`. Treat it like a password.

If the key is ever exposed, come back here, **Delete** it, generate a new one
and update Railway (step 9).

---

## 8. Create the webhook

Source: screen labels verified in the BTCPay source
(`BTCPayServer/Plugins/Webhooks/Views/Webhooks.cshtml` and
`ModifyWebhook.cshtml`); signature format from the Greenfield API reference
<https://docs.btcpayserver.org/API/Greenfield/v1/> (Webhooks section):
"BTCPay Server includes the `BTCPay-Sig` HTTP header, whose format is
`sha256=HMAC256(UTF8(webhook's secret), body)`".

1. In the store's left sidebar open **Settings**, then **Webhooks** ("Webhooks
   allow BTCPay Server to send HTTP events related to your store to another
   server.").
2. Click **Create Webhook**. The page **Add Webhook** opens.
3. Fill in:
   - **Payload URL**: `https://blucloack.online/api/v1/billing/btcpay/webhook`
     (exactly this, with `https`, no trailing slash).
   - **Secret**: BTCPay fills in a random secret. Click the eye icon to show
     it and copy it. This is `ADCAM_BTCPAY_WEBHOOK_SECRET`. If you prefer your
     own, paste a long random string here and use the same one in Railway.
   - **Enabled**: on.
   - **Automatic redelivery**: on ("We will try to redeliver any failed
     delivery after 10 seconds, 1 minute and up to 6 times after 10 minutes").
   - **Events** ("Which events would you like to trigger this webhook?"):
     either leave **Send me everything**, or choose **Send specific events**
     and tick **Invoice - Is Settled** (this is the `InvoiceSettled` event the
     app acts on). If you pick specific events, also tick **Invoice - Expired**
     and **Invoice - Became Invalid** so unpaid orders are marked as such in
     the app. Everything else is ignored by the app and answered with 200.
4. Click **Add Webhook**.

The webhook page keeps a **Recent deliveries** list; you will use it in step 10.

---

## 9. Put the five variables into Railway

Railway layout and the other variables are described in
[RAILWAY.md](RAILWAY.md). These go on the **`api`** service, not on `web`.

1. Open your Railway project, click the **api** service, open **Variables**.
2. Click **New Variable** and add, one at a time:

   ```bash
   ADCAM_BTCPAY_URL=https://pay.blucloack.online
   ADCAM_BTCPAY_STORE_ID=<store ID from step 3>
   ADCAM_BTCPAY_API_KEY=<API key from step 7>
   ADCAM_BTCPAY_WEBHOOK_SECRET=<webhook secret from step 8>
   ADCAM_PUBLIC_URL=https://blucloack.online
   ```

   No quotes, no spaces around `=`, no trailing slashes on the URLs. If your
   BTCPay domain is different, use that; it must be `https` and reachable from
   the public internet, because Railway calls it.
3. Railway stages variable changes and shows a **Deploy** button (sometimes a
   banner saying changes are pending). Click it. The exact wording depends on
   the Railway UI version: **check in your Railway dashboard**. Wait until the
   service shows as deployed.
4. Check it took: open `https://blucloack.online/app/plan` as a signed-in
   user. The plan cards now show **Subscribe** buttons instead of "Payments
   are being set up".

If the buttons still say payments are being set up, one of the first three
variables is missing or on the wrong service. If clicking Subscribe shows an
error instead of opening BTCPay, the URL, store ID or API key is wrong
(the app logs the BTCPay response in the `api` service's deploy log).

---

## 10. Test with a small real payment

Do this before announcing anything. Bitcoin on-chain payments cannot settle
until the Bitcoin node on your server has finished syncing (step 1), so if you
installed USDT, test that first; it does not depend on the sync.

### 10a. Test inside BTCPay alone

Source: <https://docs.btcpayserver.org/Users/> ("Receive a First Payment":
"Create a small manual invoice, pay it from a separate wallet, and confirm
detection") and <https://docs.btcpayserver.org/Users/invoices/>.

1. In the store sidebar open **Payments** > **Invoices** and create an invoice
   for `1` USD.
2. Open the checkout link and pay it from a different wallet or exchange
   account (not the one whose xpub you imported).
3. Watch the invoice's status on the Invoices page. Meanings, from the
   invoices page: **New** = "awaiting full payment", **Processing** = "paid in
   full but is waiting for the payment method's settlement conditions",
   **Settled** = "paid and its settlement conditions were met", **Expired** =
   "expired before it was paid in full". Bitcoin on-chain moves to Settled
   after the confirmations your store requires (minutes to an hour); USDT and
   Lightning are faster.
4. Confirm the money shows up in your own wallet. If it does not, the xpub or
   address you imported is wrong; fix step 4 before going further.

### 10b. Test the whole flow through the app

1. Sign in to `https://blucloack.online` as an ordinary (non-admin) test
   account.
2. Open `/app/plan` and click **Subscribe** on the cheapest plan (or, if the
   account already has a plan, use the smallest top-up amount).
3. You land on BTCPay's checkout page. Pay it.
4. BTCPay sends you back to `https://blucloack.online/app/plan?order=...`
   automatically. The page polls for up to two minutes; when BTCPay settles the
   invoice you get a success message and the plan status, period end date and
   token balance update.

What to watch, in this order, if something does not happen:

- **BTCPay > Payments > Invoices**: the invoice exists (the app created it)
  and its status. Each invoice's details page shows its metadata, including
  the app's `orderId`.
- **BTCPay > Settings > Webhooks > your webhook > Recent deliveries**: a
  delivery for the settled invoice with a `200` response. A red or non-200
  delivery means the app rejected it: check the Payload URL and that the
  secret in Railway matches exactly (a `401` means the signature did not
  match). BTCPay retries automatically; you can also redeliver from the
  delivery row.
- **App admin panel** (`/admin`, see RAILWAY.md): **Overview** shows token
  revenue (30 days) and active subscriptions; **Users** > the test user's
  detail panel shows the subscription state, balances and the ledger entries
  for the payment. The user's own `/app/plan` lists the order in its order
  history with status `paid`.
- **Missed webhook fallback**: if the webhook never arrives, the app still
  checks the invoice with BTCPay when the user opens `/app/plan?order=...`,
  so a settled invoice is applied as soon as the customer returns. A broken
  webhook therefore delays, rather than loses, the credit; fix it anyway.

Manual cases: if an invoice is paid **late** (after its 60-minute window),
BTCPay marks it expired and "paid late"; open the invoice in BTCPay and use
**Mark as settled** once the money is really there, and BTCPay then sends the
settled event so the app credits the order once, exactly as quoted. A
**partial** payment is never credited automatically: decide with the customer,
and use the admin panel's user detail to grant a period or add tokens by hand,
or refund them from your wallet.

---

## 11. Backups and updates

### Backups

What matters most is already safe: your money is in the wallet whose xpub you
imported, and the wallet's seed words are on paper. A BTCPay backup protects
the invoice history, store settings, API keys and webhooks, and, if you run
Lightning, the Lightning wallet.

Official procedure, <https://docs.btcpayserver.org/Docker/backup-restore/>
(applies to LunaNode installs too, since they use the same Docker stack):

```bash
sudo su -
cd "$BTCPAY_BASE_DIRECTORY/btcpayserver-docker"
./btcpay-backup.sh
```

The archive is written to
`/var/lib/docker/volumes/backup_datadir/_data/backup.tar.gz` and "Each run
replaces the same local file." The script "does not provide retention or an
off-host copy", so copy the file off the server (for example with `scp` to
your computer or to cloud storage). To encrypt it, set a passphrase first:

```bash
read -s -p "Enter passphrase: " BTCPAY_BACKUP_PASSPHRASE
export BTCPAY_BACKUP_PASSPHRASE
./btcpay-backup.sh
```

Included: Docker volumes, generated secrets, database dumps, and for LND the
wallet and `channel.backup`. Excluded: the blockchain itself (it can be
re-downloaded). If you use Lightning, also keep "a separate, off-site copy of
LND's `channel.backup` and the wallet seed and any required passphrases".
The page gives a cron example that runs the backup nightly; pair it with a
scheduled copy off the server.

Restore is `./btcpay-restore.sh /path/to/backup.tar.gz` on a freshly installed
server; see the page for the Lightning caveats.

### Updates

BTCPay publishes security fixes that sometimes require updating quickly, so
check for updates monthly and when the BTCPay blog
(<https://blog.btcpayserver.org>) announces one.

- Terminal method, <https://docs.btcpayserver.org/Docker/updating/>: make a
  backup first, read the release notes, then

  ```bash
  sudo su -
  btcpay-update.sh
  ```

- Web method: in the top-right menu open **Server Settings** >
  **Maintenance**. The page describes itself as "Change your server domain,
  restart services, clean up Docker images, and update BTCPay Server."
  (`BTCPayServer/Plugins/Maintenance/Views/Maintenance.cshtml`). The update
  button's exact label: **check in your BTCPay version**.
- Plugins: after a BTCPay update open **Plugins** > **Installed Plugins** and
  update the Tether USDt plugin if a newer version is offered; restart when
  asked.
- After any update, create one small invoice (10a) to confirm payments still
  work, and glance at the webhook's recent deliveries after the next real
  payment.

### Keep these somewhere safe

- BTCPay admin e-mail, password and 2FA recovery codes.
- The five Railway values (also visible in Railway).
- Your wallet seed words (paper, never a file).
- The server provider login and the SSH password or key.
- The TronGrid (or other provider) login.

---

## Sources checked

- Deployment options and costs: <https://docs.btcpayserver.org/Deployment/>
- LunaNode: <https://docs.btcpayserver.org/Deployment/LunaNode/>
- Docker install commands: <https://github.com/btcpayserver/btcpayserver-docker#install-a-bitcoin-deployment>
- Docker installation, specs, networking, operations, updating, backup:
  <https://docs.btcpayserver.org/Docker/installation/>,
  <https://docs.btcpayserver.org/Docker/specs/>,
  <https://docs.btcpayserver.org/Docker/networking/>,
  <https://docs.btcpayserver.org/Docker/configuration/>,
  <https://docs.btcpayserver.org/Docker/updating/>,
  <https://docs.btcpayserver.org/Docker/backup-restore/>
- Account, store, wallet, first payment: <https://docs.btcpayserver.org/Users/>
- Invoice statuses: <https://docs.btcpayserver.org/Users/invoices/>
- Hardware wallets: <https://docs.btcpayserver.org/HardwareWalletIntegration/>
- Lightning: <https://docs.btcpayserver.org/LightningNetwork-Setup/>,
  <https://docs.btcpayserver.org/FAQ/LightningNetwork/>
- Plugins: <https://docs.btcpayserver.org/Plugins/>,
  <https://plugin-builder.btcpayserver.org/public/plugins/tether-usdt>,
  <https://github.com/btcpayserver-tether/BTCPayServer.Plugins.USDt>
- API keys and permissions: <https://docs.btcpayserver.org/Developers/api/authentication/>,
  <https://docs.btcpayserver.org/Developers/api/examples/>,
  <https://docs.btcpayserver.org/API/Greenfield/v1/>
- TRON providers: <https://chainstack.com/learn/how-to/how-to-get-tron-rpc-endpoint-stablecoin-2026/>,
  <https://support.lamassu.is/hc/en-us/articles/25551365327373-Setting-up-TronGrid>
- Exact button and field labels: BTCPay Server source code, `master` branch,
  read on 2026-10-30 (`BTCPayServer/Plugins/Webhooks/Views/`,
  `BTCPayServer/Plugins/Wallets/Views/UIStoreOnChainWallets/`,
  `BTCPayServer/Views/UIManage/`, `BTCPayServer/Views/UIStores/GeneralSettings.cshtml`,
  `BTCPayServer/Views/UIStores/SetupLightningNode.cshtml`).

The older documentation addresses given in some tutorials
(`/CreateStore/`, `/WalletSetup/`, `/Notifications/`,
`/Development/GreenFieldExample/`, `/Walkthrough/`) now redirect to the pages
above.
