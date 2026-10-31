import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get('astro.locale')?.value;
  const locale: Locale = cookieLocale === 'en' ? 'en' : 'fr';
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
