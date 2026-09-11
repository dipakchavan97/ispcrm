import crypto from 'node:crypto';

/**
 * Supported Notification Event Types
 */
export enum NotificationEventType {
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_RENEWED = 'SUBSCRIPTION_RENEWED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  SUSPENSION_WARNING = 'SUSPENSION_WARNING',
}

/**
 * Payload Structure for System & Subscriber Notification Events
 */
export interface NotificationEvent {
  id: string;
  type: NotificationEventType | string;
  organizationId: string;
  customerId: string;
  subscriptionId?: string;
  recipient: {
    name: string;
    username: string;
    email?: string | null;
    mobile?: string | null;
  };
  subject: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

/**
 * Payload for BullMQ Subscription Automation Jobs
 */
export interface SubscriptionAutomationJobData {
  type: 'EXPIRY_CHECK' | 'EXPIRE_SUBSCRIPTION' | 'PAYMENT_RENEWAL';
  organizationId?: string;
  subscriptionId?: string;
  customerId?: string;
  invoiceId?: string;
  paymentId?: string;
  idempotencyKey?: string;
  reason?: string;
}

/**
 * Result of automated expiration processing
 */
export interface ExpiryProcessingResult {
  processed: boolean;
  subscriptionId: string;
  customerId: string;
  status: 'EXPIRED' | 'ALREADY_EXPIRED' | 'SKIPPED' | 'ERROR';
  auditLogged: boolean;
  suspensionQueued: boolean;
  notificationSent: boolean;
  customerStatusUpdated: boolean;
  message?: string;
  timestamp: string;
}

/**
 * Result of automated payment renewal processing
 */
export interface RenewalProcessingResult {
  processed: boolean;
  invoiceId: string;
  subscriptionId?: string;
  customerId: string;
  status: 'RENEWED' | 'ALREADY_PAID' | 'SKIPPED' | 'ERROR';
  invoiceMarkedPaid: boolean;
  subscriptionRenewed: boolean;
  reactivationQueued: boolean;
  customerStatusUpdated: boolean;
  message?: string;
  timestamp: string;
}

/**
 * In-memory / Event bus handler for Notification Events
 */
export class NotificationEmitter {
  private static listeners: Array<(event: NotificationEvent) => void | Promise<void>> = [];
  public static eventHistory: NotificationEvent[] = [];

  /**
   * Dispatches a notification event to registered listeners and stores in history
   */
  static async emit(event: Omit<NotificationEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): Promise<NotificationEvent> {
    const fullEvent: NotificationEvent = {
      id: event.id || `notif_${crypto.randomUUID()}`,
      timestamp: event.timestamp || new Date().toISOString(),
      ...event,
    };

    console.log(
      `[NotificationEmitter] [${fullEvent.type}] to ${fullEvent.recipient.username} (${fullEvent.recipient.name}): ${fullEvent.subject}`,
    );

    this.eventHistory.push(fullEvent);
    if (this.eventHistory.length > 500) {
      this.eventHistory.shift();
    }

    for (const listener of this.listeners) {
      try {
        await listener(fullEvent);
      } catch (err: any) {
        console.warn(`[NotificationEmitter] Listener error: ${err.message}`);
      }
    }

    return fullEvent;
  }

  /**
   * Register a subscriber listener
   */
  static subscribe(listener: (event: NotificationEvent) => void | Promise<void>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Clear recorded history (for test isolation)
   */
  static clearHistory() {
    this.eventHistory = [];
  }
}
