import { redirect } from 'next/navigation';

/**
 * Bare root. There is no shared landing surface — merchants and buyers enter
 * through distinct, white-labeled paths. Default to the merchant admin login;
 * buyers arrive via the Shopify App Proxy at `/catalog` (rewritten from
 * `/apps/wholesale/*`).
 */
export default function RootPage(): never {
  redirect('/merchant-login');
}
