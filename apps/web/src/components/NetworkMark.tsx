// The emblem at the top of the welcome note: two existing lines that meet at an
// interchange and a third one that is still being drawn, which is what the page
// invites its visitors to do. The colours are those of U-Bahn, S-Bahn and
// Straßenbahn in the rest of the interface.
//
// The new line is drawn by animating its dash offset, and its end station
// appears only once the line has reached it. Visitors who ask for less motion
// get the finished picture, since the global reduced-motion rule shortens
// every animation to nothing and `both` keeps the final frame.

const U = '#0075BF';
const S = '#008B3C';
const TRAM = '#DB2777';

export function NetworkMark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden className="overflow-visible">
      <circle cx="48" cy="48" r="46" className="fill-subtle" />
      <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="6">
        <path d="M14 62 L28 48 H68 L80 36" stroke={U} />
        <path d="M34 16 L48 30 V82" stroke={S} />
        <path
          d="M20 76 L48 48 L76 20"
          stroke={TRAM}
          pathLength={1}
          strokeDasharray="1"
          style={{ animation: 'mark-draw 900ms 350ms cubic-bezier(0.5, 0, 0.2, 1) both' }}
        />
      </g>
      {/* Terminal stops of the existing lines. */}
      {[
        [14, 62, U],
        [80, 36, U],
        [34, 16, S],
        [48, 82, S],
        [20, 76, TRAM],
      ].map(([x, y, c]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" fill="var(--surface)" stroke={c as string} strokeWidth="3" />
      ))}
      {/* The interchange where all three meet. */}
      <rect x="38" y="40" width="20" height="16" rx="8" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      {/* The end of the new line, with a halo while it is being placed. */}
      <g style={{ transformOrigin: '76px 20px', animation: 'pop-in 300ms 1200ms cubic-bezier(0.2, 0.9, 0.3, 1.4) both' }}>
        <circle
          cx="76"
          cy="20"
          r="9"
          fill={TRAM}
          opacity="0.25"
          style={{ transformOrigin: '76px 20px', animation: 'mark-halo 1800ms 1500ms ease-out 2 both' }}
        />
        <circle cx="76" cy="20" r="4.5" fill="var(--surface)" stroke={TRAM} strokeWidth="3" />
      </g>
    </svg>
  );
}
