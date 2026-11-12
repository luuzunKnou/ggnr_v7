const FRAME = 'mt-1 h-[360px] w-[520px] object-fill';

export function ManualImage({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} title={alt} className={FRAME} />;
}
