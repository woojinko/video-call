import { useCallback, useEffect, useRef, useState } from 'react';
import { SignalingClient } from '../signaling/SignalingClient';
import type { IceCandidate, ServerMessage } from '../signaling/protocol';
import { fetchRtcConfig } from './iceConfig';

export type CallStatus =
  | 'idle' // not in a room
  | 'starting' // getting camera + connecting to signaling
  | 'waiting' // in the room alone
  | 'connecting' // peer present, negotiating SDP/ICE
  | 'connected' // media flowing
  | 'reconnecting' // ICE dropped, trying to recover
  | 'room-full'
  | 'error';

const SIGNALING_URL: string = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080';

export interface VideoCall {
  status: CallStatus;
  error: string | null;
  roomId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  join(roomId: string): Promise<void>;
  hangUp(): void;
  toggleMic(): void;
  toggleCamera(): void;
}

export function useVideoCall(): VideoCall {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  // Mutable WebRTC objects live in refs: they must not trigger re-renders
  // and must be readable from async callbacks without stale closures.
  const signalingRef = useRef<SignalingClient | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<IceCandidate[]>([]);
  // Signaling messages are processed strictly in order; WebRTC calls are async
  // and interleaving setRemoteDescription/addIceCandidate causes subtle bugs.
  const messageQueueRef = useRef<Promise<void>>(Promise.resolve());

  const closePeerConnection = useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    pcRef.current = null;
    pendingCandidatesRef.current = [];
    setRemoteStream(null);
  }, []);

  const createPeerConnection = useCallback((rtcConfig: RTCConfiguration): RTCPeerConnection => {
    closePeerConnection();
    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    const stream = localStreamRef.current;
    if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.ontrack = (event) => {
      // One remote stream carries both the audio and video tracks.
      setRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalingRef.current?.send({ type: 'ice-candidate', candidate: event.candidate.toJSON() as IceCandidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.debug('[webrtc] connectionState →', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          setStatus('connected');
          break;
        case 'disconnected':
          setStatus('reconnecting');
          break;
        case 'failed':
          setStatus('reconnecting');
          pc.restartIce();
          break;
      }
    };

    return pc;
  }, [closePeerConnection]);

  // STUN/TURN config comes from the signaling server (TURN credentials expire, so fetch
  // per connection). Returns null if the user hung up while the fetch was in flight.
  const preparePeerConnection = useCallback(
    async (signaling: SignalingClient): Promise<RTCPeerConnection | null> => {
      const rtcConfig = await fetchRtcConfig(SIGNALING_URL);
      return signalingRef.current === signaling ? createPeerConnection(rtcConfig) : null;
    },
    [createPeerConnection],
  );

  const flushPendingCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of pending) await pc.addIceCandidate(candidate);
  }, []);

  const handleMessage = useCallback(
    async (message: ServerMessage) => {
      const signaling = signalingRef.current;
      if (!signaling) return;

      switch (message.type) {
        case 'joined':
          setStatus(message.peerCount > 1 ? 'connecting' : 'waiting');
          break;

        case 'peer-joined': {
          // We were here first, so we are the caller.
          setStatus('connecting');
          const pc = await preparePeerConnection(signaling);
          if (!pc) return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signaling.send({ type: 'offer', sdp: { type: 'offer', sdp: offer.sdp ?? '' } });
          break;
        }

        case 'offer': {
          setStatus('connecting');
          const pc = pcRef.current ?? (await preparePeerConnection(signaling));
          if (!pc) return;
          await pc.setRemoteDescription(message.sdp);
          await flushPendingCandidates(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.send({ type: 'answer', sdp: { type: 'answer', sdp: answer.sdp ?? '' } });
          break;
        }

        case 'answer': {
          const pc = pcRef.current;
          if (!pc) return;
          await pc.setRemoteDescription(message.sdp);
          await flushPendingCandidates(pc);
          break;
        }

        case 'ice-candidate': {
          const pc = pcRef.current;
          // Candidates can arrive before the remote description is set; buffer them.
          if (pc?.remoteDescription) await pc.addIceCandidate(message.candidate);
          else pendingCandidatesRef.current.push(message.candidate);
          break;
        }

        case 'peer-left':
          closePeerConnection();
          setStatus('waiting');
          break;

        case 'room-full':
          setStatus('room-full');
          setError(`Room "${message.roomId}" already has two people.`);
          break;

        case 'error':
          console.warn('[signaling] server error:', message.message);
          break;
      }
    },
    [closePeerConnection, preparePeerConnection, flushPendingCandidates],
  );

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
  }, []);

  const hangUp = useCallback(() => {
    signalingRef.current?.send({ type: 'leave' });
    signalingRef.current?.close();
    signalingRef.current = null;
    closePeerConnection();
    stopLocalMedia();
    messageQueueRef.current = Promise.resolve();
    setRoomId(null);
    setStatus((s) => (s === 'room-full' || s === 'error' ? s : 'idle'));
  }, [closePeerConnection, stopLocalMedia]);

  const join = useCallback(
    async (requestedRoomId: string) => {
      setError(null);
      setStatus('starting');
      setRoomId(requestedRoomId);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMicEnabled(true);
        setCameraEnabled(true);

        const signaling = new SignalingClient(SIGNALING_URL);
        signalingRef.current = signaling;
        await signaling.connect();

        signaling.onMessage((message) => {
          messageQueueRef.current = messageQueueRef.current
            .then(() => handleMessage(message))
            .catch((err: unknown) => console.error('[webrtc] failed handling', message.type, err));
        });
        signaling.onClose(() => {
          if (signalingRef.current === signaling) {
            setError('Lost connection to the signaling server.');
            setStatus('error');
            hangUp();
          }
        });

        signaling.send({ type: 'join', roomId: requestedRoomId });
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera/microphone permission was denied.'
            : err instanceof Error
              ? err.message
              : String(err);
        setError(message);
        setStatus('error');
        hangUp();
      }
    },
    [handleMessage, hangUp],
  );

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
  }, []);

  // Clean up on unmount (also covers closing the Electron window).
  useEffect(() => {
    const onUnload = () => signalingRef.current?.send({ type: 'leave' });
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      signalingRef.current?.close();
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    status,
    error,
    roomId,
    localStream,
    remoteStream,
    micEnabled,
    cameraEnabled,
    join,
    hangUp,
    toggleMic,
    toggleCamera,
  };
}
