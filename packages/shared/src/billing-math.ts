import { Decimal } from 'decimal.js';
import { InvoiceStatus } from './enums';

// Configure Decimal for financial calculations: 20 digits precision, standard rounding
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface BillingLineItemInput {
  description: string;
  sacCode?: string;
  quantity: number;
  unitPrice: Decimal.Value;
  discountAmount?: Decimal.Value;
  taxRatePercent?: Decimal.Value;
}

export interface CalculatedLineItem {
  description: string;
  sacCode: string;
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  grossAmount: string;
  taxableAmount: string;
  taxRatePercent: string;
  taxAmount: string;
  totalAmount: string;
}

export interface InvoiceCalculationResult {
  items: CalculatedLineItem[];
  subtotal: string;
  discountAmount: string;
  taxableSubtotal: string;
  isIntraState: boolean;
  cgstRatePercent: string;
  cgstAmount: string;
  sgstRatePercent: string;
  sgstAmount: string;
  igstRatePercent: string;
  igstAmount: string;
  totalTaxAmount: string;
  totalAmount: string;
  balanceDue: string;
}

/**
 * Ensures value is converted to arbitrary-precision Decimal with 2 decimal places.
 */
export function toMoneyDecimal(val: Decimal.Value | null | undefined): Decimal {
  if (val === null || val === undefined || val === '') {
    return new Decimal(0);
  }
  return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Returns fixed 2 decimal string representation for money.
 */
export function formatMoney(val: Decimal.Value | null | undefined): string {
  return toMoneyDecimal(val).toFixed(2);
}

/**
 * Pure calculation of line item financials using Decimal math.
 */
export function calculateLineItem(item: BillingLineItemInput): CalculatedLineItem {
  const qty = new Decimal(item.quantity || 1);
  const unitPrice = toMoneyDecimal(item.unitPrice);
  const discount = toMoneyDecimal(item.discountAmount || 0);
  const taxRate = new Decimal(item.taxRatePercent !== undefined ? item.taxRatePercent : 18.0);

  const grossAmount = unitPrice.times(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  // Discount cannot exceed gross
  const effectiveDiscount = discount.gt(grossAmount) ? grossAmount : discount;
  const taxableAmount = grossAmount.minus(effectiveDiscount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const taxAmount = taxableAmount.times(taxRate).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const totalAmount = taxableAmount.plus(taxAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    description: item.description,
    sacCode: item.sacCode || '998422',
    quantity: qty.toNumber(),
    unitPrice: unitPrice.toFixed(2),
    discountAmount: effectiveDiscount.toFixed(2),
    grossAmount: grossAmount.toFixed(2),
    taxableAmount: taxableAmount.toFixed(2),
    taxRatePercent: taxRate.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
}

/**
 * Comprehensive invoice totals calculation supporting SAC 998422,
 * Intra-state (CGST 9% + SGST 9%) vs Inter-state (IGST 18%), item & invoice discounts.
 */
export function calculateInvoiceTotals(params: {
  items: BillingLineItemInput[];
  invoiceDiscountAmount?: Decimal.Value;
  isIntraState?: boolean;
  defaultTaxRatePercent?: Decimal.Value;
}): InvoiceCalculationResult {
  const isIntraState = params.isIntraState !== false; // default true (intra-state)
  const defaultTaxRate = new Decimal(params.defaultTaxRatePercent !== undefined ? params.defaultTaxRatePercent : 18.0);

  const calculatedItems = params.items.map((item) => {
    return calculateLineItem({
      ...item,
      taxRatePercent: item.taxRatePercent !== undefined ? item.taxRatePercent : defaultTaxRate,
    });
  });

  // Calculate Subtotal (sum of taxable amounts of all items)
  let rawSubtotal = new Decimal(0);
  for (const item of calculatedItems) {
    rawSubtotal = rawSubtotal.plus(new Decimal(item.taxableAmount));
  }
  const subtotal = rawSubtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // Invoice level discount
  const reqInvoiceDiscount = toMoneyDecimal(params.invoiceDiscountAmount || 0);
  const effectiveInvoiceDiscount = reqInvoiceDiscount.gt(subtotal) ? subtotal : reqInvoiceDiscount;
  const taxableSubtotal = subtotal.minus(effectiveInvoiceDiscount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  let cgstRate = new Decimal(0);
  let cgstAmount = new Decimal(0);
  let sgstRate = new Decimal(0);
  let sgstAmount = new Decimal(0);
  let igstRate = new Decimal(0);
  let igstAmount = new Decimal(0);

  if (isIntraState) {
    cgstRate = defaultTaxRate.dividedBy(2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    sgstRate = defaultTaxRate.dividedBy(2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    cgstAmount = taxableSubtotal.times(cgstRate).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    sgstAmount = taxableSubtotal.times(sgstRate).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  } else {
    igstRate = defaultTaxRate;
    igstAmount = taxableSubtotal.times(igstRate).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  const totalTaxAmount = cgstAmount.plus(sgstAmount).plus(igstAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const totalAmount = taxableSubtotal.plus(totalTaxAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    items: calculatedItems,
    subtotal: subtotal.toFixed(2),
    discountAmount: effectiveInvoiceDiscount.toFixed(2),
    taxableSubtotal: taxableSubtotal.toFixed(2),
    isIntraState,
    cgstRatePercent: cgstRate.toFixed(2),
    cgstAmount: cgstAmount.toFixed(2),
    sgstRatePercent: sgstRate.toFixed(2),
    sgstAmount: sgstAmount.toFixed(2),
    igstRatePercent: igstRate.toFixed(2),
    igstAmount: igstAmount.toFixed(2),
    totalTaxAmount: totalTaxAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    balanceDue: totalAmount.toFixed(2),
  };
}

export interface PaymentSettlementResult {
  paymentAmount: string;
  previousPaidAmount: string;
  newPaidAmount: string;
  balanceDue: string;
  targetStatus: InvoiceStatus;
  isFullyPaid: boolean;
}

/**
 * Calculates new payment settlement and verifies no overpayment.
 */
export function calculatePaymentSettlement(params: {
  totalAmount: Decimal.Value;
  currentPaidAmount: Decimal.Value;
  paymentAmount: Decimal.Value;
}): PaymentSettlementResult {
  const total = toMoneyDecimal(params.totalAmount);
  const currentPaid = toMoneyDecimal(params.currentPaidAmount || 0);
  const payment = toMoneyDecimal(params.paymentAmount);

  if (payment.lte(0)) {
    throw new Error('Payment amount must be greater than zero');
  }

  const existingBalance = total.minus(currentPaid).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  if (payment.gt(existingBalance)) {
    throw new Error(
      `Payment amount (₹${payment.toFixed(2)}) exceeds outstanding balance due (₹${existingBalance.toFixed(2)})`,
    );
  }

  const newPaid = currentPaid.plus(payment).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const remainingBalance = total.minus(newPaid).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const isFullyPaid = remainingBalance.lte(0);

  return {
    paymentAmount: payment.toFixed(2),
    previousPaidAmount: currentPaid.toFixed(2),
    newPaidAmount: newPaid.toFixed(2),
    balanceDue: remainingBalance.toFixed(2),
    targetStatus: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
    isFullyPaid,
  };
}
