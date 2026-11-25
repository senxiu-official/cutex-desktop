export const SERVICE_NOTIFICATIONS_FEATURE = "service-notifications-v1";

export interface ServiceNotificationSettings {
  enabled: boolean;
  desktop: boolean;
  phone: boolean;
  retainContent: boolean;
  quietHours: { startMinute: number; endMinute: number } | null;
}

export interface ServiceNotificationConfiguration {
  settings: ServiceNotificationSettings;
  credentialConfigured: boolean;
  supervisedCredential?: boolean;
  /** cutex 219a82bc: the host's zone the quiet hours run in (iana null: an unnamed zone / POSIX TZ rule). */
  timezone?: { iana: string | null; offsetSeconds: number };
  /** cutex 219a82bc: an Android device paired with full owner scope / one recently reported it shows this channel (null: unknown). */
  phone?: { androidPaired: boolean | null; reachable: boolean | null };
}

export interface ServiceNotificationLocator {
  id: string;
  slug: string;
  cursor: number;
  desktop: boolean;
  phone: boolean;
}

export interface ServiceNotificationEntry extends ServiceNotificationLocator {
  serviceName: string;
  title: string;
  body: string | null;
  priority: "normal" | "high";
  target: { kind: "service" } | { kind: "servicePath"; path: string } | null;
  createdAt: number;
  deliverUntil: number;
}

export interface ServiceNotificationPage {
  notifications: ServiceNotificationEntry[];
  nextBefore: number | null;
  /** cutex 219a82bc: what the host keeps (7 days, 200 per service, 2000 per host); the feed (`after`) omits it. */
  retention?: ServiceNotificationRetention;
}

export interface ServiceNotificationRetention {
  maxAgeSeconds: number;
  maxPerService: number;
  maxPerHost: number;
}

export interface ServiceNotificationOpen {
  hostId: string;
  slug: string;
  id: string;
  path?: string;
}
