/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
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
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DB_URL');
        const nodeEnv = config.get<string>('NODE_ENV') || process.env.NODE_ENV;
        const isProduction = nodeEnv === 'production';

        const baseConfig: any = {
          type: 'postgres' as const,
          entities: [Product, Reservation],
          synchronize: true,
        };

        if (url) {
          Object.assign(baseConfig, { url });
        } else {
          Object.assign(baseConfig, {
            host: config.get<string>('DB_HOST'),
            port: config.get<number>('DB_PORT'),
            username: config.get<string>('DB_USERNAME'),
            password: config.get<string>('DB_PASSWORD'),
            database: config.get<string>('DB_NAME'),
          });
        }

        if (isProduction) {
          baseConfig.ssl = { rejectUnauthorized: false };
        }

        return baseConfig;
      },
    }),

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
