'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/api';
import { initAudioUnlock, playMessageSound, playNotificationSound } from '@/lib/sounds';
import { create } from 'zustand';
import { useSession } from '@/stores/session';

/** Socket.io server origin (strip the /api/v1 REST suffix off NEXT_PUBLIC_API_URL). */
function wsBase() {
  const api = process.env.NEXT_PUBLIC_API_URL ?? '';
  return api.replace(/\/api\/v1\/?$/, '');
}

let socket: Socket | null = null;

const useRealtimeStatus = create<{ connected: boolean }>(() => ({ connected: false }));

/**
 * `refetchInterval` for data the socket pushes: no polling while the WebSocket
 * is up (the push invalidates the query), `ms` polling only as a fallback.
 */
export function useFallbackPoll(ms: number): number | false {
  const connected = useRealtimeStatus((s) => s.connected);
  return connected ? false : ms;
}

/**
 * Live push over the NotificationsGateway (/ws). Invalidates the relevant React
 * Query caches the instant the server emits, so notifications and messages land
 * without waiting for the fallback polls. One shared socket per tab.
 */
export function useRealtime() {
  const qc = useQueryClient();
  const status = useSession((s) => s.status);

  useEffect(() => {
    if (status !== 'authenticated') return;
    initAudioUnlock();

    socket = io(`${wsBase()}/ws`, {
      // called on every (re)connect, so a refreshed access token is picked up
      auth: (cb) => cb({ token: getAccessToken() ?? '' }),
      transports: ['websocket'],
      withCredentials: true,
      reconnectionDelayMax: 5000,
    });

    let wasDisconnected = false;
    socket.on('connect', () => {
      useRealtimeStatus.setState({ connected: true });
      // events emitted while we were offline were missed: catch up once
      if (wasDisconnected) {
        qc.invalidateQueries({ queryKey: ['notifications'] });
      }
    });
    socket.on('disconnect', () => {
      wasDisconnected = true;
      useRealtimeStatus.setState({ connected: false });
    });

    socket.on('notification', (n: { type?: string }) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      // mentions get the lighter message blip
      if (n?.type === 'mention') playMessageSound();
      else playNotificationSound();
    });

    return () => {
      socket?.disconnect();
      socket = null;
      useRealtimeStatus.setState({ connected: false });
    };
  }, [status, qc]);
}
