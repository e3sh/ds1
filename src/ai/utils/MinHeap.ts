/**
 * 挿入順タイブレーク付き Binary Min-Heap。
 * 同一コストの要素は挿入順（FIFO）で取り出されることを保証する。
 */
export class CostMinHeap<T> {
  private items: T[] = [];
  private costs: number[] = [];
  private seqs: number[] = [];
  private nextSeq: number = 0;

  public get length(): number {
    return this.items.length;
  }

  public peekCost(): number {
    return this.costs[0];
  }

  public clear(): void {
    this.items.length = 0;
    this.costs.length = 0;
    this.seqs.length = 0;
    this.nextSeq = 0;
  }

  public push(item: T, cost: number): void {
    const idx = this.items.length;
    this.items.push(item);
    this.costs.push(cost);
    this.seqs.push(this.nextSeq++);
    this.siftUp(idx);
  }

  public pop(): T | undefined {
    const len = this.items.length;
    if (len === 0) return undefined;

    const top = this.items[0];
    if (len === 1) {
      this.items.pop();
      this.costs.pop();
      this.seqs.pop();
      return top;
    }

    this.items[0] = this.items.pop()!;
    this.costs[0] = this.costs.pop()!;
    this.seqs[0] = this.seqs.pop()!;
    this.siftDown(0);
    return top;
  }

  private isHigherPriority(a: number, b: number): boolean {
    const ca = this.costs[a];
    const cb = this.costs[b];
    if (ca !== cb) return ca < cb;
    return this.seqs[a] < this.seqs[b];
  }

  private swap(i: number, j: number): void {
    const tmpItem = this.items[i];
    this.items[i] = this.items[j];
    this.items[j] = tmpItem;

    const tmpCost = this.costs[i];
    this.costs[i] = this.costs[j];
    this.costs[j] = tmpCost;

    const tmpSeq = this.seqs[i];
    this.seqs[i] = this.seqs[j];
    this.seqs[j] = tmpSeq;
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (!this.isHigherPriority(idx, parent)) break;
      this.swap(idx, parent);
      idx = parent;
    }
  }

  private siftDown(idx: number): void {
    const len = this.items.length;
    while (true) {
      const left = (idx << 1) + 1;
      if (left >= len) break;
      const right = left + 1;
      let best = left;
      if (right < len && this.isHigherPriority(right, left)) {
        best = right;
      }
      if (!this.isHigherPriority(best, idx)) break;
      this.swap(idx, best);
      idx = best;
    }
  }
}
