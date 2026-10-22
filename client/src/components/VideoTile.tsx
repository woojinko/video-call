import { useEffect, useRef } from 'react';

interface VideoTileProps {
  stream: MediaStream | null;
  label: string;
  /** Mute local preview so you don't hear yourself. */
  muted?: boolean;
  /** Mirror the local camera like a mirror (selfie view). */
  mirrored?: boolean;
  placeholder?: string;
  className?: string;
}

export function VideoTile({ stream, label, muted = false, mirrored = false, placeholder, className = '' }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  return (
    <div className={`tile ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={mirrored ? 'mirrored' : undefined}
        hidden={!stream}
      />
      {!stream && <div className="tile-placeholder">{placeholder}</div>}
      <span className="tile-label">{label}</span>
    </div>
  );
}
