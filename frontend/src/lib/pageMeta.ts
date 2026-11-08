export interface PageMeta {
  last_page: number;
  from?: number;
  to?: number;
  total?: number;
}

type PageInfo = { last_page?: number; from?: number | null; to?: number | null; total?: number };

/**
 * The page info in a list response, for <Pagination>. Laravel's paginate()
 * puts last_page / from / to / total next to `data`; API resources (and
 * responses built in the app) put them under `meta`. Reading only `meta` from
 * a paginate() response finds nothing, so the list looks like a single page
 * and its later rows can't be reached.
 */
export function pageMeta(res: (PageInfo & { meta?: PageInfo | null }) | null | undefined): PageMeta | undefined {
  const info = res?.meta ?? res;
  if (info?.last_page == null) return undefined;
  return { last_page: info.last_page, from: info.from ?? undefined, to: info.to ?? undefined, total: info.total };
}
