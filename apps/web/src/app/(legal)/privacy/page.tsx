import type { Metadata } from "next";
import {
  LegalDocument,
  type LegalSection,
} from "@/components/legal/LegalDocument";

// The public Privacy Policy URL is mandatory for the Shopify App Store listing,
// so this page MUST be crawlable — override the root layout's global no-index.
export const metadata: Metadata = {
  title: "Privacy Policy — Wholesale Portal",
  description:
    "How Wholesale Portal collects, uses, protects, and shares personal data for Shopify merchants and their wholesale buyers.",
  robots: { index: true, follow: true },
};

const UPDATED = "July 8, 2026";

const sections: LegalSection[] = [
  {
    heading: "1. Who we are and our role",
    blocks: [
      'Wholesale Portal ("the App", "we", "us") is a Shopify-embedded B2B wholesale operating system provided by [Company Legal Name], [address]. We provide the App to Shopify merchants ("Merchants") and process personal data on their behalf.',
      'For personal data belonging to a Merchant’s wholesale buyers ("Buyers") — such as buyer accounts, orders, and invoices — the Merchant is the data controller and we act as a data processor. For account, billing, and support data that we collect directly from Merchants, we act as a controller.',
    ],
  },
  {
    heading: "2. Data we collect",
    blocks: [
      "From Merchants (via Shopify OAuth on install): your myshopify.com domain, store owner email, and a Shopify Admin API access token, which we store encrypted at rest. We request the minimum scopes needed to operate: read_products, read_orders, write_orders, and read_customers.",
      "From the Shopify store (via the Admin API and webhooks): product and inventory data, orders, fulfillments, and customer records needed to power wholesale pricing, bulk ordering, invoicing, and accounts receivable.",
      "From Buyers (via the wholesale portal): email address, company name, business type, tax identifier, phone number, and shipping/billing addresses. Tax identifiers and phone numbers are encrypted at rest with per-field key versioning.",
      "Automatically: authentication session data, audit logs of changes to financial records, and diagnostic/error telemetry. Sensitive values are masked before logging.",
    ],
  },
  {
    heading: "3. How we use data",
    blocks: [
      "We process personal data only to provide and secure the App, including to:",
      [
        "Authenticate Merchants (Shopify OAuth) and Buyers (via our identity provider) and enforce per-Merchant, per-Buyer access controls.",
        "Synchronize catalog, pricing, inventory, orders, and fulfillments between Shopify and the wholesale portal.",
        "Generate invoices, track accounts receivable, and — where enabled — facilitate Buy-Now-Pay-Later applications through our BNPL provider.",
        "Send transactional email (e.g. invoices, approvals, shipping updates).",
        "Bill Merchants for their subscription and usage, and maintain security, audit, and fraud-prevention records.",
      ],
      "We do not sell personal data, and we do not use Buyer data for advertising.",
    ],
  },
  {
    heading: "4. Legal bases (GDPR/UK GDPR)",
    blocks: [
      "Where the GDPR applies and we act as controller, we rely on: performance of a contract (providing the App and billing), our legitimate interests (securing the service, preventing fraud, and improving reliability), and compliance with legal obligations (e.g. retaining financial records). Where we act as processor for a Merchant, that Merchant is responsible for the lawful basis of its Buyer data.",
    ],
  },
  {
    heading: "5. Subprocessors and sharing",
    blocks: [
      "We share data with vetted infrastructure and service providers strictly to run the App. Current categories and providers include:",
      [
        "Application & database hosting: Vercel, Railway, Supabase (PostgreSQL).",
        "File storage: Amazon Web Services (S3, encrypted with SSE-KMS).",
        "Buyer authentication: Clerk.",
        "Email delivery: Resend.",
        "Merchant billing (Merchant of Record): Paddle.",
        "BNPL financing: Resolve (US).",
        "Platform: Shopify.",
        "Observability & error monitoring: Sentry, Grafana Cloud, Better Stack.",
      ],
      "We do not otherwise disclose personal data except to comply with law, enforce our agreements, or protect rights and safety.",
    ],
  },
  {
    heading: "6. International transfers",
    blocks: [
      "Our providers may process data in the United States and other countries. Where required, transfers out of the EEA/UK are covered by appropriate safeguards such as Standard Contractual Clauses.",
    ],
  },
  {
    heading: "7. Data retention",
    blocks: [
      "We retain personal data for as long as the App is installed and as needed to provide the service. Financial records (orders, invoices, and related accounting data) are retained for up to seven (7) years to meet tax and accounting obligations, even after account or Buyer deletion, as permitted by Shopify’s data-protection requirements. Audit logs are immutable and retained for security and compliance.",
    ],
  },
  {
    heading: "8. Your rights and Shopify privacy webhooks",
    blocks: [
      "Depending on your location, you may have rights to access, correct, delete, export, or restrict processing of your personal data, and to object or withdraw consent. Buyers should direct these requests to the Merchant they transact with; we assist Merchants in fulfilling them.",
      "We implement Shopify’s mandatory privacy webhooks: customers/data_request (we make the requested data available to the Merchant), customers/redact (we anonymize Buyer personal data where no other active Merchant relationship legally requires its retention), and shop/redact (we purge shop data following uninstall, retaining only records we are legally obligated to keep).",
    ],
  },
  {
    heading: "9. Security",
    blocks: [
      "We protect data with encryption in transit (TLS) and at rest, application-level field encryption (AES-256-GCM) for sensitive identifiers, PostgreSQL Row-Level Security for tenant isolation, scoped access tokens, and least-privilege access. No system is perfectly secure, but we work to protect your data using industry-standard controls.",
    ],
  },
  {
    heading: "10. Children",
    blocks: [
      "The App is a business-to-business product and is not directed to children. We do not knowingly collect personal data from anyone under 16.",
    ],
  },
  {
    heading: "11. Changes and contact",
    blocks: [
      'We may update this policy; material changes will be reflected by the "Last updated" date above. For privacy questions or to exercise your rights, contact us at support@yourdomain.com or [Data Protection Contact / DPO, address].',
    ],
  },
];

export default function PrivacyPolicyPage(): JSX.Element {
  return (
    <LegalDocument
      title="Privacy Policy"
      updated={UPDATED}
      crossLink={{ href: "/terms", label: "Terms of Service" }}
      intro={
        <>
          <p className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning">
            Template notice: complete the bracketed placeholders (legal entity,
            addresses, contacts) and have this reviewed by counsel before
            publishing. It is drafted to reflect how the App actually processes
            data, but it is not legal advice.
          </p>
          <p>
            This Privacy Policy explains how Wholesale Portal collects, uses,
            protects, and shares personal data when Shopify merchants install
            the App and when their wholesale buyers use the portal.
          </p>
        </>
      }
      sections={sections}
    />
  );
}
