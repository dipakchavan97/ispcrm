import { Injectable, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import { CoaAction, CoaRequestType, getRadiusUsernameCandidates } from '@isp-crm/shared';
import { RadiusCoaQueueService } from './radius-coa-queue.service';
import { AccessRequestsQueryDto, AccessRequestStatusFilter } from './dto/access-requests-query.dto';

@Injectable()
export class RadiusService {
  constructor(
    @Optional() private readonly coaQueueService?: RadiusCoaQueueService,
  ) {}

  async getAccessRequests(organizationId: string, query: AccessRequestsQueryDto) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(Number(query.limit), 100) : 25;
    const skip = (page - 1) * limit;

    // 1. Fetch all subscribers belonging to this organization (Strict Tenant Isolation)
    const orgCustomers = await prisma.customer.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        customerCode: true,
        username: true,
        pppoeUsername: true,
        macAddress: true,
        staticIp: true,
        status: true,
        macResetPending: true,
      },
    });

    if (orgCustomers.length === 0) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    // 2. Map usernames and candidate realms back to their customer record
    const candidateToCustomerMap = new Map<string, typeof orgCustomers[0]>();
    let candidateUsernames: string[] = [];

    for (const c of orgCustomers) {
      const candidates = [
        ...getRadiusUsernameCandidates(c.username),
        ...(c.pppoeUsername ? getRadiusUsernameCandidates(c.pppoeUsername) : []),
      ];
      for (const cand of candidates) {
        candidateToCustomerMap.set(cand.toLowerCase(), c);
        candidateUsernames.push(cand);
      }
    }

    // Deduplicate candidate usernames
    candidateUsernames = Array.from(new Set(candidateUsernames));

    // 3. Apply username search filter
    if (query.username && query.username.trim()) {
      const uSearch = query.username.trim().toLowerCase();
      candidateUsernames = candidateUsernames.filter((cand) =>
        cand.toLowerCase().includes(uSearch),
      );
      if (candidateUsernames.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        };
      }
    }

    // 4. Apply MAC search filter
    if (query.mac && query.mac.trim()) {
      const macSearch = query.mac.trim().toLowerCase();
      const matchedCustIds = new Set(
        orgCustomers
          .filter((c) => c.macAddress && c.macAddress.toLowerCase().includes(macSearch))
          .map((c) => c.id),
      );
      candidateUsernames = candidateUsernames.filter((cand) => {
        const cust = candidateToCustomerMap.get(cand.toLowerCase());
        return cust && matchedCustIds.has(cust.id);
      });
      if (candidateUsernames.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        };
      }
    }

    // 5. Build query where clause
    const whereClause: any = {
      username: { in: candidateUsernames },
    };

    // Status filter (Accept / Reject)
    if (query.status === AccessRequestStatusFilter.ACCEPT) {
      whereClause.reply = { contains: 'Accept', mode: 'insensitive' };
    } else if (query.status === AccessRequestStatusFilter.REJECT) {
      whereClause.reply = { contains: 'Reject', mode: 'insensitive' };
    } else if (query.reply && query.reply.trim()) {
      whereClause.reply = { equals: query.reply.trim(), mode: 'insensitive' };
    }

    // Timestamp range filters
    if (query.fromDate || query.toDate) {
      whereClause.authdate = {};
      if (query.fromDate) {
        whereClause.authdate.gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        whereClause.authdate.lte = new Date(query.toDate);
      }
    }

    // 6. Execute count & paginated fetch
    // STRICT SECURITY: 'pass' is explicitly omitted from projection!
    const [total, records] = await Promise.all([
      prisma.radPostAuth.count({ where: whereClause }),
      prisma.radPostAuth.findMany({
        where: whereClause,
        orderBy: { id: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          reply: true,
          authdate: true,
        },
      }),
    ]);

    // 7. Enrich with recent session info from radacct if available
    const matchedUsernames = records.map((r) => r.username);
    const sessionByUsername = new Map<
      string,
      { nasipaddress: string; framedipaddress: string | null; callingstationid: string | null }
    >();

    if (matchedUsernames.length > 0) {
      const recentSessions = await prisma.radAcct.findMany({
        where: { username: { in: matchedUsernames } },
        orderBy: { radacctid: 'desc' },
        take: 100,
        select: {
          username: true,
          nasipaddress: true,
          framedipaddress: true,
          callingstationid: true,
        },
      });
      for (const s of recentSessions) {
        const key = s.username.toLowerCase();
        if (!sessionByUsername.has(key)) {
          sessionByUsername.set(key, s);
        }
      }
    }

    // 8. Assemble enriched, technician-friendly items
    const items = records.map((r) => {
      const cust = candidateToCustomerMap.get(r.username.toLowerCase());
      const session = sessionByUsername.get(r.username.toLowerCase());

      const isAccept = r.reply.toLowerCase().includes('accept');
      const status = isAccept ? 'ACCEPT' : 'REJECT';

      let rejectionReason = isAccept ? 'Authentication Successful' : 'Authentication Rejected';
      if (!isAccept) {
        if (cust) {
          if (cust.status === 'SUSPENDED') {
            rejectionReason = 'Account is Suspended';
          } else if (cust.status === 'EXPIRED') {
            rejectionReason = 'Account is Expired';
          } else if (cust.status === 'LEAD' || cust.status === 'PENDING') {
            rejectionReason = `Account Not Activated (Status: ${cust.status})`;
          } else if (cust.macResetPending) {
            rejectionReason = 'MAC Reset Pending (Awaiting first dial-in to auto-bind)';
          } else if (
            cust.macAddress &&
            session?.callingstationid &&
            cust.macAddress.toLowerCase() !== session.callingstationid.toLowerCase()
          ) {
            rejectionReason = `Calling-Station MAC Mismatch (Registered: ${cust.macAddress}, Calling: ${session.callingstationid})`;
          } else {
            rejectionReason = 'Invalid PPPoE Password or MAC Lockout';
          }
        } else {
          rejectionReason = 'Unknown Subscriber Username';
        }
      }

      return {
        id: r.id.toString(),
        authdate: r.authdate ? r.authdate.toISOString() : null,
        username: r.username,
        reply: r.reply,
        status,
        customerId: cust?.id || null,
        customerCode: cust?.customerCode || null,
        customerName: cust?.name || null,
        customerStatus: cust?.status || null,
        macAddress: cust?.macAddress || session?.callingstationid || null,
        callingStationId: session?.callingstationid || cust?.macAddress || null,
        framedIpAddress: cust?.staticIp || session?.framedipaddress || null,
        nasIpAddress: session?.nasipaddress || null,
        rejectionReason,
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

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

    let jobId: string | undefined;
    if (this.coaQueueService) {
      const qRes = await this.coaQueueService.queueCoaJob({
        organizationId,
        customerId: customer.id,
        username: session.username,
        action: CoaAction.SUSPEND,
        requestType: CoaRequestType.DISCONNECT,
        reason: `Manual session disconnect for sessionId ${sessionId}`,
      });
      jobId = qRes.jobId;
    }

    return {
      message: 'RFC 3576 Disconnect-Request (PoD) queued to worker',
      sessionId,
      username: session.username,
      status: 'QUEUED',
      jobId,
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
