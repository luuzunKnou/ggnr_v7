'use client';

import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

type Props = {
  url: string;
  className?: string;
};

export function RoadCctvHlsPlayer({ url, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    const isHls =
      /\.m3u8(\?|$)/i.test(url) ||
      url.toLowerCase().includes('application/vnd.apple.mpegurl') ||
      url.includes('cctvsec.ktict');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => {
        hls.destroy();
      };
    }

    if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    video.src = url;
    return () => {
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  return (
    <video
      ref={videoRef}
      className={className}
      controls
      playsInline
      muted
      autoPlay
    />
  );
}
