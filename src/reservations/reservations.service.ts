import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import bull from 'bull';

import { Product } from '../products/product.entity';
import { Reservation, ReservationStatus } from './reservation.entity';
import { ReservationsGateway } from '../realtime/reservations.gateway';

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    private readonly dataSource: DataSource,
    @InjectQueue('reservations')
    private readonly reservationsQueue: bull.Queue,
    private readonly gateway: ReservationsGateway,
  ) {}

  /**
   * Create / extend a reservation for a user & product.
   *
   * Behaviour:
   * - Locks product row to avoid overselling.
   * - Deducts stock.
   * - If ACTIVE reservation already exists for (userId, productId),
   *   increases quantity instead of creating another row.
   * - Resets expiresAt for ALL ACTIVE reservations of this user
   *   to a new 2-minute window.
   * - Enqueues a delayed expiration job.
   */
  async createReservation(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<Reservation> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be > 0');
    }

    const { reservation, product } = await this.dataSource.transaction(
      async (manager) => {
        const productRepo = manager.getRepository(Product);
        const reservationRepo = manager.getRepository(Reservation);

        // 1) Lock product
        const product = await productRepo
          .createQueryBuilder('p')
          .setLock('pessimistic_write')
          .where('p.id = :id', { id: productId })
          .getOne();

        if (!product) {
          throw new NotFoundException('Product not found');
        }

        if (product.availableStock < quantity) {
          throw new BadRequestException('Not enough stock');
        }

        // 2) Deduct stock
        product.availableStock -= quantity;
        await productRepo.save(product);

        const newExpiresAt = new Date(Date.now() + 2 * 60 * 1000);

        // 3) Find existing ACTIVE reservation for (userId, productId)
        // eslint-disable-next-line prefer-const
        let existing = await reservationRepo
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.userId = :userId', { userId })
          .andWhere('r.productId = :productId', { productId })
          .andWhere('r.status = :status', {
            status: ReservationStatus.ACTIVE,
          })
          .getOne();

        let currentReservation: Reservation;

        if (existing) {
          existing.quantity += quantity;
          existing.expiresAt = newExpiresAt;
          currentReservation = await reservationRepo.save(existing);
        } else {
          const created = reservationRepo.create({
            userId,
            productId,
            quantity,
            status: ReservationStatus.ACTIVE,
            expiresAt: newExpiresAt,
          });
          currentReservation = await reservationRepo.save(created);
        }

        // 4) Reset expiration for ALL ACTIVE reservations of this user
        await reservationRepo
          .createQueryBuilder()
          .update(Reservation)
          .set({ expiresAt: newExpiresAt })
          .where('userId = :userId', { userId })
          .andWhere('status = :status', {
            status: ReservationStatus.ACTIVE,
          })
          .execute();

        // 5) Enqueue an expiration job for this reservation
        const delay = newExpiresAt.getTime() - Date.now();
        await this.reservationsQueue.add(
          'expire-reservation',
          { reservationId: currentReservation.id },
          { delay: Math.max(0, delay) },
        );

        return { reservation: currentReservation, product };
      },
    );

    // Notify via websockets
    this.gateway.emitUserReservationsUpdated(userId);
    if (product) {
      this.gateway.emitProductsUpdated({
        id: product.id,
        availableStock: product.availableStock,
      });
    }

    return reservation;
  }

  /**
   * Mark reservation as COMPLETED (mock payment).
   */
  async completeReservation(id: string): Promise<Reservation> {
    const { reservation, product } = await this.dataSource.transaction(
      async (manager) => {
        const reservationRepo = manager.getRepository(Reservation);
        const productRepo = manager.getRepository(Product);

        const existing = await reservationRepo
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id })
          .getOne();

        if (!existing) {
          throw new NotFoundException('Reservation not found');
        }

        if (existing.status === ReservationStatus.COMPLETED) {
          return { reservation: existing, product: null };
        }

        if (existing.status === ReservationStatus.EXPIRED) {
          throw new BadRequestException('Reservation already expired');
        }

        // Optionally, check if expiresAt <= now and treat as expired
        if (existing.expiresAt <= new Date()) {
          // expire and restore stock
          const product = await productRepo.findOneBy({
            id: existing.productId,
          });
          if (product) {
            product.availableStock += existing.quantity;
            await productRepo.save(product);
          }

          existing.status = ReservationStatus.EXPIRED;
          existing.expiresAt = new Date();

          const saved = await reservationRepo.save(existing);

          return { reservation: saved, product };
        }

        existing.status = ReservationStatus.COMPLETED;

        const saved = await reservationRepo.save(existing);

        // no stock change when successfully completed
        return { reservation: saved, product: null };
      },
    );

    this.gateway.emitUserReservationsUpdated(reservation.userId);
    if (product) {
      this.gateway.emitProductsUpdated({
        id: product.id,
        availableStock: product.availableStock,
      });
    }

    return reservation;
  }

  /**
   * Cancel a reservation early and restore stock.
   */
  async cancelReservation(id: string): Promise<Reservation> {
    const { reservation, product } = await this.dataSource.transaction(
      async (manager) => {
        const reservationRepo = manager.getRepository(Reservation);
        const productRepo = manager.getRepository(Product);

        const existing = await reservationRepo
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id })
          .getOne();

        if (!existing) {
          throw new NotFoundException('Reservation not found');
        }

        if (existing.status !== ReservationStatus.ACTIVE) {
          return { reservation: existing, product: null };
        }

        const product = await productRepo.findOneBy({
          id: existing.productId,
        });

        if (product) {
          product.availableStock += existing.quantity;
          await productRepo.save(product);
        }

        existing.status = ReservationStatus.EXPIRED;
        existing.expiresAt = new Date();

        const saved = await reservationRepo.save(existing);

        return { reservation: saved, product };
      },
    );

    this.gateway.emitUserReservationsUpdated(reservation.userId);
    if (product) {
      this.gateway.emitProductsUpdated({
        id: product.id,
        availableStock: product.availableStock,
      });
    }

    return reservation;
  }

  /**
   * Used by Bull processor to expire a reservation by ID.
   * Background job will call this.
   */
  async expireReservation(id: string): Promise<Reservation | null> {
    const { reservation, product } = await this.dataSource.transaction(
      async (manager) => {
        const reservationRepo = manager.getRepository(Reservation);
        const productRepo = manager.getRepository(Product);

        const existing = await reservationRepo
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id })
          .getOne();

        if (!existing) {
          return { reservation: null, product: null };
        }

        if (existing.status !== ReservationStatus.ACTIVE) {
          return { reservation: existing, product: null };
        }

        // Only expire if expiresAt is actually in the past
        if (existing.expiresAt > new Date()) {
          return { reservation: existing, product: null };
        }

        const product = await productRepo.findOneBy({
          id: existing.productId,
        });
        if (product) {
          product.availableStock += existing.quantity;
          await productRepo.save(product);
        }

        existing.status = ReservationStatus.EXPIRED;
        existing.expiresAt = new Date();

        const saved = await reservationRepo.save(existing);

        return { reservation: saved, product };
      },
    );

    if (reservation) {
      this.gateway.emitUserReservationsUpdated(reservation.userId);
    }
    if (product) {
      this.gateway.emitProductsUpdated({
        id: product.id,
        availableStock: product.availableStock,
      });
    }

    return reservation;
  }

  async getReservation(id: string): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({
      where: { id },
      relations: ['product'],
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    return reservation;
  }

  async findByUser(userId: string): Promise<Reservation[]> {
    return this.reservationRepo.find({
      where: { userId },
      relations: ['product'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Reset DB to demo state (dev only).
   */
  async resetDatabase() {
    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(Reservation);
      const productRepo = manager.getRepository(Product);

      // Delete child table first (FK)
      await reservationRepo.createQueryBuilder().delete().execute();

      await productRepo.createQueryBuilder().delete().execute();

      const sampleProducts = productRepo.create([
        {
          name: 'LuxeGlow Serum',
          price: 29.0,
          availableStock: 10,
        },
        {
          name: 'Velvet Matte Lipstick',
          price: 19.0,
          availableStock: 8,
        },
        {
          name: 'Radiant Finish Highlighter',
          price: 24.0,
          availableStock: 5,
        },
      ]);

      const saved = await productRepo.save(sampleProducts);

      // Broadcast new products stock everywhere
      this.gateway.emitProductsUpdated(
        saved.map((p) => ({
          id: p.id,
          availableStock: p.availableStock,
        })),
      );

      return {
        message: 'Database reset to default demo data.',
        products: saved,
      };
    });
  }
}
