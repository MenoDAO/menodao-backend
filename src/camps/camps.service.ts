import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CampsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all upcoming camps
   */
  async getUpcomingCamps() {
    return this.prisma.camp.findMany({
      where: {
        isActive: true,
        startDate: { gte: new Date() },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  /**
   * Find camps near a location
   * Uses Haversine formula for distance calculation
   */
  async findNearby(latitude: number, longitude: number, radiusKm = 50) {
    const camps = await this.prisma.camp.findMany({
      where: {
        isActive: true,
        startDate: { gte: new Date() },
      },
    });

    // Calculate distance for each camp
    const campsWithDistance = camps.map((camp) => {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        camp.latitude,
        camp.longitude,
      );
      return { ...camp, distanceKm: Math.round(distance * 10) / 10 };
    });

    // Filter by radius and sort by distance
    return campsWithDistance
      .filter((camp) => camp.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Get camp by ID
   */
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
      throw new NotFoundException('Camp not found');
    }

    return {
      ...camp,
      spotsRemaining: camp.capacity - camp._count.registrations,
    };
  }

  /**
   * Register member for a camp
   */
  async registerForCamp(memberId: string, campId: string) {
    const camp = await this.getCamp(campId);

    if (camp.spotsRemaining <= 0) {
      throw new BadRequestException('This camp is fully booked');
    }

    // Check if already registered
    const existing = await this.prisma.campRegistration.findUnique({
      where: {
        campId_memberId: { campId, memberId },
      },
    });

    if (existing) {
      throw new BadRequestException('You are already registered for this camp');
    }

    return this.prisma.campRegistration.create({
      data: { campId, memberId },
      include: { camp: true },
    });
  }

  /**
   * Get member's camp registrations
   */
  async getMemberRegistrations(memberId: string) {
    return this.prisma.campRegistration.findMany({
      where: { memberId },
      include: { camp: true },
      orderBy: { camp: { startDate: 'asc' } },
    });
  }

  /**
   * Cancel camp registration
   */
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
      data: { status: 'CANCELLED' },
    });
  }
}
