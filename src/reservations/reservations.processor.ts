// import { Processor, Process } from '@nestjs/bull';
// import bull from 'bull';
// import { Injectable, Logger } from '@nestjs/common';
// import { DataSource } from 'typeorm';

// import { Reservation, ReservationStatus } from './reservation.entity';
// import { Product } from '../products/product.entity';

// @Processor('reservations')
// @Injectable()
// export class ReservationsProcessor {
//   private readonly logger = new Logger(ReservationsProcessor.name);

//   constructor(private readonly dataSource: DataSource) {}

//   @Process('expire-reservation')
//   async handleExpiration(job: bull.Job<{ reservationId: string }>) {
//     const { reservationId } = job.data;

//     await this.dataSource.transaction(async (manager) => {
//       const reservationRepo = manager.getRepository(Reservation);
//       const productRepo = manager.getRepository(Product);

//       const reservation = await reservationRepo
//         .createQueryBuilder('r')
//         .setLock('pessimistic_write')
//         .where('r.id = :id', { id: reservationId })
//         .getOne();

//       if (!reservation) {
//         this.logger.warn(`Reservation ${reservationId} not found`);
//         return;
//       }

//       if (reservation.status !== ReservationStatus.ACTIVE) return;

//       const now = new Date();
//       if (reservation.expiresAt > now) {
//         // Running early; you could requeue if needed.
//         return;
//       }

//       const product = await productRepo.findOneBy({
//         id: reservation.productId,
//       });
//       if (!product) return;

//       product.availableStock += reservation.quantity;
//       reservation.status = ReservationStatus.EXPIRED;

//       await productRepo.save(product);
//       await reservationRepo.save(reservation);
//     });
//   }
// }

// backend/src/reservations/reservations.processor.ts
import { Process, Processor } from '@nestjs/bull';
import bull from 'bull';
import { Logger } from '@nestjs/common';
import { ReservationsService } from './reservations.service';

@Processor('reservations')
export class ReservationsProcessor {
  private readonly logger = new Logger(ReservationsProcessor.name);

  constructor(private readonly reservationsService: ReservationsService) {}

  /**
   * Background job handler for expiring reservations.
   *
   * Job data: { reservationId: string }
   *
   * This delegates to ReservationsService.expireReservation,
   * which:
   *  - updates DB
   *  - restores stock
   *  - emits websocket events:
   *      - emitUserReservationsUpdated(userId)
   *      - emitProductsUpdated({ id, availableStock })
   */
  @Process('expire-reservation')
  async handleExpireReservation(job: bull.Job<{ reservationId: string }>) {
    const { reservationId } = job.data;

    this.logger.debug(
      `Processing expire-reservation job for reservation ${reservationId}`,
    );

    const result =
      await this.reservationsService.expireReservation(reservationId);

    if (!result) {
      this.logger.debug(
        `Reservation ${reservationId} not found or already handled.`,
      );
    } else {
      this.logger.debug(
        `Reservation ${reservationId} expired (status: ${result.status}).`,
      );
    }
  }
}
