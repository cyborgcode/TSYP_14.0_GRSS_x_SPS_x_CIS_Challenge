import type { PagePath } from './SiteNav';

export const pageHref = (path: PagePath): string =>
  path === '/' ? '/' : `/pages.html?page=${path.slice(1)}`;
