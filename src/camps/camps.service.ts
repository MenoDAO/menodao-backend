import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampDto, UpdateCampDto } from './dto/create-camp.dto';
import { RegistrationStatus } from '@prisma/client';

@Injectable()
export class CampsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCampDto) {
    return this.prisma.camp.create({
      data: {
        name: dto.name,
        description: dto.description,
        venue: dto.venue,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        startDate: dto.startDate,
        endDate: dto.endDate,
        capacity: dto.capacity || 100,
        isActive: true,
      },
    });
  }

  async findAll() {
    return this.prisma.camp.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: {
          select: { registrations: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const camp = await this.prisma.camp.findUnique({
      where: { id },
      include: {
        registrations: {
          include: {
            member: {
              select: {
                id: true,
                fullName: true,
                phoneNumber: true,
                subscription: { select: { tier: true } },
              },
            },
          },
        },
      },
    });

    if (!camp) {
      throw new NotFoundException('Camp not found');
    }

    return camp;
  }

  async update(id: string, dto: UpdateCampDto) {
    await this.findOne(id); // create checkExists
    return this.prisma.camp.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // create checkExists
    // Only delete if no registrations linked? Or cascade?
    // Safe delete via setting isActive: false is better usually, but sticking to delete for now if schema supports it or throws error
    try {
      return await this.prisma.camp.delete({ where: { id } });
    } catch (error) {
      // Fallback to deactivation if foreign key constraint fails
      return this.prisma.camp.update({
        where: { id },
        data: { isActive: false },
      });
    }
  }

  async assignMember(campId: string, memberId: string) {
    const camp = await this.findOne(campId);

    // Check capacity
    const registrationCount = await this.prisma.campRegistration.count({
      where: { campId },
    });

    if (registrationCount >= camp.capacity) {
      throw new BadRequestException('Camp is at full capacity');
    }

    // Check existing registration
    const existing = await this.prisma.campRegistration.findUnique({
      where: {
        campId_memberId: {
          campId,
          memberId,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('Member already registered for this camp');
    }

    return this.prisma.campRegistration.create({
      data: {
        campId,
        memberId,
        status: RegistrationStatus.REGISTERED,
      },
      include: {
        member: true,
      },
    });
  }
}
