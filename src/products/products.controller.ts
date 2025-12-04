import { Controller, Get, Post } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll() {
    return this.productsService.findAll();
  }

  // Optional: Seed endpoint (for convenience in dev)
  @Post('seed')
  seed() {
    return this.productsService.createSampleProducts();
  }
}
