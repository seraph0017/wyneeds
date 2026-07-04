import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BookingRequest, OrderRecord } from '../src/domain/types';
import { calculateChangeFee, calculateRefund } from '../src/domain/pricing';
import { createOrder } from '../src/domain/ticketing';

export class OrderStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<OrderRecord[]> {
    return this.read();
  }

  async get(id: string): Promise<OrderRecord | undefined> {
    return (await this.read()).find((order) => order.id === id || order.orderNo === id);
  }

  async create(request: BookingRequest): Promise<OrderRecord> {
    return this.enqueue(async () => {
      const orders = await this.read();
      const order = createOrder(request);
      orders.unshift(order);
      await this.write(orders);
      return order;
    });
  }

  async cancel(id: string): Promise<OrderRecord | undefined> {
    return this.update(id, (order) => ({ ...order, status: '已取消', updatedAt: new Date().toISOString() }));
  }

  async refund(id: string, afterDeparture: boolean): Promise<OrderRecord | undefined> {
    return this.update(id, (order) => {
      const refund = calculateRefund({ cabinClass: order.cabinClass, paidAmount: order.totalAmount, afterDeparture });
      return { ...order, status: '已退票', refund: { ...refund, afterDeparture, at: new Date().toISOString() }, updatedAt: new Date().toISOString() };
    });
  }

  async change(id: string, targetFlightId: string, fareDifference: number, sameCabin = true): Promise<OrderRecord | undefined> {
    return this.update(id, (order) => {
      const fee = calculateChangeFee({ cabinClass: order.cabinClass, paidAmount: order.totalAmount, sameCabin });
      return { ...order, flightId: targetFlightId, status: '已改签', change: { targetFlightId, fareDifference, fee, at: new Date().toISOString() }, updatedAt: new Date().toISOString() };
    });
  }

  private async update(id: string, updater: (order: OrderRecord) => OrderRecord): Promise<OrderRecord | undefined> {
    return this.enqueue(async () => {
      const orders = await this.read();
      const index = orders.findIndex((order) => order.id === id || order.orderNo === id);
      if (index < 0) return undefined;
      const updated = updater(orders[index]);
      orders[index] = updated;
      await this.write(orders);
      return updated;
    });
  }

  private async read(): Promise<OrderRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as OrderRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') return [];
      throw error;
    }
  }

  private async write(orders: OrderRecord[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(orders, null, 2), 'utf-8');
    await rename(tempPath, this.filePath);
  }
}

export function resolveDataFile(customDir?: string): string {
  const dataDir = customDir ?? process.env.CA_TICKETING_DATA_DIR ?? path.resolve(process.cwd(), '.local-data');
  return path.join(dataDir, 'orders.json');
}
