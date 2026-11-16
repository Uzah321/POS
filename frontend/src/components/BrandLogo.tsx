/**
 * The Core logo (public/logo.png, precached for offline use — see
 * vite.config.ts), drawn `size` px square.
 */
export default function BrandLogo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Core"
      width={size}
      height={size}
      draggable={false}
      className={`flex-shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
