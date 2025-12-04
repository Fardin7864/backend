// backend/src/app.module.ts
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

    // 🔹 Postgres config (use DB_USERNAME / DB_PASSWORD)
    // TypeOrmModule.forRootAsync({
    //   inject: [ConfigService],
    //   useFactory: (config: ConfigService) => ({
    //     type: 'postgres',
    //     host: config.get<string>('DB_HOST'),
    //     port: config.get<number>('DB_PORT'),
    //     username: config.get<string>('DB_USERNAME'),
    //     password: config.get<string>('DB_PASSWORD'),
    //     database: config.get<string>('DB_NAME'),
    //     entities: [Product, Reservation],
    //     synchronize: true, // OK for assignment/demo only
    //   }),
    // }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DB_URL');

        if (!url) {
          return {
            type: 'postgres',
            host: config.get<string>('DB_HOST'),
            port: config.get<number>('DB_PORT'),
            username: config.get<string>('DB_USERNAME'),
            password: config.get<string>('DB_PASSWORD'),
            database: config.get<string>('DB_NAME'),
            entities: [Product, Reservation],
            synchronize: true,
            ssl: {
              rejectUnauthorized: false,
            },
          };
        }

        // preferred path: single URL
        return {
          type: 'postgres',
          url,
          entities: [Product, Reservation],
          synchronize: true,
          ssl: {
            rejectUnauthorized: false, // important for Render
          },
        };
      },
    }),

    // 🔹 Bull / Redis from REDIS_URL (Upstash)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          throw new Error('REDIS_URL env var is required');
        }

        const redisUrl = new URL(url);

        return {
          redis: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            password: redisUrl.password || undefined,
            // Upstash uses TLS with rediss://
            tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
          },
        };
      },
    }),

    ScheduleModule.forRoot(),

    ProductsModule,
    ReservationsModule,
  ],
  providers: [ReservationsGateway],
})
export class AppModule {}
