import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

type ProductStockUpdate = {
  id: string;
  availableStock: number;
};

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000',
    credentials: true,
  },
})
@Injectable()
export class ReservationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ReservationsGateway.name);

  handleConnection(socket: Socket) {
    const userId = socket.handshake.query.userId as string | undefined;
    if (userId) {
      socket.join(`user:${userId}`);
      this.logger.debug(`Socket connected for user ${userId}`);
    } else {
      this.logger.debug(`Socket connected with no userId`);
    }
  }

  handleDisconnect(socket: Socket) {
    const userId = socket.handshake.query.userId as string | undefined;
    if (userId) {
      socket.leave(`user:${userId}`);
      this.logger.debug(`Socket disconnected for user ${userId}`);
    }
  }

  /**
   * Notify a specific user that their reservations have changed.
   */
  emitUserReservationsUpdated(userId: string) {
    this.server.to(`user:${userId}`).emit('reservations:updated');
  }

  /**
   * Broadcast stock changes for one or more products.
   * All connected clients will receive an array of { id, availableStock }.
   */
  emitProductsUpdated(updates: ProductStockUpdate[] | ProductStockUpdate) {
    const payload = Array.isArray(updates) ? updates : [updates];
    this.server.emit('products:updated', payload);
  }
}
