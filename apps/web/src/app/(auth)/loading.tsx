import { SkeletonBar } from '@/components/shared/LoadingSkeleton';

/**
 * Auth route-group loading fallback. Rendered inside the centered auth column
 * while a sign-in / sign-up page streams. Mirrors the glass sign-in card shape
 * (title + two fields + action) so the transition into Clerk / NextAuth UI is
 * calm rather than a flash.
 */
export default function AuthLoading(): JSX.Element {
  return (
    <div className="panel p-8">
      <SkeletonBar className="mx-auto h-6 w-40" />
      <SkeletonBar className="mx-auto mt-2 h-3.5 w-52" />
      <div className="mt-8 space-y-4">
        <SkeletonBar className="h-10 w-full" />
        <SkeletonBar className="h-10 w-full" />
        <SkeletonBar className="mt-2 h-10 w-full" />
      </div>
    </div>
  );
}
