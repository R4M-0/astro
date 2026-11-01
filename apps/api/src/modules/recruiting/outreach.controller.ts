import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OutreachService } from './outreach.service';
import {
  ApproveMessagesDto,
  BookSlotDto,
  CandidateReplyDto,
  CreateSlotsDto,
  DraftMessageDto,
  RequestDraftsDto,
  UpdateMessageDto,
} from './recruiting.dto';

/** Pipeline 2, HR side: slots, agent drafts and the approval gate. */
@ApiTags('recruiting')
@ApiBearerAuth()
@Controller('recruiting')
export class OutreachController {
  constructor(private readonly outreach: OutreachService) {}

  @Get('openings/:id/slots')
  @RequirePermissions('recruiting:read')
  slots(@OrgId() orgId: string, @Param('id') id: string) {
    return this.outreach.listSlots(orgId, id);
  }

  @Post('openings/:id/slots')
  @RequirePermissions('recruiting:update')
  addSlots(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateSlotsDto) {
    return this.outreach.addSlots(orgId, user.id, id, dto);
  }

  @Delete('slots/:id')
  @RequirePermissions('recruiting:update')
  removeSlot(@OrgId() orgId: string, @Param('id') id: string) {
    return this.outreach.removeSlot(orgId, id);
  }

  @Post('openings/:id/drafts')
  @RequirePermissions('recruiting:update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  drafts(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: RequestDraftsDto) {
    return this.outreach.requestDrafts(orgId, id, dto.kind);
  }

  @Get('openings/:id/messages')
  @RequirePermissions('recruiting:read')
  messages(@OrgId() orgId: string, @Param('id') id: string) {
    return this.outreach.listMessages(orgId, id);
  }

  @Post('candidates/:id/messages')
  @RequirePermissions('recruiting:update')
  write(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: DraftMessageDto) {
    return this.outreach.writeMessage(orgId, id, dto);
  }

  // before `messages/:id`
  @Post('messages/approve')
  @RequirePermissions('recruiting:approve')
  approve(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: ApproveMessagesDto) {
    return this.outreach.approve(orgId, user.id, dto.ids);
  }

  @Patch('messages/:id')
  @RequirePermissions('recruiting:update')
  update(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: UpdateMessageDto) {
    return this.outreach.updateDraft(orgId, id, dto);
  }

  @Post('messages/:id/discard')
  @RequirePermissions('recruiting:approve')
  discard(@OrgId() orgId: string, @Param('id') id: string) {
    return this.outreach.discard(orgId, id);
  }
}

/** Pipeline 2, candidate side: the booking link. The token is the only credential. */
@ApiTags('recruiting')
@Controller('recruiting/public/:token')
export class BookingController {
  constructor(private readonly outreach: OutreachService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  view(@Param('token') token: string) {
    return this.outreach.publicView(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('book')
  book(@Param('token') token: string, @Body() dto: BookSlotDto) {
    return this.outreach.book(token, dto.slotId);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('decline')
  decline(@Param('token') token: string) {
    return this.outreach.decline(token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('messages')
  reply(@Param('token') token: string, @Body() dto: CandidateReplyDto) {
    return this.outreach.receive(token, dto.text);
  }
}
