/** Reusable broad-phase index. Numeric row/column keys avoid allocating coordinate strings. */
export class SpatialGrid<T> {
  private rows = new Map<number, Map<number, T[]>>();
  private active: T[][] = [];
  private size: number;
  constructor(size: number) {
    this.size = size;
  }

  reset(): void {
    for (const bucket of this.active) bucket.length = 0;
    this.active.length = 0;
  }

  insert(minX: number, minY: number, maxX: number, maxY: number, value: T): void {
    const left = Math.floor(minX / this.size),
      right = Math.floor(maxX / this.size);
    const bottom = Math.floor(minY / this.size),
      top = Math.floor(maxY / this.size);
    for (let y = bottom; y <= top; y++) {
      let row = this.rows.get(y);
      if (!row) {
        row = new Map();
        this.rows.set(y, row);
      }
      for (let x = left; x <= right; x++) {
        let bucket = row.get(x);
        if (!bucket) {
          bucket = [];
          row.set(x, bucket);
        }
        if (!bucket.length) this.active.push(bucket);
        bucket.push(value);
      }
    }
  }

  /** The caller owns the output, so simultaneous query results cannot overwrite one another. */
  query(minX: number, minY: number, maxX: number, maxY: number, output: Set<T>): Set<T> {
    output.clear();
    const left = Math.floor(minX / this.size),
      right = Math.floor(maxX / this.size);
    const bottom = Math.floor(minY / this.size),
      top = Math.floor(maxY / this.size);
    for (let y = bottom; y <= top; y++) {
      const row = this.rows.get(y);
      if (!row) continue;
      for (let x = left; x <= right; x++) {
        const bucket = row.get(x);
        if (bucket) for (const value of bucket) output.add(value);
      }
    }
    return output;
  }
}
