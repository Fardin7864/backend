// backend/src/reservations/reservations.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { Reservation } from './reservation.entity';
import { Product } from '../products/product.entity';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsProcessor } from './reservations.processor';
import { ReservationsGateway } from '../realtime/reservations.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, Product]),
    BullModule.registerQueue({
      name: 'reservations',
    }),
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationsProcessor, ReservationsGateway],
  exports: [ReservationsService],
})
export class ReservationsModule {}
