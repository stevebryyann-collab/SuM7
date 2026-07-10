import type { ReactNode } from "react";

/**
 * Public legal route-group layout (/privacy, /terms). Deliberately outside the
 * (auth)/(merchant)/(buyer) groups: these pages carry NO identity provider and
 * must be reachable — and index-able — without a session, because the App Store
 * listing requires a public Privacy Policy URL. Same atmospheric glass chrome as
 * the rest of the app, widened for long-form reading.
 */
export default function LegalLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-12 sm:py-16">
      {children}
    </div>
  );
}
