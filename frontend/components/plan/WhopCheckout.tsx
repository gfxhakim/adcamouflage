"use client";

/**
 * Whop checkout, mounted inline on our own plan page.
 *
 * It carries our own `orderId` as `metadata.order_id`, which Whop copies to the
 * payment and echoes back in the `payment.succeeded` webhook. The webhook — not
 * this component, and not the return URL — is what grants tokens / activates the
 * plan. `onComplete` here is for UI only (show a "confirming your payment"
 * state); never grant access from it.
 *
 * Flow on our side:
 *   1. POST /api/v1/billing/checkout { kind, plan_id | amount, provider: "whop" }
 *      -> { order_id, whop_plan }
 *   2. Render <WhopCheckout orderId=... planId=whop_plan />
 *   3. Customer pays -> Whop webhook settles the order server-side
 *   4. We poll GET /api/v1/billing/orders/{order_id} until status === "paid"
 *
 * Docs: https://docs.whop.com/developer/guides/embed-checkout
 */

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type WhopCheckoutProps = {
  /** Whop plan id (`plan_xxx`) returned by our checkout endpoint as `whop_plan`. */
  planId: string;
  /** Optional Whop CheckoutConfiguration id (`ch_xxx`) carrying redirect_url & metadata. */
  checkoutConfigId?: string | null;
  /** Buyer's ProteusFlow account email, prefilled in Whop checkout. */
  buyerEmail?: string;
  /** Our own order id, echoed back in the webhook metadata. */
  orderId: string;
  /** Where Whop sends the browser after off-site auth (3DS, etc.). Display only — not proof. */
  returnUrl: string;
  /** Optional: a Whop promo code to prefill when using base-plan promo fallback. */
  promoCode?: string;
  /** Extra metadata copied onto the Whop payment & webhook (coupon, affiliate channel, etc.). */
  metadata?: Record<string, string>;
  /** Called once when the embed reports completion so the host can close the embed immediately. */
  onComplete?: () => void;
};

type WhopMountable = {
  mount: (selectorOrElement: string | HTMLElement) => void;
  destroy?: () => void;
};

type WhopCheckoutController = {
  mount?: (selectorOrElement: string | HTMLElement) => void;
  create?: (elementName: "checkout", opts?: Record<string, unknown>) => WhopMountable;
  destroy?: () => void;
};

// The Whop Elements script, loaded once per page.
const WHOP_ELEMENTS_SRC = "https://cdn.whop.com/elements/amber/elements.js";

declare global {
  interface Window {
    WhopElements?: () => {
      checkout: {
        create: (opts: {
          plan?: string;
          checkoutConfiguration?: string;
          metadata?: Record<string, string>;
          returnUrl?: string;
          promoCode?: string;
          onComplete?: (completion: unknown) => void;
        }) => WhopCheckoutController;
      };
    };
  }
}

function loadElementsScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.WhopElements) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${WHOP_ELEMENTS_SRC}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      const onLoad = () => {
        existing.dataset.loaded = "1";
        resolve();
      };
      const onError = () => reject(new Error("Whop Elements failed to load"));
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", onError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = WHOP_ELEMENTS_SRC;
    script.async = true;
    script.setAttribute("data-whop-elements", "");
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "1";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error("Whop Elements failed to load")), { once: true });
    document.head.appendChild(script);
  });
}

export default function WhopCheckout({
  planId,
  checkoutConfigId,
  buyerEmail,
  orderId,
  returnUrl,
  promoCode,
  metadata,
  onComplete,
}: WhopCheckoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const metadataJson = JSON.stringify(metadata ?? {});

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    let cancelled = false;
    let completed = false;
    let controller: WhopCheckoutController | null = null;
    let element: WhopMountable | null = null;

    setReady(false);
    setLoadError(null);

    const handleComplete = () => {
      if (cancelled || completed) return;
      completed = true;
      // Destroy the Whop controller & child iframe synchronously right when payment completes
      // so Whop's built-in "claim / open a Whop account" view or delayed _top navigation cannot run.
      try {
        element?.destroy?.();
      } catch {
        /* ignore teardown errors */
      }
      try {
        controller?.destroy?.();
      } catch {
        /* ignore teardown errors */
      }
      if (container) container.innerHTML = "";
      onCompleteRef.current?.();
    };

    loadElementsScript()
      .then(() => {
        if (cancelled || completed || !window.WhopElements || !container) return;

        let extraMeta: Record<string, string> = {};
        try {
          extraMeta = JSON.parse(metadataJson) as Record<string, string>;
        } catch {
          extraMeta = {};
        }

        container.innerHTML = "";
        controller = window.WhopElements().checkout.create({
          ...(checkoutConfigId ? { checkoutConfiguration: checkoutConfigId } : { plan: planId }),
          metadata: { ...extraMeta, order_id: orderId },
          returnUrl,
          ...(promoCode ? { promoCode } : {}),
          onComplete: handleComplete,
        });

        // Current amber `elements.js` exposes `.create("checkout")` returning the
        // mountable child element; fall back to `.mount(...)` if a direct handle is returned.
        const target =
          typeof controller.mount === "function"
            ? (controller as WhopMountable)
            : controller.create?.("checkout", buyerEmail ? { buyerEmail } : undefined);

        if (!target || typeof target.mount !== "function") {
          throw new Error("Whop checkout element handle could not be created");
        }

        element = target;
        target.mount(container);
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Whop checkout could not start:", err);
        if (!cancelled && !completed) {
          setLoadError("Could not load Whop checkout. Please check your connection or disable script blockers and try again.");
        }
      });

    return () => {
      cancelled = true;
      try {
        element?.destroy?.();
      } catch {
        /* ignore teardown errors */
      }
      try {
        controller?.destroy?.();
      } catch {
        /* ignore teardown errors */
      }
      if (container) container.innerHTML = "";
    };
  }, [planId, checkoutConfigId, buyerEmail, orderId, returnUrl, promoCode, metadataJson]);

  return (
    <div className="min-h-[280px]">
      {!ready && !loadError ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin text-meta-500" aria-hidden />
          Loading secure Whop checkout…
        </div>
      ) : null}
      {loadError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700" role="alert">
          {loadError}
        </p>
      ) : null}
      <div id={`whop-checkout-${orderId}`} ref={containerRef} />
    </div>
  );
}
