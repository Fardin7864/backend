import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import bull from 'bull';

import { Product } from '../products/product.entity';
import { Reservation, ReservationStatus } from './reservation.entity';
import { FindOptionsWhere } from 'typeorm';

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
  ) {}

  async createReservation(userId: string, productId: string, quantity: number) {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be > 0');
    }

    return this.dataSource.transaction(async (manager) => {
      const productRepo = manager.getRepository(Product);
      const reservationRepo = manager.getRepository(Reservation);

      // 1) Lock product row to prevent overselling
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

      // 2) Deduct stock for this new quantity
      product.availableStock -= quantity;
      await productRepo.save(product);

      // 3) Look for existing ACTIVE reservation for this user & product
      const existing = await reservationRepo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.userId = :userId', { userId })
        .andWhere('r.productId = :productId', { productId })
        .andWhere('r.status = :status', {
          status: ReservationStatus.ACTIVE,
        })
        .getOne();

      const newExpiresAt = new Date(Date.now() + 2 * 60 * 1000);

      let reservation: Reservation;

      if (existing) {
        // 3a) Same product reserved again -> increase quantity
        existing.quantity += quantity;
        existing.expiresAt = newExpiresAt;
        reservation = await reservationRepo.save(existing);
      } else {
        // 3b) New reservation for this product
        const created = reservationRepo.create({
          userId,
          productId,
          quantity,
          status: ReservationStatus.ACTIVE,
          expiresAt: newExpiresAt,
        });
        reservation = await reservationRepo.save(created);

        // Create a delayed job for expiration of this reservation
        await this.reservationsQueue.add(
          'expire-reservation',
          { reservationId: reservation.id },
          { delay: newExpiresAt.getTime() - Date.now() },
        );
      }

      // 4) IMPORTANT: Reset expiration for ALL ACTIVE reservations of this user
      await reservationRepo
        .createQueryBuilder()
        .update(Reservation)
        .set({ expiresAt: newExpiresAt })
        .where('userId = :userId', { userId })
        .andWhere('status = :status', { status: ReservationStatus.ACTIVE })
        .execute();

      // Return the updated reservation for this product
      return reservation;
    });
  }

  async completeReservation(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(Reservation);
      const productRepo = manager.getRepository(Product);

      const reservation = await reservationRepo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id })
        .getOne();

      if (!reservation) throw new NotFoundException('Reservation not found');

      if (reservation.status === ReservationStatus.COMPLETED) {
        return reservation;
      }

      const now = new Date();

      if (
        reservation.expiresAt <= now ||
        reservation.status === ReservationStatus.EXPIRED
      ) {
        // If expired but not yet processed, restore stock now
        if (reservation.status !== ReservationStatus.EXPIRED) {
          const product = await productRepo.findOneBy({
            id: reservation.productId,
          });
          if (product) {
            product.availableStock += reservation.quantity;
            await productRepo.save(product);
          }
          reservation.status = ReservationStatus.EXPIRED;
          await reservationRepo.save(reservation);
        }

        throw new BadRequestException('Reservation already expired');
      }

      reservation.status = ReservationStatus.COMPLETED;
      return reservationRepo.save(reservation);
    });
  }

  async getReservation(id: string) {
    const reservation = await this.reservationRepo.findOne({
      where: { id },
      relations: ['product'],
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async cancelReservation(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(Reservation);
      const productRepo = manager.getRepository(Product);

      const reservation = await reservationRepo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id })
        .getOne();

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }

      if (reservation.status !== ReservationStatus.ACTIVE) {
        // Nothing to do – already completed or expired
        return reservation;
      }

      const product = await productRepo.findOneBy({
        id: reservation.productId,
      });

      if (product) {
        product.availableStock += reservation.quantity;
        await productRepo.save(product);
      }

      reservation.status = ReservationStatus.EXPIRED;
      reservation.expiresAt = new Date();

      return reservationRepo.save(reservation);
    });
  }

  async findByUser(userId: string) {
    return this.reservationRepo.find({
      where: { userId } as FindOptionsWhere<Reservation>,
      relations: ['product'],
      order: { createdAt: 'DESC' },
    });
  }

  async resetDatabase() {
    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(Reservation);
      const productRepo = manager.getRepository(Product);

      // 1) Delete reservations first (child table)
      await reservationRepo.createQueryBuilder().delete().execute();

      // 2) Then delete products (parent table)
      await productRepo.createQueryBuilder().delete().execute();

      // 3) Seed demo products again
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

      return {
        message: 'Database reset to default demo data.',
        products: saved,
      };
    });
  }
}
