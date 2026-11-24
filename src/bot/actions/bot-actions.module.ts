import { Module } from '@nestjs/common';
import { ContributionsModule } from '../../contributions/contributions.module';
import { SubscriptionsModule } from '../../subscriptions/subscriptions.module';
import { BotMembershipPaymentService } from '../account/bot-membership-payment.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../../auth/auth.module';
import { SmsModule } from '../../sms/sms.module';
import { BookingModule } from '../booking/booking.module';
import { BotIdentityModule } from '../identity/identity.module';
import { BotMemberDataService } from '../account/bot-member-data.service';
import { AdminWhatsappAccessService } from '../admin/admin-whatsapp-access.service';
import { BotPrivilegeService } from './bot-privileges.service';
import { BotActorService } from './bot-actor.service';
import { BotActionRegistryService } from './bot-action-registry.service';

/**
 * Bounded action execution + privilege resolution.
 *
 * Kept in its own module so both the WhatsApp gateway (admin OTP flow) and the
 * AI pipeline share exactly one instance of the member-data and admin-access
 * services. Two instances would mean two independent verification states.
 */
@Module({
  imports: [
    ConfigModule,
    BookingModule,
    AuthModule,
    SmsModule,
    BotIdentityModule,
    ContributionsModule,
    SubscriptionsModule,
  ],
  providers: [
    BotMemberDataService,
    BotMembershipPaymentService,
    AdminWhatsappAccessService,
    BotPrivilegeService,
    BotActorService,
    BotActionRegistryService,
  ],
  exports: [
    BotMemberDataService,
    BotMembershipPaymentService,
    AdminWhatsappAccessService,
    BotPrivilegeService,
    BotActorService,
    BotActionRegistryService,
  ],
})
export class BotActionsModule {}
