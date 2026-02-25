import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampDto, UpdateCampDto } from './dto/create-camp.dto';

@Injectable()
export class CampsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCampDto) {
    return this.prisma.camp.create({
      data: dto,
    });
  }

  async findAll() {
    return this.prisma.camp.findMany({
      include: {
        _count: {
          select: { registrations: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async getUpcomingCamps() {
    return this.prisma.camp.findMany({
      where: {
        isActive: true,
        startDate: { gte: new Date() },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  async findNearby(lat: number, lon: number, radiusKm: number) {
    const camps = await this.prisma.camp.findMany({
      where: { isActive: true },
    });

    const nearbyCamps = camps
      .map((camp) => {
        const distance = this.getDistance(
          lat,
          lon,
          camp.latitude,
          camp.longitude,
        );
        return { ...camp, distanceKm: distance };
      })
      .filter((camp) => camp.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return nearbyCamps;
  }

  async getCamp(id: string) {
    const camp = await this.prisma.camp.findUnique({
      where: { id },
      include: {
        _count: {
          select: { registrations: true },
        },
      },
    });

    if (!camp) {
      throw new NotFoundException(`Camp with ID ${id} not found`);
    }

    const { _count, ...campData } = camp;
    return {
      ...campData,
      registrationsCount: _count.registrations,
      spotsRemaining: camp.capacity - _count.registrations,
    };
  }

  async findOne(id: string) {
    return this.getCamp(id);
  }

  async update(id: string, dto: UpdateCampDto) {
    return this.prisma.camp.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    return this.prisma.camp.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async registerForCamp(memberId: string, campId: string) {
    const camp = await this.getCamp(campId);

    if (camp.spotsRemaining <= 0) {
      throw new BadRequestException('Camp is fully booked');
    }

    const existingRegistration = await this.prisma.campRegistration.findUnique({
      where: {
        campId_memberId: { campId, memberId },
      },
    });

    if (existingRegistration) {
      throw new BadRequestException(
        'Member is already registered for this camp',
      );
    }

    return this.prisma.campRegistration.create({
      data: { campId, memberId },
      include: { camp: true },
    });
  }

  async assignMember(campId: string, memberId: string) {
    return this.registerForCamp(memberId, campId);
  }

  async getMemberRegistrations(memberId: string) {
    return this.prisma.campRegistration.findMany({
      where: { memberId },
      include: { camp: true },
      orderBy: { camp: { startDate: 'asc' } },
    });
  }

  async cancelRegistration(memberId: string, campId: string) {
    const registration = await this.prisma.campRegistration.findUnique({
      where: {
        campId_memberId: { campId, memberId },
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    return this.prisma.campRegistration.update({
      where: { id: registration.id },
      data: { status: 'CANCELLED' as any },
    });
  }

  private getDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
