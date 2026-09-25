import type pg from 'pg';
import { NotFoundError } from '../../common/errors.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { camelize, withTransaction } from '../../db/pool.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';

export const DEPARTMENTS = ['PROCUREMENT', 'QUALITY', 'PRODUCTION', 'DRYING', 'WAREHOUSE', 'FINANCE', 'PAYROLL', 'MAINTENANCE', 'MANAGEMENT'] as const;

export interface EmployeeView {
  id: string;
  employeeNo: string;
  fullName: string;
  position: string;
  department: (typeof DEPARTMENTS)[number];
  phone: string | null;
  userId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SORT = { employeeNo: 'employee_no', fullName: 'full_name', department: 'department', createdAt: 'created_at' };

/** Permanent staff (ARCHITECTURE.md §20 assumptions); optionally linked to a login. */
export class EmployeesService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
  ) {}

  async list(q: PageQuery & { department?: string; active?: boolean; search?: string }): Promise<{ data: EmployeeView[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.department) { args.push(q.department); where.push(`department = $${args.length}`); }
    if (q.active !== undefined) { args.push(q.active); where.push(`is_active = $${args.length}`); }
    if (q.search) { args.push(`%${q.search.toLowerCase()}%`); where.push(`(lower(full_name) LIKE $${args.length} OR lower(employee_no) LIKE $${args.length})`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`SELECT * FROM employees ${w} ORDER BY ${orderBy(q.sort, SORT)}, id LIMIT ${limit} OFFSET ${offset}`, args),
      this.pool.query(`SELECT count(*)::int AS n FROM employees ${w}`, args),
    ]);
    return { data: rows.rows.map((r) => camelize<EmployeeView>(r)), total: count.rows[0].n };
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool): Promise<EmployeeView> {
    const { rows } = await db.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundError('Employee', id);
    return camelize<EmployeeView>(rows[0]);
  }

  async create(actor: AuthUser, input: Omit<EmployeeView, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>, meta: RequestMeta): Promise<EmployeeView> {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO employees (employee_no, full_name, position, department, phone, user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [input.employeeNo.trim(), input.fullName.trim(), input.position.trim(), input.department, input.phone ?? null, input.userId ?? null],
      );
      const created = camelize<EmployeeView>(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'users', entityType: 'Employee', entityId: created.id, newValue: created, meta });
      return created;
    });
  }

  async update(actor: AuthUser, id: string, input: Partial<Omit<EmployeeView, 'id' | 'createdAt' | 'updatedAt' | 'employeeNo'>>, meta: RequestMeta): Promise<EmployeeView> {
    return withTransaction(this.pool, async (tx) => {
      const before = await this.get(id, tx);
      const next = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as EmployeeView;
      const { rows } = await tx.query(
        `UPDATE employees SET full_name = $2, position = $3, department = $4, phone = $5, user_id = $6, is_active = $7
          WHERE id = $1 RETURNING *`,
        [id, next.fullName, next.position, next.department, next.phone, next.userId, next.isActive],
      );
      const after = camelize<EmployeeView>(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'UPDATE', module: 'users', entityType: 'Employee', entityId: id, previousValue: before, newValue: after, meta });
      return after;
    });
  }
}
