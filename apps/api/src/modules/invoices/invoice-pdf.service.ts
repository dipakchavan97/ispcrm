import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { inrAmountToWords } from '@isp-crm/shared';

export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: Date | string;
  dueDate: Date | string;
  servicePeriodStart?: Date | string | null;
  servicePeriodEnd?: Date | string | null;
  status: string;
  source?: string | null;
  subtotal: string | number;
  discountAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  totalAmount: string | number;
  paidAmount?: string | number;
  balanceDue?: string | number;
  notes?: string | null;
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
    currency?: string | null;
  };
  customer: {
    name: string;
    customerCode: string;
    username?: string | null;
    pppoeUsername?: string | null;
    mobile?: string | null;
    email?: string | null;
    address?: string | null;
    installationAddress?: string | null;
    area?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    gstin?: string | null;
  };
  items: Array<{
    description: string;
    sacCode?: string;
    quantity: number;
    unitPrice: string | number;
    discountAmount?: string | number;
    taxRatePercent: string | number;
    taxAmount?: string | number;
    totalAmount: string | number;
  }>;
  payments?: Array<{
    receiptNumber: string;
    amount: string | number;
    paymentMethod: string;
    paidAt: Date | string;
  }>;
}

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  /**
   * Generates a professional Indian ISP GST Tax Invoice as an A4 PDF buffer.
   */
  async generatePdf(data: InvoicePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: 28,
            bottom: 20,
            left: 32,
            right: 32,
          },
          autoFirstPage: true,
          bufferPages: true,
          info: {
            Title: `Tax Invoice ${data.invoiceNumber}`,
            Author: data.organization.name || 'ISPCRM',
            Subject: `GST Tax Invoice for ${data.customer.name}`,
            Creator: 'ISPCRM Billing Engine',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const range = doc.bufferedPageRange();
          if (range.count > 1) {
            this.logger.warn(`Invoice PDF for ${data.invoiceNumber} spanned ${range.count} pages.`);
          }
          resolve(Buffer.concat(chunks));
        });
        doc.on('error', (err) => reject(err));

        this.renderInvoiceDocument(doc, data);
        doc.end();
      } catch (err) {
        this.logger.error(`Error generating PDF for invoice ${data.invoiceNumber}: ${err}`);
        reject(err);
      }
    });
  }

  private formatDate(val?: Date | string | null): string {
    if (!val) return 'Not recorded';
    const d = new Date(val);
    if (isNaN(d.getTime())) return 'Not recorded';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private formatCurrency(val?: string | number | null): string {
    if (val === undefined || val === null || val === '') return '0.00';
    const num = Number(val);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private formatSource(source?: string | null): string {
    switch (source) {
      case 'SUBSCRIPTION_RENEWAL':
        return 'Subscription Renewal';
      case 'SUBSCRIPTION_ASSIGNMENT':
        return 'Package Assignment';
      case 'PLAN_CHANGE':
        return 'Package Change';
      case 'MANUAL':
        return 'Manual Invoice';
      default:
        return source || 'Standard Billing';
    }
  }

  private renderInvoiceDocument(doc: PDFKit.PDFDocument, data: InvoicePdfData) {
    const leftMargin = 32;
    const rightMargin = 563; // 595 - 32
    const pageWidth = rightMargin - leftMargin; // 531pt

    // =========================================================================
    // 1. TOP HEADER & TAX INVOICE BADGE
    // =========================================================================
    let currentY = 28;

    // Organization Info (Left Column: width 320pt)
    const orgName = data.organization.legalName || data.organization.name || 'INTERNET SERVICE PROVIDER';
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(orgName.toUpperCase(), leftMargin, currentY, { width: 320, lineBreak: true });
    const orgNameHeight = doc.heightOfString(orgName.toUpperCase(), { width: 320 });
    let orgY = currentY + orgNameHeight + 3;

    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    if (data.organization.address) {
      const cityState = [data.organization.city, data.organization.state, data.organization.pincode].filter(Boolean).join(', ');
      const fullOrgAddr = data.organization.address + (cityState ? `, ${cityState}` : '');
      doc.text(fullOrgAddr, leftMargin, orgY, { width: 320, lineBreak: true });
      orgY += doc.heightOfString(fullOrgAddr, { width: 320 }) + 2;
    }

    const orgContacts: string[] = [];
    if (data.organization.phone) orgContacts.push(`Tel: ${data.organization.phone}`);
    if (data.organization.email) orgContacts.push(`Email: ${data.organization.email}`);
    if (orgContacts.length > 0) {
      doc.text(orgContacts.join('  |  '), leftMargin, orgY, { width: 320, lineBreak: false });
      orgY += 10;
    }

    const orgGstDetails: string[] = [];
    if (data.organization.gstin) orgGstDetails.push(`GSTIN: ${data.organization.gstin}`);
    if (data.organization.stateCode) orgGstDetails.push(`State Code: ${data.organization.stateCode}`);
    if (orgGstDetails.length > 0) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155').text(orgGstDetails.join('  |  '), leftMargin, orgY, { width: 320, lineBreak: false });
      orgY += 10;
    }

    // Right Column: TAX INVOICE Box (x: 365 to rightMargin = 563, width: 198pt)
    const rightBoxX = 365;
    const rightBoxWidth = rightMargin - rightBoxX;

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1e40af').text('TAX INVOICE', rightBoxX, 28, {
      width: rightBoxWidth,
      align: 'right',
      lineBreak: false,
    });

    let rightY = 47;
    doc.font('Helvetica').fontSize(8).fillColor('#334155');

    // Invoice No
    doc.font('Helvetica-Bold').text('Invoice No:', rightBoxX, rightY, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor('#0f172a').text(data.invoiceNumber, rightBoxX + 65, rightY, { width: rightBoxWidth - 65, align: 'right', lineBreak: false });
    rightY += 12;

    // Invoice Date
    doc.font('Helvetica').fillColor('#475569').text('Invoice Date:', rightBoxX, rightY, { lineBreak: false });
    doc.fillColor('#0f172a').text(this.formatDate(data.invoiceDate), rightBoxX + 65, rightY, { width: rightBoxWidth - 65, align: 'right', lineBreak: false });
    rightY += 12;

    // Due Date
    doc.font('Helvetica').fillColor('#475569').text('Due Date:', rightBoxX, rightY, { lineBreak: false });
    doc.fillColor('#0f172a').text(this.formatDate(data.dueDate), rightBoxX + 65, rightY, { width: rightBoxWidth - 65, align: 'right', lineBreak: false });
    rightY += 13;

    // Invoice Status Badge
    const statusText = (data.status || 'ISSUED').toUpperCase();
    let statusBg = '#e0f2fe';
    let statusFg = '#0369a1';
    if (statusText === 'PAID') {
      statusBg = '#dcfce7';
      statusFg = '#15803d';
    } else if (statusText === 'CANCELLED') {
      statusBg = '#fee2e2';
      statusFg = '#b91c1c';
    } else if (statusText === 'OVERDUE') {
      statusBg = '#ffedd5';
      statusFg = '#c2410c';
    }

    const badgeWidth = 80;
    const badgeHeight = 15;
    const badgeX = rightMargin - badgeWidth;
    doc.roundedRect(badgeX, rightY, badgeWidth, badgeHeight, 3).fill(statusBg);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(statusFg).text(statusText, badgeX, rightY + 3.5, {
      width: badgeWidth,
      align: 'center',
      lineBreak: false,
    });
    rightY += badgeHeight + 2;

    currentY = Math.max(orgY, rightY) + 5;

    // Divider
    doc.moveTo(leftMargin, currentY).lineTo(rightMargin, currentY).lineWidth(0.75).strokeColor('#cbd5e1').stroke();
    currentY += 6;

    // =========================================================================
    // 2. BILL TO & SERVICE PERIOD ROW
    // =========================================================================
    const rowStartY = currentY;

    // --- Left Box: BILL TO (Customer) ---
    const billToWidth = 265;
    let leftCustY = rowStartY;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748b').text('BILL TO / SUBSCRIBER DETAILS', leftMargin, leftCustY, { lineBreak: false });
    leftCustY += 10;

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a').text(data.customer.name, leftMargin, leftCustY, { width: billToWidth, lineBreak: true });
    leftCustY += doc.heightOfString(data.customer.name, { width: billToWidth }) + 2;

    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    const customerCodes = [
      `Customer Code: ${data.customer.customerCode}`,
      data.customer.username ? `Username: ${data.customer.username}` : null,
    ].filter(Boolean).join('  |  ');
    doc.text(customerCodes, leftMargin, leftCustY, { width: billToWidth, lineBreak: true });
    leftCustY += doc.heightOfString(customerCodes, { width: billToWidth }) + 2;

    if (data.customer.mobile || data.customer.email) {
      const contactLine = [data.customer.mobile ? `Mobile: ${data.customer.mobile}` : null, data.customer.email ? `Email: ${data.customer.email}` : null].filter(Boolean).join('  |  ');
      doc.text(contactLine, leftMargin, leftCustY, { width: billToWidth, lineBreak: true });
      leftCustY += doc.heightOfString(contactLine, { width: billToWidth }) + 2;
    }

    const address = data.customer.installationAddress || data.customer.address;
    if (address) {
      const fullAddr = [address, data.customer.area, data.customer.city, data.customer.state, data.customer.pincode].filter(Boolean).join(', ');
      const addrLine = `Address: ${fullAddr}`;
      doc.text(addrLine, leftMargin, leftCustY, { width: billToWidth, lineBreak: true });
      leftCustY += doc.heightOfString(addrLine, { width: billToWidth }) + 2;
    }

    if (data.customer.gstin) {
      doc.font('Helvetica-Bold').text(`Customer GSTIN: ${data.customer.gstin}`, leftMargin, leftCustY, { width: billToWidth, lineBreak: false });
      leftCustY += 10;
    }

    // --- Right Box: SERVICE VALIDITY & BILLING DETAILS ---
    const serviceBoxX = leftMargin + billToWidth + 12; // 32 + 265 + 12 = 309
    const serviceBoxWidth = rightMargin - serviceBoxX; // 563 - 309 = 254
    let rightServiceY = rowStartY;

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748b').text('SERVICE VALIDITY & BILLING DETAILS', serviceBoxX, rightServiceY, { lineBreak: false });
    rightServiceY += 10;

    // Prominent Highlighted Service Period Box
    const hasServicePeriod = Boolean(data.servicePeriodStart && data.servicePeriodEnd);
    const servicePeriodStr = hasServicePeriod
      ? `${this.formatDate(data.servicePeriodStart)} to ${this.formatDate(data.servicePeriodEnd)}`
      : 'Service Period: Not recorded';

    const periodBoxHeight = 32;
    doc.roundedRect(serviceBoxX, rightServiceY, serviceBoxWidth, periodBoxHeight, 4).fillAndStroke('#eff6ff', '#bfdbfe');

    doc.font('Helvetica-Bold').fontSize(7).fillColor('#1d4ed8').text('SERVICE / BILLING PERIOD', serviceBoxX + 8, rightServiceY + 4, { width: serviceBoxWidth - 16, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1e3a8a').text(servicePeriodStr, serviceBoxX + 8, rightServiceY + 15, { width: serviceBoxWidth - 16, lineBreak: false });
    rightServiceY += periodBoxHeight + 5;

    // Billing Metadata rows
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text('Billing Source:', serviceBoxX, rightServiceY, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor('#0f172a').text(this.formatSource(data.source), serviceBoxX + 75, rightServiceY, { width: serviceBoxWidth - 75, lineBreak: false });
    rightServiceY += 11;

    doc.font('Helvetica').fillColor('#475569').text('Place of Supply:', serviceBoxX, rightServiceY, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor('#0f172a').text(data.customer.state || data.organization.state || 'Maharashtra (27)', serviceBoxX + 75, rightServiceY, { width: serviceBoxWidth - 75, lineBreak: false });
    rightServiceY += 11;

    currentY = Math.max(leftCustY, rightServiceY) + 5;

    // Divider
    doc.moveTo(leftMargin, currentY).lineTo(rightMargin, currentY).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    currentY += 6;

    // =========================================================================
    // 3. LINE ITEMS TABLE (Robust Dynamic Row Height & Zero Overlap)
    // =========================================================================
    const colX = {
      sr: leftMargin, // 32
      desc: leftMargin + 18, // 50
      sac: leftMargin + 194, // 226
      period: leftMargin + 236, // 268
      qty: leftMargin + 324, // 356
      rate: leftMargin + 348, // 380
      taxable: leftMargin + 398, // 430
      total: leftMargin + 454, // 486
    };
    const colW = {
      sr: 18,
      desc: 176,
      sac: 42,
      period: 88,
      qty: 24,
      rate: 50,
      taxable: 56,
      total: 77,
    };

    // Table Header
    const tableHeaderHeight = 18;
    doc.rect(leftMargin, currentY, pageWidth, tableHeaderHeight).fill('#f1f5f9');
    doc.rect(leftMargin, currentY, pageWidth, tableHeaderHeight).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(7).fillColor('#334155');
    doc.text('#', colX.sr, currentY + 5, { width: colW.sr, align: 'center', lineBreak: false });
    doc.text('DESCRIPTION & SERVICE PLAN', colX.desc, currentY + 5, { width: colW.desc, lineBreak: false });
    doc.text('SAC', colX.sac, currentY + 5, { width: colW.sac, align: 'center', lineBreak: false });
    doc.text('SERVICE PERIOD', colX.period, currentY + 5, { width: colW.period, align: 'center', lineBreak: false });
    doc.text('QTY', colX.qty, currentY + 5, { width: colW.qty, align: 'center', lineBreak: false });
    doc.text('RATE (Rs.)', colX.rate, currentY + 5, { width: colW.rate, align: 'right', lineBreak: false });
    doc.text('TAXABLE', colX.taxable, currentY + 5, { width: colW.taxable, align: 'right', lineBreak: false });
    doc.text('TOTAL (Rs.)', colX.total, currentY + 5, { width: colW.total - 4, align: 'right', lineBreak: false });
    currentY += tableHeaderHeight;

    // Table Rows
    const items = data.items && data.items.length > 0 ? data.items : [
      {
        description: 'Broadband Internet Service',
        sacCode: '998422',
        quantity: 1,
        unitPrice: data.subtotal,
        discountAmount: data.discountAmount || 0,
        taxRatePercent: 18,
        totalAmount: data.totalAmount,
      },
    ];

    items.forEach((item, index) => {
      // 1. Calculate Description Heights dynamically
      doc.font('Helvetica-Bold').fontSize(8);
      const descTitleHeight = doc.heightOfString(item.description, { width: colW.desc });
      doc.font('Helvetica').fontSize(6.8);
      const subText = 'Telecommunication & Internet Access';
      const descSubHeight = doc.heightOfString(subText, { width: colW.desc });
      const totalDescHeight = descTitleHeight + 2 + descSubHeight;

      // 2. Format Service Period as clean compact two lines if present
      let periodLine1 = 'N/A';
      let periodLine2 = '';
      if (hasServicePeriod) {
        periodLine1 = this.formatDate(data.servicePeriodStart);
        periodLine2 = `to ${this.formatDate(data.servicePeriodEnd)}`;
      }

      // 3. Determine actual row height from longest cell with padding
      const contentHeight = Math.max(totalDescHeight, 18);
      const paddingTop = 4;
      const paddingBottom = 4;
      const itemRowHeight = contentHeight + paddingTop + paddingBottom;

      const isAlt = index % 2 === 1;
      if (isAlt) {
        doc.rect(leftMargin, currentY, pageWidth, itemRowHeight).fill('#fafafa');
      }
      doc.rect(leftMargin, currentY, pageWidth, itemRowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

      // #
      doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
      doc.text(String(index + 1), colX.sr, currentY + paddingTop + 1, { width: colW.sr, align: 'center', lineBreak: false });

      // Description (Title + Subtitle with zero overlap)
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
      doc.text(item.description, colX.desc, currentY + paddingTop, { width: colW.desc, lineBreak: true });
      doc.font('Helvetica').fontSize(6.8).fillColor('#64748b');
      doc.text(subText, colX.desc, currentY + paddingTop + descTitleHeight + 2, { width: colW.desc, lineBreak: true });

      // SAC
      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      doc.text(item.sacCode || '998422', colX.sac, currentY + paddingTop + 1, { width: colW.sac, align: 'center', lineBreak: false });

      // Service Period (compact 2 lines, no collision)
      doc.font('Helvetica').fontSize(7).fillColor('#0284c7');
      doc.text(periodLine1, colX.period, currentY + paddingTop, { width: colW.period, align: 'center', lineBreak: false });
      if (periodLine2) {
        doc.text(periodLine2, colX.period, currentY + paddingTop + 8.5, { width: colW.period, align: 'center', lineBreak: false });
      }

      // Qty
      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      doc.text(String(item.quantity || 1), colX.qty, currentY + paddingTop + 1, { width: colW.qty, align: 'center', lineBreak: false });

      // Rate
      doc.text(this.formatCurrency(item.unitPrice), colX.rate, currentY + paddingTop + 1, { width: colW.rate, align: 'right', lineBreak: false });

      // Taxable
      const taxable = Number(item.unitPrice) * Number(item.quantity || 1) - Number(item.discountAmount || 0);
      doc.text(this.formatCurrency(taxable), colX.taxable, currentY + paddingTop + 1, { width: colW.taxable, align: 'right', lineBreak: false });

      // Total
      doc.font('Helvetica-Bold').text(this.formatCurrency(item.totalAmount), colX.total, currentY + paddingTop + 1, { width: colW.total - 4, align: 'right', lineBreak: false });

      currentY += itemRowHeight;
    });

    currentY += 6;

    // =========================================================================
    // 4. TAX BREAKDOWN & GRAND TOTAL (Side by Side)
    // =========================================================================
    const summaryStartY = currentY;

    // --- Left: Amount in Words & Payment Settlement ---
    const leftSummaryWidth = 285;

    // Amount In Words Box (Dynamically sized)
    const words = inrAmountToWords(data.totalAmount);
    doc.font('Helvetica-Bold').fontSize(8);
    const wordsHeight = doc.heightOfString(words, { width: leftSummaryWidth - 16 });
    const wordsBoxHeight = Math.max(30, 14 + wordsHeight + 5);

    doc.roundedRect(leftMargin, summaryStartY, leftSummaryWidth, wordsBoxHeight, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text('AMOUNT IN WORDS (INR):', leftMargin + 8, summaryStartY + 4, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(words, leftMargin + 8, summaryStartY + 13, { width: leftSummaryWidth - 16, lineBreak: true });

    // Payment Settlement Status Box (Starts strictly below amount in words box)
    const payBoxY = summaryStartY + wordsBoxHeight + 5;
    const payBoxHeight = 28;
    const isPaid = (data.status || '').toUpperCase() === 'PAID';

    if (isPaid) {
      doc.roundedRect(leftMargin, payBoxY, leftSummaryWidth, payBoxHeight, 4).fillAndStroke('#f0fdf4', '#86efac');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#166534').text('PAYMENT STATUS: PAID (SETTLED)', leftMargin + 8, payBoxY + 5, { lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor('#15803d').text(`Paid Amount: Rs. ${this.formatCurrency(data.paidAmount || data.totalAmount)}  |  Balance Due: Rs. 0.00`, leftMargin + 8, payBoxY + 15, { lineBreak: false });
    } else {
      doc.roundedRect(leftMargin, payBoxY, leftSummaryWidth, payBoxHeight, 4).fillAndStroke('#fffbeb', '#fde68a');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#92400e').text('PAYMENT STATUS: PENDING', leftMargin + 8, payBoxY + 5, { lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor('#b45309').text(`Amount Due: Rs. ${this.formatCurrency(data.balanceDue || data.totalAmount)}  |  Due Date: ${this.formatDate(data.dueDate)}`, leftMargin + 8, payBoxY + 15, { lineBreak: false });
    }

    const leftSideBottom = payBoxY + payBoxHeight;

    // --- Right: Financial Tax Summary ---
    const summaryRightX = 350;
    const summaryRightW = rightMargin - summaryRightX; // 563 - 350 = 213
    let sumY = summaryStartY;

    const renderSummaryRow = (label: string, amount: string | number, isBold: boolean = false, isAccent: boolean = false) => {
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(isAccent ? '#1e40af' : '#475569');
      doc.text(label, summaryRightX, sumY, { lineBreak: false });
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').text(`Rs. ${this.formatCurrency(amount)}`, summaryRightX + 90, sumY, {
        width: summaryRightW - 90,
        align: 'right',
        lineBreak: false,
      });
      sumY += 12;
    };

    renderSummaryRow('Taxable Amount:', data.subtotal);

    if (Number(data.discountAmount || 0) > 0) {
      renderSummaryRow('Discount:', `-${this.formatCurrency(data.discountAmount)}`);
    }

    const hasCgst = Number(data.cgstAmount || 0) > 0;
    const hasSgst = Number(data.sgstAmount || 0) > 0;
    const hasIgst = Number(data.igstAmount || 0) > 0;

    if (hasCgst || hasSgst) {
      renderSummaryRow('CGST (9%):', data.cgstAmount || '0.00');
      renderSummaryRow('SGST (9%):', data.sgstAmount || '0.00');
    } else if (hasIgst) {
      renderSummaryRow('IGST (18%):', data.igstAmount || '0.00');
    } else {
      const taxHalf = (Number(data.totalAmount) - Number(data.subtotal)) / 2;
      renderSummaryRow('CGST (9%):', taxHalf > 0 ? taxHalf : '0.00');
      renderSummaryRow('SGST (9%):', taxHalf > 0 ? taxHalf : '0.00');
    }

    // Grand Total Highlight Card
    sumY += 3;
    const totalBoxH = 24;
    doc.roundedRect(summaryRightX - 4, sumY, summaryRightW + 4, totalBoxH, 4).fillAndStroke('#f1f5f9', '#94a3b8');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('TOTAL AMOUNT:', summaryRightX + 4, sumY + 7, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e40af').text(`Rs. ${this.formatCurrency(data.totalAmount)}`, summaryRightX + 90, sumY + 6, {
      width: summaryRightW - 94,
      align: 'right',
      lineBreak: false,
    });
    sumY += totalBoxH + 4;

    currentY = Math.max(leftSideBottom, sumY) + 8;

    // Prevent body content from ever spilling into the footer area
    if (currentY > 745) {
      currentY = 745;
    }

    // =========================================================================
    // 5. TERMS & CONDITIONS & SIGNATORY
    // =========================================================================
    doc.moveTo(leftMargin, currentY).lineTo(rightMargin, currentY).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    currentY += 6;

    const termsWidth = 330;
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text('TERMS & CONDITIONS', leftMargin, currentY, { lineBreak: false });
    currentY += 9;

    const terms = [
      '1. Payment is strictly due on or before the due date specified on this invoice.',
      '2. Internet service validity corresponds strictly to the indicated Service Period.',
      '3. In accordance with TRAI regulations, broadband speed is provided as per chosen bandwidth tier.',
      '4. Any disputes regarding this invoice must be communicated in writing within 7 calendar days.',
    ];
    doc.font('Helvetica').fontSize(6.5).fillColor('#64748b');
    terms.forEach((t) => {
      doc.text(t, leftMargin, currentY, { width: termsWidth, lineBreak: false });
      currentY += 8;
    });

    // Right Side: Authorized Signatory block (Aligned with terms top)
    const signX = 390;
    const signY = currentY - 35;
    const signWidth = rightMargin - signX;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b').text(`For ${orgName}`, signX, signY, { width: signWidth, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('[Computer Generated Invoice]', signX, signY + 16, { width: signWidth, align: 'center', lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#94a3b8').text('No physical signature required', signX, signY + 25, { width: signWidth, align: 'center', lineBreak: false });

    // =========================================================================
    // 6. BOTTOM FOOTER (Fixed to Safe Bottom Area - Never Advances Page)
    // =========================================================================
    const footerDividerY = 794;
    const footerLine1Y = 800;
    const footerLine2Y = 810;

    doc.moveTo(leftMargin, footerDividerY).lineTo(rightMargin, footerDividerY).lineWidth(0.5).strokeColor('#cbd5e1').stroke();

    doc.font('Helvetica').fontSize(6.8).fillColor('#64748b');
    const contactFooter = [
      `Support: ${data.organization.phone || 'ISP Helpdesk'}`,
      `Email: ${data.organization.email || 'support@ispcrm'}`,
      `Invoice Ref: ${data.invoiceNumber}`,
      `Generated: ${new Date().toLocaleDateString('en-IN')}`,
    ].join('  •  ');

    doc.text(contactFooter, leftMargin, footerLine1Y, { width: pageWidth, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8');
    doc.text('Page 1 of 1  •  This document is valid under Section 31 of the Central Goods and Services Tax Act, 2017', leftMargin, footerLine2Y, {
      width: pageWidth,
      align: 'center',
      lineBreak: false,
    });
  }
}
