import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';

import { ProductsModule } from './products/products.module';
import { ReservationsModule } from './reservations/reservations.module';
import { Product } from './products/product.entity';
import { Reservation } from './reservations/reservation.entity';
import { ReservationsGateway } from './realtime/reservations.gateway';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASS'),
        database: config.get<string>('DB_NAME'),
        entities: [Product, Reservation],
        synchronize: true, // OK for take-home / dev. For prod: use migrations.
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
        },
      }),
    }),

    ScheduleModule.forRoot(),

    ProductsModule,
    ReservationsModule,
  ],
  providers: [ReservationsGateway],
})
export class AppModule {}
