// An in-memory collection for unit tests. It knows the filter and update
// operators the sign-in code uses. Each call runs to its end before it
// returns, like one database write, so parallel calls interleave only at
// their awaits.
import { Types } from 'mongoose'

export type Row = Record<string, any>

export const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? new Date(a as any).getTime() === new Date(b as any).getTime()
    : String(a) === String(b)

export function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Row[]).some((part) => matches(row, part))
    if (key === '$and') return (condition as Row[]).every((part) => matches(row, part))
    const value = row[key]
    const isOperator =
      condition &&
      typeof condition === 'object' &&
      !(condition instanceof Date) &&
      !(condition instanceof Types.ObjectId) &&
      Object.keys(condition).some((name) => name.startsWith('$'))
    if (!isOperator) {
      if (condition === null) return value === null || value === undefined
      return value !== undefined && sameValue(value, condition)
    }
    return Object.entries(condition).every(([op, arg]: [string, any]) => {
      switch (op) {
        case '$exists':
          return arg ? value !== undefined : value === undefined
        case '$ne':
          return value === undefined || !sameValue(value, arg)
        case '$in':
          return (arg as unknown[]).some((entry) => sameValue(value, entry))
        case '$gt':
          return value !== undefined && value !== null && value > arg
        case '$gte':
          return value !== undefined && value !== null && value >= arg
        case '$lt':
          return value !== undefined && value !== null && value < arg
        case '$lte':
          return value !== undefined && value !== null && value <= arg
        default:
          throw new Error(`operator ${op} not supported`)
      }
    })
  })
}

function applyUpdate(row: Row, update: Row, inserting: boolean) {
  const ops = Object.keys(update).some((key) => key.startsWith('$')) ? update : { $set: update }
  for (const [key, value] of Object.entries(ops.$set ?? {})) row[key] = value
  for (const [key, value] of Object.entries(ops.$inc ?? {})) row[key] = (row[key] ?? 0) + value
  for (const key of Object.keys(ops.$unset ?? {})) delete row[key]
  if (inserting) for (const [key, value] of Object.entries(ops.$setOnInsert ?? {})) row[key] = value
  row.updatedAt = new Date()
}

class Query<T> implements PromiseLike<T> {
  constructor(private readonly run: () => T) {}
  lean() {
    return Promise.resolve(this.run())
  }
  exec() {
    return Promise.resolve(this.run())
  }
  then<A, B>(ok?: (value: T) => A | PromiseLike<A>, ko?: (reason: any) => B | PromiseLike<B>) {
    return Promise.resolve(this.run()).then(ok, ko)
  }
}

export class InMemoryModel {
  rows: Row[] = []
  constructor(private readonly unique: string[] = []) {}

  private copy = (row: Row | undefined) => (row ? { ...row } : null)

  seed(...rows: Row[]) {
    for (const row of rows) {
      this.rows.push({ _id: new Types.ObjectId(), createdAt: new Date(), ...row })
    }
    return this.rows[this.rows.length - 1]
  }

  async create(doc: Row) {
    for (const field of this.unique) {
      if (this.rows.some((row) => doc[field] !== undefined && row[field] === doc[field])) {
        throw Object.assign(new Error(`E11000 duplicate key ${field}_1`), {
          code: 11000,
          keyPattern: { [field]: 1 },
        })
      }
    }
    const row = { _id: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(), ...doc }
    this.rows.push(row)
    return { ...row }
  }

  findOne(filter: Row) {
    return new Query(() => this.copy(this.rows.find((row) => matches(row, filter))))
  }

  findById(id: unknown) {
    return this.findOne({ _id: id })
  }

  find(filter: Row) {
    return new Query(() => this.rows.filter((row) => matches(row, filter)).map((row) => ({ ...row })))
  }

  findOneAndUpdate(filter: Row, update: Row, options: Row = {}) {
    return new Query(() => {
      const row = this.rows.find((entry) => matches(entry, filter))
      if (!row) return null
      const before = { ...row }
      applyUpdate(row, update, false)
      return options.returnDocument === 'after' ? { ...row } : before
    })
  }

  updateOne(filter: Row, update: Row, options: Row = {}) {
    return new Query(() => {
      const row = this.rows.find((entry) => matches(entry, filter))
      if (row) {
        applyUpdate(row, update, false)
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
      }
      if (options.upsert) {
        const created: Row = { createdAt: new Date() }
        for (const [key, value] of Object.entries(filter)) {
          if (!key.startsWith('$')) created[key] = value
        }
        applyUpdate(created, update, true)
        this.rows.push(created)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    })
  }

  findByIdAndUpdate(id: unknown, update: Row, options: Row = {}) {
    return this.findOneAndUpdate({ _id: id }, update, options)
  }

  updateMany(filter: Row, update: Row) {
    return new Query(() => {
      const rows = this.rows.filter((entry) => matches(entry, filter))
      for (const row of rows) applyUpdate(row, update, false)
      return { matchedCount: rows.length, modifiedCount: rows.length }
    })
  }

  async countDocuments(filter: Row) {
    return this.rows.filter((row) => matches(row, filter)).length
  }

  async distinct(field: string, filter: Row) {
    return [...new Set(this.rows.filter((row) => matches(row, filter)).map((row) => row[field]))]
  }

  async exists(filter: Row) {
    const row = this.rows.find((entry) => matches(entry, filter))
    return row ? { _id: row._id } : null
  }
}
