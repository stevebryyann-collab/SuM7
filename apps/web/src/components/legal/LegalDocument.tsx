import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A single content block within a legal document. A `string` renders as a
 * paragraph; a `string[]` renders as a bulleted list. This keeps the Privacy
 * Policy and Terms of Service structurally identical so they read as one system
 * (the design-system consistency rule) while letting each supply its own copy.
 */
export type LegalBlock = string | string[];

export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocumentProps {
  title: string;
  /** ISO-ish display date, e.g. "July 8, 2026". */
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
  /** The other legal page to cross-link to in the footer. */
  crossLink: { href: string; label: string };
}

/**
 * Shared presentational shell for the public legal pages. Renders on the same
 * atmospheric glass surface as the rest of the app so the legal surface never
 * looks like it belongs to a different product. Fully static — safe to
 * pre-render, publicly reachable (not behind the merchant/buyer auth groups),
 * and index-able (each page opts back into indexing via its own metadata).
 */
export function LegalDocument({
  title,
  updated,
  intro,
  sections,
  crossLink,
}: LegalDocumentProps): JSX.Element {
  return (
    <article className="panel rounded-xl p-8 sm:p-10">
      <header className="mb-8 border-b border-border pb-6">
        <p className="text-label uppercase tracking-wider text-text-tertiary">
          Wholesale Portal
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-text-primary">
          {title}
        </h1>
        <p className="mt-2 text-sm text-text-tertiary">
          Last updated: {updated}
        </p>
      </header>

      <div className="space-y-4 text-[15px] leading-relaxed text-text-secondary">
        {intro}
      </div>

      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">
              {section.heading}
            </h2>
            {section.blocks.map((block, i) =>
              Array.isArray(block) ? (
                <ul
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  className="list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-text-secondary marker:text-text-tertiary"
                >
                  {block.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  className="text-[15px] leading-relaxed text-text-secondary"
                >
                  {block}
                </p>
              ),
            )}
          </section>
        ))}
      </div>

      <footer className="mt-10 border-t border-border pt-6 text-sm text-text-tertiary">
        <p>
          Questions about this document? Contact{" "}
          <a
            href="mailto:support@yourdomain.com"
            className="font-medium text-accent hover:underline"
          >
            support@yourdomain.com
          </a>
          .
        </p>
        <p className="mt-2">
          See also our{" "}
          <Link
            href={crossLink.href}
            className="font-medium text-accent hover:underline"
          >
            {crossLink.label}
          </Link>
          .
        </p>
      </footer>
    </article>
  );
}
