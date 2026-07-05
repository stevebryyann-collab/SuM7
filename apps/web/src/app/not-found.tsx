import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

/** Root 404 page. Kept auth-agnostic since it serves both portals. */
export default function NotFound(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <FileQuestion className="h-5 w-5 text-gray-500" aria-hidden />
        </div>
        <h1 className="text-base font-semibold text-gray-900">Page not found</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-5">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Go to home
          </Link>
        </div>
      </div>
    </div>
  );
}
