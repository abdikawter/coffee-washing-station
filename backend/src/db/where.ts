/**
 * Builds a parameterised WHERE clause for list endpoints. Each condition uses
 * `?` for its single value, which becomes the next `$n` placeholder.
 *   const w = new Where().add('status = ?', q.status).addIf(q.search, 'name ILIKE ?', `%${q.search}%`);
 *   pool.query(`SELECT … ${w.sql} …`, w.args)
 */
export class Where {
  readonly args: unknown[] = [];
  private readonly parts: string[] = [];

  add(condition: string, value?: unknown): this {
    if (condition.includes('?')) {
      this.args.push(value);
      this.parts.push(condition.replaceAll('?', `$${this.args.length}`));
    } else {
      this.parts.push(condition);
    }
    return this;
  }

  /** Adds the condition only when `value` is not undefined / empty string. */
  addIf(value: unknown, condition: string, bound: unknown = value): this {
    return value === undefined || value === '' ? this : this.add(condition, bound);
  }

  get sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}
