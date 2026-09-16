import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { prisma } from '@isp-crm/database';

export interface CafPdfData {
  customerCode: string;
  name: string;
  mobile: string;
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  maskedAadhaar: string;
  gstin?: string | null;
  customerType: 'INDIVIDUAL' | 'COMMERCIAL';
  address: string;
  installationAddress?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  username: string;
  pppoeUsername?: string | null;
  staticIp?: string | null;
  macAddress?: string | null;
  status: string;
  installationDate?: Date | string | null;
  createdAt?: Date | string | null;
  organization: {
    name: string;
    legalName?: string | null;
    gstin?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    stateCode?: string | null;
    pincode?: string | null;
  };
  subscription?: {
    status: string;
    startDate: Date | string;
    endDate: Date | string;
    price: number;
    billingCycle: string;
    planName: string;
    downloadSpeedMbps: number;
    uploadSpeedMbps: number;
    validityDays: number;
    gstRatePercent: number;
    gstAmount: number;
    totalAmount: number;
  } | null;
}

@Injectable()
export class CafPdfService {
  private readonly logger = new Logger(CafPdfService.name);

  /**
   * Generates a statutory Customer Application Form (CAF) PDF buffer strictly scoped to tenant.
   * Never selects or exposes passwords, RADIUS secrets, or router credentials.
   */
  async generateCafPdf(
    organizationId: string,
    customerId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId,
      },
      select: {
        id: true,
        organizationId: true,
        customerCode: true,
        name: true,
        mobile: true,
        phone: true,
        alternatePhone: true,
        email: true,
        address: true,
        installationAddress: true,
        area: true,
        city: true,
        state: true,
        pincode: true,
        aadhaarNumber: true,
        gstin: true,
        username: true,
        pppoeUsername: true,
        staticIp: true,
        macAddress: true,
        status: true,
        installationDate: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            legalName: true,
            gstin: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            stateCode: true,
            pincode: true,
          },
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
            price: true,
            billingCycle: true,
            plan: {
              select: {
                id: true,
                name: true,
                downloadSpeedMbps: true,
                uploadSpeedMbps: true,
                validityDays: true,
                price: true,
                gstRatePercent: true,
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer '${customerId}' not found in your organization`);
    }

    const cafData = this.compileCafData(customer);
    const buffer = await this.renderPdf(cafData);
    const safeCustomerName = (customer.name || 'Customer').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `CAF-${customer.customerCode || customer.id.slice(0, 8)}-${safeCustomerName}.pdf`;

    return { buffer, filename };
  }

  /**
   * Compiles and sanitizes customer data into safe CAF payload with strict Aadhaar masking.
   */
  private compileCafData(customer: any): CafPdfData {
    // Determine customer type
    const customerType: 'INDIVIDUAL' | 'COMMERCIAL' = customer.gstin && customer.gstin.trim().length >= 10
      ? 'COMMERCIAL'
      : 'INDIVIDUAL';

    // Mask Aadhaar: strictly output XXXX-XXXX-1234 or XXXX-XXXX-XXXX
    const maskedAadhaar = this.maskAadhaar(customer.aadhaarNumber);

    // Compile subscription information
    let subscriptionData: CafPdfData['subscription'] = null;
    if (customer.subscriptions && customer.subscriptions.length > 0) {
      const sub = customer.subscriptions[0];
      const plan = sub.plan;
      const basePrice = Number(sub.price || plan?.price || 0);
      const gstRate = Number(plan?.gstRatePercent || 18);
      const gstAmount = Number(((basePrice * gstRate) / 100).toFixed(2));
      const totalAmount = Number((basePrice + gstAmount).toFixed(2));

      subscriptionData = {
        status: sub.status || 'ACTIVE',
        startDate: sub.startDate,
        endDate: sub.endDate,
        price: basePrice,
        billingCycle: String(sub.billingCycle || 'MONTHLY'),
        planName: plan?.name || 'Broadband Plan',
        downloadSpeedMbps: Number(plan?.downloadSpeedMbps || 0),
        uploadSpeedMbps: Number(plan?.uploadSpeedMbps || 0),
        validityDays: Number(plan?.validityDays || 30),
        gstRatePercent: gstRate,
        gstAmount,
        totalAmount,
      };
    }

    return {
      customerCode: customer.customerCode,
      name: customer.name,
      mobile: customer.mobile || customer.phone || '',
      phone: customer.phone || null,
      alternatePhone: customer.alternatePhone || null,
      email: customer.email || null,
      maskedAadhaar,
      gstin: customer.gstin || null,
      customerType,
      address: customer.address || '',
      installationAddress: customer.installationAddress || customer.address || '',
      area: customer.area || null,
      city: customer.city || null,
      state: customer.state || null,
      pincode: customer.pincode || null,
      username: customer.username || customer.pppoeUsername || '',
      pppoeUsername: customer.pppoeUsername || customer.username || '',
      staticIp: customer.staticIp || null,
      macAddress: customer.macAddress || null,
      status: String(customer.status || 'ACTIVE'),
      installationDate: customer.installationDate || customer.createdAt || null,
      createdAt: customer.createdAt || null,
      organization: {
        name: customer.organization?.name || 'Internet Service Provider',
        legalName: customer.organization?.legalName || customer.organization?.name || null,
        gstin: customer.organization?.gstin || null,
        email: customer.organization?.email || null,
        phone: customer.organization?.phone || null,
        address: customer.organization?.address || null,
        city: customer.organization?.city || null,
        state: customer.organization?.state || null,
        stateCode: customer.organization?.stateCode || null,
        pincode: customer.organization?.pincode || null,
      },
      subscription: subscriptionData,
    };
  }

  /**
   * Strictly masks Aadhaar number to XXXX-XXXX-1234.
   * Full 12-digit plaintext Aadhaar is NEVER returned.
   */
  private maskAadhaar(raw?: string | null): string {
    if (!raw) return 'Not Provided';
    const clean = raw.replace(/\D/g, '');
    if (clean.length >= 4) {
      return `XXXX-XXXX-${clean.slice(-4)}`;
    }
    return 'XXXX-XXXX-XXXX';
  }

  private formatDate(val?: Date | string | null): string {
    if (!val) return 'Not Specified';
    const d = new Date(val);
    if (isNaN(d.getTime())) return 'Not Specified';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private formatCurrency(val?: number | string | null): string {
    if (val === undefined || val === null || val === '') return '0.00';
    const num = Number(val);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Renders the complete statutory Customer Application Form using PDFKit.
   */
  private async renderPdf(data: CafPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: 24,
            bottom: 20,
            left: 32,
            right: 32,
          },
          autoFirstPage: true,
          bufferPages: true,
          info: {
            Title: `Customer Application Form - ${data.customerCode}`,
            Author: data.organization.name || 'ISPCRM',
            Subject: `Statutory CAF for ${data.name}`,
            Creator: 'ISPCRM Telecom Compliance Engine',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        this.renderCafDocument(doc, data);
        doc.end();
      } catch (err) {
        this.logger.error(`Error rendering CAF PDF for ${data.customerCode}: ${err}`);
        reject(err);
      }
    });
  }

  /**
   * PDFKit layout rendering engine for CAF
   */
  private renderCafDocument(doc: PDFKit.PDFDocument, data: CafPdfData) {
    const leftMargin = 32;
    const rightMargin = 563; // 595 - 32
    const pageWidth = rightMargin - leftMargin; // 531 pt

    // =========================================================================
    // 1. TOP HEADER & PASSPORT PHOTOGRAPH BOX
    // =========================================================================
    let currentY = 24;

    // Left Column: ISP Information & Title (Width: 420 pt)
    const orgLegalName = data.organization.legalName || data.organization.name || 'INTERNET SERVICE PROVIDER';
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(orgLegalName.toUpperCase(), leftMargin, currentY, { width: 418, lineBreak: true });
    const orgNameH = doc.heightOfString(orgLegalName.toUpperCase(), { width: 418 });
    let orgY = currentY + orgNameH + 2;

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e40af').text('LICENSED BROADBAND INTERNET SERVICE PROVIDER', leftMargin, orgY, { width: 418, lineBreak: false });
    orgY += 10;

    doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
    if (data.organization.address) {
      const cityState = [data.organization.city, data.organization.state, data.organization.pincode].filter(Boolean).join(', ');
      const fullOrgAddr = data.organization.address + (cityState ? `, ${cityState}` : '');
      doc.text(fullOrgAddr, leftMargin, orgY, { width: 418, lineBreak: true });
      orgY += doc.heightOfString(fullOrgAddr, { width: 418 }) + 2;
    }

    const orgContacts: string[] = [];
    if (data.organization.phone) orgContacts.push(`Helpline: ${data.organization.phone}`);
    if (data.organization.email) orgContacts.push(`Email: ${data.organization.email}`);
    if (orgContacts.length > 0) {
      doc.text(orgContacts.join('  •  '), leftMargin, orgY, { width: 418, lineBreak: false });
      orgY += 10;
    }

    const orgTaxDetails: string[] = [];
    if (data.organization.gstin) orgTaxDetails.push(`GSTIN: ${data.organization.gstin}`);
    if (data.organization.stateCode) orgTaxDetails.push(`State Code: ${data.organization.stateCode}`);
    if (orgTaxDetails.length > 0) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#334155').text(orgTaxDetails.join('  •  '), leftMargin, orgY, { width: 418, lineBreak: false });
      orgY += 10;
    }

    // Right Column: Official 35mm x 45mm Passport Photo Placeholder Box
    const photoBoxWidth = 96;
    const photoBoxHeight = 110;
    const photoBoxX = rightMargin - photoBoxWidth;
    const photoBoxY = 24;

    doc.roundedRect(photoBoxX, photoBoxY, photoBoxWidth, photoBoxHeight, 3)
      .lineWidth(0.75)
      .dash(3, { space: 2 })
      .strokeColor('#94a3b8')
      .stroke();
    doc.undash();

    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#64748b').text('AFFIX PASSPORT SIZE', photoBoxX + 4, photoBoxY + 36, { width: photoBoxWidth - 8, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#64748b').text('PHOTOGRAPH HERE', photoBoxX + 4, photoBoxY + 46, { width: photoBoxWidth - 8, align: 'center' });
    doc.font('Helvetica').fontSize(6).fillColor('#94a3b8').text('(35mm x 45mm)', photoBoxX + 4, photoBoxY + 57, { width: photoBoxWidth - 8, align: 'center' });
    doc.font('Helvetica-Oblique').fontSize(5.5).fillColor('#94a3b8').text('Self-Attested by Subscriber', photoBoxX + 4, photoBoxY + 70, { width: photoBoxWidth - 8, align: 'center' });

    currentY = Math.max(orgY, photoBoxY + photoBoxHeight) + 6;

    // =========================================================================
    // 2. DOCUMENT TITLE & REFERENCE HEADER BANNER
    // =========================================================================
    const bannerHeight = 20;
    doc.roundedRect(leftMargin, currentY, pageWidth, bannerHeight, 3).fill('#0f172a');

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff').text(
      'CUSTOMER APPLICATION FORM (CAF) & SERVICE AGREEMENT',
      leftMargin + 8,
      currentY + 5.5,
      { lineBreak: false },
    );

    const refRightText = `CAF REF: ${data.customerCode}   •   DATE: ${this.formatDate(new Date())}`;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#93c5fd').text(
      refRightText,
      leftMargin,
      currentY + 6,
      { width: pageWidth - 8, align: 'right', lineBreak: false },
    );

    currentY += bannerHeight + 6;

    // Helper to render section title bar
    const renderSectionHeader = (title: string) => {
      const headerH = 14;
      doc.rect(leftMargin, currentY, pageWidth, headerH).fill('#f1f5f9');
      doc.rect(leftMargin, currentY, pageWidth, headerH).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#1e293b').text(title, leftMargin + 6, currentY + 3.5, { lineBreak: false });
      currentY += headerH;
    };

    // Helper to render key-value grid row with border
    const renderGridRow = (cells: Array<{ label: string; value: string; width: number; isBold?: boolean }>, rowHeight: number) => {
      doc.rect(leftMargin, currentY, pageWidth, rowHeight).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
      let cellX = leftMargin;
      cells.forEach((cell, idx) => {
        if (idx > 0) {
          doc.moveTo(cellX, currentY).lineTo(cellX, currentY + rowHeight).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
        }
        doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(cell.label, cellX + 5, currentY + 3, { width: cell.width - 10, lineBreak: false });
        doc.font(cell.isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#0f172a').text(cell.value || '—', cellX + 5, currentY + 11.5, { width: cell.width - 10, lineBreak: false });
        cellX += cell.width;
      });
      currentY += rowHeight;
    };

    // =========================================================================
    // 3. SECTION 1: SUBSCRIBER IDENTITY & STATUTORY IDENTIFICATION
    // =========================================================================
    renderSectionHeader('1. SUBSCRIBER IDENTIFICATION & CONTACT INFORMATION');

    const colW3 = [177, 177, 177];
    renderGridRow([
      { label: 'Full Subscriber Name', value: data.name, width: colW3[0], isBold: true },
      { label: 'Customer Account / CAF No.', value: data.customerCode, width: colW3[1], isBold: true },
      { label: 'Subscriber Category', value: data.customerType === 'COMMERCIAL' ? 'Commercial / Enterprise' : 'Individual / Residential', width: colW3[2] },
    ], 24);

    renderGridRow([
      { label: 'Primary Mobile Number', value: data.mobile || 'Not Specified', width: colW3[0] },
      { label: 'Alternate Contact / Landline', value: data.alternatePhone || data.phone || 'None', width: colW3[1] },
      { label: 'Email Address', value: data.email || 'Not Provided', width: colW3[2] },
    ], 24);

    renderGridRow([
      { label: 'Aadhaar / KYC ID (Masked)', value: data.maskedAadhaar, width: colW3[0], isBold: true },
      { label: 'Customer GSTIN', value: data.gstin || 'Consumer / Unregistered', width: colW3[1] },
      { label: 'Account Subscription Status', value: data.status.toUpperCase(), width: colW3[2], isBold: true },
    ], 24);

    currentY += 5;

    // =========================================================================
    // 4. SECTION 2: PREMISE & INSTALLATION ADDRESS
    // =========================================================================
    renderSectionHeader('2. INSTALLATION PREMISE & BILLING ADDRESS DETAILS');

    const colWFull = [pageWidth];
    const instAddr = data.installationAddress || data.address || 'Same as Registered Billing Address';
    renderGridRow([
      { label: 'Physical Installation Premise Address (Broadband Termination Point)', value: instAddr, width: colWFull[0] },
    ], 24);

    const billAddr = data.address || 'Same as Installation Address';
    renderGridRow([
      { label: 'Permanent / Registered Billing Address', value: billAddr, width: colWFull[0] },
    ], 24);

    const colW4 = [132, 133, 133, 133];
    renderGridRow([
      { label: 'Area / Locality / Sector', value: data.area || 'Not Specified', width: colW4[0] },
      { label: 'City / District', value: data.city || 'Not Specified', width: colW4[1] },
      { label: 'State / Union Territory', value: data.state || 'Not Specified', width: colW4[2] },
      { label: 'PIN Code', value: data.pincode || 'Not Specified', width: colW4[3] },
    ], 24);

    currentY += 5;

    // =========================================================================
    // 5. SECTION 3: BROADBAND INTERNET SERVICE PLAN & COMMERCIAL TARIFF
    // =========================================================================
    renderSectionHeader('3. BROADBAND INTERNET SERVICE PLAN & COMMERCIAL TARIFF');

    if (data.subscription) {
      const sub = data.subscription;
      renderGridRow([
        { label: 'Subscribed Service Plan', value: sub.planName, width: colW3[0], isBold: true },
        { label: 'Allocated Bandwidth Speed', value: `${sub.downloadSpeedMbps} Mbps Down  /  ${sub.uploadSpeedMbps} Mbps Up`, width: colW3[1], isBold: true },
        { label: 'Billing Cycle & Validity', value: `${sub.billingCycle} (${sub.validityDays} Days)`, width: colW3[2] },
      ], 24);

      renderGridRow([
        { label: 'Base Plan Tariff (Rs.)', value: `Rs. ${this.formatCurrency(sub.price)}`, width: colW3[0] },
        { label: `Applicable GST (${sub.gstRatePercent}%)`, value: `Rs. ${this.formatCurrency(sub.gstAmount)}`, width: colW3[1] },
        { label: 'Total Tariff Payable (Incl. Tax)', value: `Rs. ${this.formatCurrency(sub.totalAmount)}`, width: colW3[2], isBold: true },
      ], 24);

      renderGridRow([
        { label: 'Service Commencement Date', value: this.formatDate(sub.startDate), width: colW3[0] },
        { label: 'Service Validity Expiration', value: this.formatDate(sub.endDate), width: colW3[1] },
        { label: 'Service Activation Status', value: sub.status.toUpperCase(), width: colW3[2] },
      ], 24);
    } else {
      renderGridRow([
        { label: 'Broadband Service Plan', value: 'Plan assignment pending activation', width: colWFull[0] },
      ], 24);
    }

    currentY += 5;

    // =========================================================================
    // 6. SECTION 4: TECHNICAL & NETWORK PROVISIONING SPECIFICATIONS
    // =========================================================================
    renderSectionHeader('4. TECHNICAL NETWORK & HARDWARE SPECIFICATIONS');

    renderGridRow([
      { label: 'PPPoE Dial-in Username', value: data.username || data.pppoeUsername || 'Assigned upon activation', width: colW3[0], isBold: true },
      { label: 'IPv4 Address Assignment', value: data.staticIp ? `Static IP: ${data.staticIp}` : 'Dynamic Broadband Pool (Framed-Pool)', width: colW3[1] },
      { label: 'Authorized Device MAC Address', value: data.macAddress || 'Auto-Learn on First Dial-in (Open Hardware Pool)', width: colW3[2] },
    ], 24);

    renderGridRow([
      { label: 'Broadband Installation Date', value: this.formatDate(data.installationDate), width: colW3[0] },
      { label: 'Subscriber Record Created', value: this.formatDate(data.createdAt), width: colW3[1] },
      { label: 'Authentication Architecture', value: 'Centralized FreeRADIUS AAA (RFC 2865 / 3576)', width: colW3[2] },
    ], 24);

    currentY += 6;

    // =========================================================================
    // 7. SECTION 5: STATUTORY DECLARATION & TERMS ACKNOWLEDGEMENT
    // =========================================================================
    renderSectionHeader('5. STATUTORY APPLICANT DECLARATION & UNDERTAKING');

    const declBoxH = 68;
    doc.rect(leftMargin, currentY, pageWidth, declBoxH).fill('#f8fafc');
    doc.rect(leftMargin, currentY, pageWidth, declBoxH).lineWidth(0.5).strokeColor('#cbd5e1').stroke();

    const declTextY = currentY + 4;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#1e293b').text('SUBSCRIBER DECLARATION & TERMS OF SERVICE:', leftMargin + 6, declTextY, { lineBreak: false });

    const terms = [
      '1. I/We hereby apply for broadband internet access service and confirm that all details furnished in this application are true and correct.',
      '2. The broadband connection shall be utilized strictly for lawful purposes and in adherence to applicable telecommunications regulations, including the Indian Telegraph Act, 1885 and Information Technology Act, 2000.',
      '3. I/We agree not to establish any unauthorized voice/data resale, bypass gateway, or transmit prohibited/objectionable material.',
      '4. Any Customer Premise Equipment (ONT/Router) provided on rental/loan remains ISP property and shall be surrendered upon disconnection.',
      '5. I/We understand that identity and installation premise records are maintained for statutory telecom regulatory compliance.',
    ];

    let tY = declTextY + 10;
    doc.font('Helvetica').fontSize(5.8).fillColor('#475569');
    terms.forEach((line) => {
      doc.text(line, leftMargin + 6, tY, { width: pageWidth - 12, lineBreak: false });
      tY += 9;
    });

    currentY += declBoxH + 6;

    // =========================================================================
    // 8. SECTION 6: DUAL SIGNATURE & VERIFICATION BLOCK
    // =========================================================================
    const signBoxW = 260;
    const signBoxH = 68;
    const rightSignX = rightMargin - signBoxW; // 563 - 260 = 303

    // Left Box: Applicant Signature
    doc.rect(leftMargin, currentY, signBoxW, signBoxH).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#334155').text('APPLICANT / SUBSCRIBER SIGNATURE', leftMargin + 6, currentY + 4, { lineBreak: false });
    doc.moveTo(leftMargin + 10, currentY + 42).lineTo(leftMargin + signBoxW - 10, currentY + 42).lineWidth(0.5).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#0f172a').text(data.name, leftMargin + 10, currentY + 46, { width: signBoxW - 20, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(6).fillColor('#64748b').text('Date: _______________   Place: _______________', leftMargin + 10, currentY + 56, { width: signBoxW - 20, align: 'center', lineBreak: false });

    // Right Box: ISP Authorized Signatory
    doc.rect(rightSignX, currentY, signBoxW, signBoxH).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    const orgSignTitle = `FOR ${data.organization.name.toUpperCase()} (AUTHORIZED SIGNATORY)`;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#334155').text(orgSignTitle, rightSignX + 6, currentY + 4, { width: signBoxW - 12, lineBreak: false });
    doc.moveTo(rightSignX + 10, currentY + 42).lineTo(rightSignX + signBoxW - 10, currentY + 42).lineWidth(0.5).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#0f172a').text('Authorized ISP Representative & Verification Officer', rightSignX + 10, currentY + 46, { width: signBoxW - 20, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(6).fillColor('#64748b').text('Date: _______________   Official Rubber Stamp Here', rightSignX + 10, currentY + 56, { width: signBoxW - 20, align: 'center', lineBreak: false });

    currentY += signBoxH + 6;

    // =========================================================================
    // 9. BOTTOM FOOTER (Never Advances Page)
    // =========================================================================
    const footerDividerY = 804;
    const footerLine1Y = 810;
    const footerLine2Y = 820;

    doc.moveTo(leftMargin, footerDividerY).lineTo(rightMargin, footerDividerY).lineWidth(0.5).strokeColor('#cbd5e1').stroke();

    doc.font('Helvetica').fontSize(6.5).fillColor('#64748b');
    const footerText = [
      `CAF Ref: ${data.customerCode}`,
      `Generated: ${new Date().toLocaleDateString('en-IN')}`,
      `Helpline: ${data.organization.phone || 'ISP Support'}`,
      `Email: ${data.organization.email || 'support@ispcrm'}`,
    ].join('  •  ');

    doc.text(footerText, leftMargin, footerLine1Y, { width: pageWidth, align: 'center', lineBreak: false });

    doc.font('Helvetica').fontSize(6).fillColor('#94a3b8');
    doc.text(
      'Page 1 of 1  •  Statutory Customer Application Form & KYC Verification Document  •  Confidential & Proprietary',
      leftMargin,
      footerLine2Y,
      { width: pageWidth, align: 'center', lineBreak: false },
    );
  }
}
