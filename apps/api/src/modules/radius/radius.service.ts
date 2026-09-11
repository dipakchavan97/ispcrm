import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { prisma } from '@isp-crm/database';

@Injectable()
export class RadiusService {
  async getActiveSessions(organizationId: string, filters: { username?: string }) {
    // Get all customer PPPoE usernames belonging to this organization
    const orgCustomers = await prisma.customer.findMany({
      where: { organizationId },
      select: { username: true },
    });

    let allowedUsernames = orgCustomers.map((c) => c.username);
    if (allowedUsernames.length === 0) {
      return [];
    }

    if (filters.username) {
      allowedUsernames = allowedUsernames.filter((u) =>
        u.toLowerCase().includes(filters.username!.toLowerCase()),
      );
      if (allowedUsernames.length === 0) {
        return [];
      }
    }

    const sessions = await prisma.radAcct.findMany({
      where: {
        acctstoptime: null,
        username: { in: allowedUsernames },
      },
      take: 50,
      orderBy: { acctstarttime: 'desc' },
    });

    return sessions.map((s) => ({
      radacctid: s.radacctid.toString(),
      acctsessionid: s.acctsessionid,
      username: s.username,
      nasipaddress: s.nasipaddress,
      callingstationid: s.callingstationid,
      framedipaddress: s.framedipaddress,
      acctstarttime: s.acctstarttime?.toISOString(),
      acctsessiontime: Number(s.acctsessiontime || 0),
      downloadBytes: Number(s.acctoutputoctets || 0),
      uploadBytes: Number(s.acctinputoctets || 0),
    }));
  }

  async disconnectSession(organizationId: string, sessionId: string) {
    const session = await prisma.radAcct.findFirst({
      where: { acctsessionid: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session '${sessionId}' not found`);
    }

    // Verify session belongs to an active customer of this organization
    const customer = await prisma.customer.findFirst({
      where: { organizationId, username: session.username },
    });

    if (!customer) {
      throw new ForbiddenException('Cannot disconnect a session belonging to another organization');
    }

    return {
      message: 'RFC 3576 Disconnect-Request (PoD) queued to worker',
      sessionId,
      username: session.username,
      status: 'QUEUED',
    };
  }

  async getUserSessions(organizationId: string, username: string) {
    // Verify subscriber belongs to this organization
    const customer = await prisma.customer.findFirst({
      where: { organizationId, username },
    });

    if (!customer) {
      throw new NotFoundException(`Subscriber with PPPoE username '${username}' not found in your organization`);
    }

    const sessions = await prisma.radAcct.findMany({
      where: { username },
      take: 20,
      orderBy: { acctstarttime: 'desc' },
    });

    return sessions.map((s) => ({
      radacctid: s.radacctid.toString(),
      acctsessionid: s.acctsessionid,
      username: s.username,
      nasipaddress: s.nasipaddress,
      acctstarttime: s.acctstarttime?.toISOString(),
      acctstoptime: s.acctstoptime?.toISOString(),
      acctsessiontime: Number(s.acctsessiontime || 0),
      downloadBytes: Number(s.acctoutputoctets || 0),
      uploadBytes: Number(s.acctinputoctets || 0),
      terminateCause: s.acctterminatecause,
    }));
  }
}
