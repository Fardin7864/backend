import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

import { Reservation, ReservationStatus } from './reservation.entity';
import { Product } from '../products/product.entity';

@Injectable()
export class ReservationsCleanupService {
  private readonly logger = new Logger(ReservationsCleanupService.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async expireOverdueReservations() {
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(Reservation);
      const productRepo = manager.getRepository(Product);

      const overdue = await reservationRepo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.status = :status', { status: ReservationStatus.ACTIVE })
        .andWhere('r.expiresAt <= :now', { now })
        .getMany();

      for (const res of overdue) {
        const product = await productRepo.findOneBy({ id: res.productId });
        if (!product) continue;

        product.availableStock += res.quantity;
        res.status = ReservationStatus.EXPIRED;

        await productRepo.save(product);
        await reservationRepo.save(res);
      }
    });
  }
}
