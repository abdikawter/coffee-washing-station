import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List-page state lives in the URL query string (spec §4 FilterBar), so a filtered,
 * sorted page can be bookmarked, shared and survives a reload.
 *   ?status=APPROVED&from=2026-10-01&page=2&pageSize=25&sort=-createdAt
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();

  /** Value of one filter ('' when absent). */
  const get = useCallback((key: string) => params.get(key) ?? '', [params]);

  /** Set / clear filters; any filter change goes back to page 1. */
  const set = useCallback((patch: Record<string, string | null | undefined>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') next.delete(k); else next.set(k, v);
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  return { params, get, set };
}

export interface TableState {
  /** 0-based (DataGrid). */
  page: number;
  pageSize: number;
  /** API sort, e.g. `-createdAt`; undefined = server default. */
  sort?: string;
  setPage: (page: number, pageSize: number) => void;
  setSort: (sort: string | undefined) => void;
}

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Pagination + sort for a server-side DataTable, read from / written to the URL.
 * `apiParams` matches the API's `page` (1-based), `pageSize`, `sort` query params.
 */
export function useTableQuery({ defaultPageSize = 25 }: { defaultPageSize?: number } = {}) {
  const [params, setParams] = useSearchParams();
  const pageParam = Number(params.get('page'));
  const sizeParam = Number(params.get('pageSize'));
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam - 1 : 0;
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : defaultPageSize;
  const sort = params.get('sort') || undefined;

  const update = useCallback((patch: Record<string, string | undefined>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) next.delete(k); else next.set(k, v); }
      return next;
    }, { replace: true });
  }, [setParams]);

  const table: TableState = useMemo(() => ({
    page,
    pageSize,
    sort,
    setPage: (p, size) => update({
      page: p > 0 && size === pageSize ? String(p + 1) : undefined, // new page size → back to page 1
      pageSize: size === defaultPageSize ? undefined : String(size),
    }),
    setSort: (s) => update({ sort: s, page: undefined }),
  }), [page, pageSize, sort, update, defaultPageSize]);

  const apiParams = useMemo(() => ({ page: page + 1, pageSize, ...(sort && { sort }) }), [page, pageSize, sort]);
  return { table, apiParams };
}
