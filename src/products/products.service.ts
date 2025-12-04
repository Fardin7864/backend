import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  findAll() {
    return this.productRepo.find();
  }

  createSampleProducts() {
    const products = this.productRepo.create([
      { name: 'Product A', price: 10, availableStock: 10 },
      { name: 'Product B', price: 20, availableStock: 5 },
      { name: 'Product C', price: 15, availableStock: 2 },
    ]);

    return this.productRepo.save(products);
  }
}
