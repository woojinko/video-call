import { useState, type FormEvent } from 'react';
import { VideoTile } from './components/VideoTile';
import { useVideoCall, type CallStatus } from './webrtc/useVideoCall';

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: 'Not in a call',
  starting: 'Starting camera…',
  waiting: 'Waiting for the other person to join',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Connection unstable, reconnecting…',
  'room-full': 'Room is full',
  error: 'Something went wrong',
};

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function App() {
  const call = useVideoCall();
  const [roomInput, setRoomInput] = useState(() => new URLSearchParams(location.search).get('room') ?? randomRoomId());
  const inCall = call.status !== 'idle' && call.status !== 'room-full' && call.status !== 'error';
  const platform = window.desktop?.platform;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = roomInput.trim();
    if (id) void call.join(id);
  };

  return (
    <main className="app">
      <header className="topbar">
        <h1>
          Video Call {platform && <span className="badge">desktop · {platform}</span>}
        </h1>
        <span className={`status status-${call.status}`} aria-live="polite">
          {STATUS_TEXT[call.status]}
          {call.roomId && inCall ? ` · room ${call.roomId}` : ''}
        </span>
      </header>

      {!inCall ? (
        <form className="join" onSubmit={onSubmit}>
          <label htmlFor="room">Room name</label>
          <div className="join-row">
            <input
              id="room"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              maxLength={64}
              autoComplete="off"
            />
            <button type="submit" className="primary">
              Join
            </button>
          </div>
          <p className="hint">Open this page in a second tab (or the Electron app) and join the same room.</p>
          {call.error && <p className="error">{call.error}</p>}
        </form>
      ) : (
        <>
          <section className="stage">
            <VideoTile
              stream={call.remoteStream}
              label="Remote"
              placeholder={call.status === 'waiting' ? 'Waiting for someone to join…' : 'Connecting…'}
              className="remote"
            />
            <VideoTile stream={call.localStream} label="You" muted mirrored className="local" />
          </section>

          <nav className="controls">
            <button onClick={call.toggleMic} aria-pressed={!call.micEnabled}>
              {call.micEnabled ? 'Mute' : 'Unmute'}
            </button>
            <button onClick={call.toggleCamera} aria-pressed={!call.cameraEnabled}>
              {call.cameraEnabled ? 'Camera off' : 'Camera on'}
            </button>
            <button className="danger" onClick={call.hangUp}>
              Hang up
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
