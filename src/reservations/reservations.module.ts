import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { Reservation } from './reservation.entity';
import { Product } from '../products/product.entity';
import { ReservationsProcessor } from './reservations.processor';
import { ReservationsCleanupService } from './reservations.cleanup';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, Product]),
    BullModule.registerQueue({ name: 'reservations' }),
  ],
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    ReservationsProcessor,
    ReservationsCleanupService,
  ],
})
export class ReservationsModule {}
