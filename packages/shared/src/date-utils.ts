import { BillingCycle } from './enums';
import { DEFAULT_TIMEZONE } from './constants';

/**
 * Checks if a given year is a leap year.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the number of days in a given year and month (1-indexed: 1 = Jan, 12 = Dec).
 */
export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * Extracts parts of a Date in a specific timezone.
 */
export function getDatePartsInTimezone(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): {
  year: number;
  month: number; // 1-indexed (1-12)
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      partMap[part.type] = parseInt(part.value, 10);
    }
  }

  return {
    year: partMap.year,
    month: partMap.month,
    day: partMap.day,
    hour: partMap.hour === 24 ? 0 : partMap.hour,
    minute: partMap.minute,
    second: partMap.second,
    millisecond: date.getUTCMilliseconds(),
  };
}

/**
 * Construct a UTC Date from components representing local time in a specified timezone.
 */
export function createDateInTimezone(
  year: number,
  month: number, // 1-indexed (1-12)
  day: number,
  hour: number = 0,
  minute: number = 0,
  second: number = 0,
  millisecond: number = 0,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  // Format target date as ISO string assuming UTC first
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  const paddedHour = String(hour).padStart(2, '0');
  const paddedMin = String(minute).padStart(2, '0');
  const paddedSec = String(second).padStart(2, '0');

  // Find offset for this timezone at this approximate time
  const approximateUtc = new Date(
    `${year}-${paddedMonth}-${paddedDay}T${paddedHour}:${paddedMin}:${paddedSec}Z`,
  );

  // Measure difference between target timezone and UTC
  const actualParts = getDatePartsInTimezone(approximateUtc, timeZone);
  const targetTime = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  ).getTime();
  const actualTime = new Date(
    Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
      actualParts.second,
      actualParts.millisecond,
    ),
  ).getTime();

  const diffMs = actualTime - targetTime;
  return new Date(approximateUtc.getTime() - diffMs);
}

/**
 * Calculate subscription end date based on billing cycle, validity days, and timezone.
 * Handles month-end clamping (e.g. Jan 31 -> Feb 28/29, Aug 31 -> Sep 30) and leap years accurately.
 */
export function calculateSubscriptionEndDate(
  startDate: Date,
  billingCycle: BillingCycle | string = BillingCycle.MONTHLY,
  validityDays: number = 30,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  if (billingCycle === BillingCycle.CUSTOM) {
    return new Date(startDate.getTime() + validityDays * 24 * 60 * 60 * 1000);
  }

  const parts = getDatePartsInTimezone(startDate, timeZone);
  let monthsToAdd = 1;

  switch (billingCycle) {
    case BillingCycle.MONTHLY:
      monthsToAdd = 1;
      break;
    case BillingCycle.QUARTERLY:
      monthsToAdd = 3;
      break;
    case BillingCycle.HALF_YEARLY:
      monthsToAdd = 6;
      break;
    case BillingCycle.ANNUAL:
      monthsToAdd = 12;
      break;
    default:
      monthsToAdd = 1;
  }

  let targetYear = parts.year;
  let targetMonth = parts.month + monthsToAdd;

  while (targetMonth > 12) {
    targetYear += 1;
    targetMonth -= 12;
  }

  // Month-end clamping: If original day exceeds days in target month, clamp to last day of target month
  const maxDaysInTargetMonth = getDaysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(parts.day, maxDaysInTargetMonth);

  return createDateInTimezone(
    targetYear,
    targetMonth,
    targetDay,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
    timeZone,
  );
}

/**
 * Calculate the end date of the grace period.
 */
export function calculateGracePeriodEndDate(
  endDate: Date,
  gracePeriodDays: number = 3,
): Date {
  return new Date(endDate.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
}

/**
 * Evaluates whether a subscription is currently ACTIVE, GRACE, or EXPIRED.
 */
export function evaluateSubscriptionStatusByDates(
  endDate: Date,
  gracePeriodDays: number = 3,
  now: Date = new Date(),
): 'ACTIVE' | 'GRACE' | 'EXPIRED' {
  if (now <= endDate) {
    return 'ACTIVE';
  }

  const graceEndDate = calculateGracePeriodEndDate(endDate, gracePeriodDays);
  if (now <= graceEndDate) {
    return 'GRACE';
  }

  return 'EXPIRED';
}
