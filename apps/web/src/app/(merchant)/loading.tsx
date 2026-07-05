import { PageContainer } from '@/components/merchant/PageLayout';
import { PageHeaderSkeleton, LoadingSkeleton } from '@/components/shared/LoadingSkeleton';

/**
 * Merchant route-group loading fallback. Rendered by the App Router as the
 * Suspense boundary while a merchant page streams. Matches the standard page
 * shape (title/subtitle header + a glass table surface) so the sidebar chrome
 * stays put and the layout does not shift when real content resolves — the
 * Apple-Weather skeleton treatment, never a spinner (CLAUDE.md → Loading States).
 */
export default function MerchantLoading(): JSX.Element {
  return (
    <PageContainer>
      <div className="mb-6">
        <PageHeaderSkeleton />
      </div>
      <div className="panel overflow-hidden p-2">
        <LoadingSkeleton rows={8} />
      </div>
    </PageContainer>
  );
}
