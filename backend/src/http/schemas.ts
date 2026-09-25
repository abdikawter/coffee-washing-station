import { z } from 'zod';

/** Shared request/response schemas (ARCHITECTURE.md §8 conventions). */

export const uuidParam = z.object({ id: z.uuid() }).strict();

export const errorEnvelope = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    timestamp: z.string(),
    path: z.string(),
    requestId: z.string().nullable(),
  })
  .meta({ id: 'Error', description: 'Uniform error envelope' });

export const pageMeta = z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() });

export function single<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema });
}
export function list<T extends z.ZodType>(schema: T) {
  return z.object({ data: z.array(schema), meta: pageMeta });
}

/**
 * ?page=1&pageSize=25&sort=-createdAt — `sort` is whitelisted per endpoint.
 * Filters are plain query keys defined by each endpoint (Express 5 does not
 * parse bracket syntax such as filter[status] by default).
 */
export function pagination<const S extends readonly [string, ...string[]]>(sortable: S, defaultSort: `${'' | '-'}${S[number]}`) {
  const sortValues = sortable.flatMap((s) => [s, `-${s}`]) as [string, ...string[]];
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(sortValues).default(defaultSort),
  });
}

export interface PageQuery {
  page: number;
  pageSize: number;
  sort: string;
}

/** Turns "-createdAt" into "created_at DESC" using an explicit column map (never raw input). */
export function orderBy(sort: string, columns: Record<string, string>): string {
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  const col = columns[key];
  if (!col) throw new Error(`unsortable column ${key}`);
  return `${col} ${desc ? 'DESC' : 'ASC'}`;
}

export function pageClause(q: PageQuery): { limit: number; offset: number } {
  return { limit: q.pageSize, offset: (q.page - 1) * q.pageSize };
}

/** Query-string boolean. */
export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const isoDateTime = z.iso.datetime({ offset: true });
export const businessDateString = z.iso.date();
