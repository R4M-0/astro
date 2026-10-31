import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: process.env.APP_URL ?? 'http://localhost:3000', credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.headers.authorization?.replace('Bearer ', '') as string | undefined);
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid?: string; type?: string }>(
        token ?? '',
        { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') },
      );
      // same rules as JwtStrategy: no 2FA challenge tokens, live session only
      if (payload.type || !payload.sid) throw new Error('not an access token');
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: { revokedAt: true, expiresAt: true, user: { select: { deletedAt: true } } },
      });
      if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) {
        throw new Error('session revoked');
      }
      await client.join(`user:${payload.sub}`);
      await client.join(`session:${payload.sid}`);
    } catch {
      this.logger.debug('Rejected unauthenticated WS connection');
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket) {
    // rooms are cleaned automatically
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  /** Drop the live sockets of a session (logout / revoke) or of a whole user. */
  disconnectSession(sessionId: string) {
    this.server?.in(`session:${sessionId}`).disconnectSockets(true);
  }

  disconnectUser(userId: string) {
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }
}
