import { Injectable } from '@nestjs/common';
import { Subject, merge, interval, map, of, filter } from 'rxjs';
@Injectable()
export class OrderEvents {
  private readonly events = new Subject<{
    branchId: string;
    data: { kind: string; orderId: string; at: string };
  }>();
  publish(branchId: string, kind: string, orderId: string) {
    this.events.next({
      branchId,
      data: { kind, orderId, at: new Date().toISOString() },
    });
  }
  stream(branchId: string) {
    return merge(
      of({ data: { kind: 'connected', at: new Date().toISOString() } }),
      this.events.pipe(
        filter((e) => e.branchId === branchId),
        map((e) => e),
      ),
      interval(20000).pipe(
        map(() => ({
          data: { kind: 'heartbeat', at: new Date().toISOString() },
        })),
      ),
    );
  }
}
