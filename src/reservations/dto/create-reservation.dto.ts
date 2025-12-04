import { IsUUID, IsInt, Min, IsString } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  userId: string;
}
