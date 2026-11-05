export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.04em] [font-stretch:125%] ${className}`}>
      <span className="text-em">Q</span>ANTUM
    </span>
  );
}
