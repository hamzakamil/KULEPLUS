/**
 * Web Push istemci yardımcıları — Faz 7 (ROADMAP §812, §822).
 *
 * Tarayıcı Push API'sini sarar: izin isteme, abone olma, mevcut aboneliği okuma.
 * VAPID genel anahtarı API'den alınır (`GET /v1/management/push/public-key`).
 * Abonelik belirteci `POST /v1/management/devices` ile kaydedilir (store üzerinden).
 */

import { api } from '@/lib/api';

/** Tarayıcı Push API + Notification destekliyor mu? */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Bildirim izni verildi mi? */
export function notificationPermission(): NotificationPermission {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
}

/** URL-safe base64 (VAPID anahtarı) → Uint8Array. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** API'den VAPID genel anahtarını alır. */
export async function fetchVapidPublicKey(): Promise<string> {
  const res = await api.get('/v1/management/push/public-key');
  return (res.data as { publicKey: string }).publicKey;
}

/** Hazır service worker kaydını döner (PWA SW). */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

/** Mevcut push aboneliği (yoksa null). */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await readyRegistration();
  return registration.pushManager.getSubscription();
}

/**
 * İzin isteyip push aboneliği oluşturur.
 * @throws İzin reddedilirse veya abonelik başarısız olursa.
 */
export async function subscribeToPush(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Bildirim izni verilmedi');
  }
  const registration = await readyRegistration();
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

/** Mevcut aboneliği kaldırır. */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (subscription) await subscription.unsubscribe();
}
