import { Injectable } from '@nestjs/common';
import { Subject, merge, interval, map, of } from 'rxjs';
@Injectable()
export class OrderEvents {
  private readonly events = new Subject<{
    data: { kind: string; orderId: string; at: string };
  }>();
  publish(kind: string, orderId: string) {
    this.events.next({ data: { kind, orderId, at: new Date().toISOString() } });
  }
  stream() {
    return merge(
      of({ data: { kind: 'connected', at: new Date().toISOString() } }),
      this.events,
      interval(20000).pipe(
        map(() => ({
          data: { kind: 'heartbeat', at: new Date().toISOString() },
        })),
      ),
    );
  }
}
