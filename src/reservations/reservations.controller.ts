import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  create(@Body() dto: CreateReservationDto) {
    return this.reservationsService.createReservation(
      dto.userId,
      dto.productId,
      dto.quantity,
    );
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    return this.reservationsService.completeReservation(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.reservationsService.cancelReservation(id);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.reservationsService.getReservation(id);
  }

  @Get('user/:userId')
  findForUser(@Param('userId') userId: string) {
    return this.reservationsService.findByUser(userId);
  }

  @Post('reset')
  reset() {
    return this.reservationsService.resetDatabase();
  }
}
