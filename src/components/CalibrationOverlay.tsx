import type { Calibration } from '../../worker/types';

// What the table shows while the DM calibrates it against a physical
// reference. Drawn in GLASS space (viewport pixels), not map space —
// this is the one thing in teller that is about the screen itself
// rather than about the map on it.
//
// The table stays passive: this arrives over SSE, carries no controls,
// and leaves when the console says so.

const MARK = '#fbbf24';

/** Corner brackets, hard against the viewport edges. */
function Corners() {
  const arm = 'absolute h-24 w-24 border-amber-400';
  return (
    <>
      <div className={`${arm} left-0 top-0 border-l-8 border-t-8`} />
      <div className={`${arm} right-0 top-0 border-r-8 border-t-8`} />
      <div className={`${arm} bottom-0 left-0 border-b-8 border-l-8`} />
      <div className={`${arm} bottom-0 right-0 border-b-8 border-r-8`} />
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center">
        <p className="font-serif text-4xl text-stone-100">
          Can you see all four corners?
        </p>
        <p className="mt-3 text-xl text-stone-400">
          If any is cut off, the screen is cropping the picture — set it to
          Just Scan / Screen Fit / 1:1.
        </p>
      </div>
    </>
  );
}

/**
 * A strip of true-inch ticks at the candidate scale. The DM lays the
 * jig along it and nudges until the marks agree — matching, not
 * measuring, and over the longest baseline available.
 */
function Ruler({
  inches,
  pxPerInch,
  vertical,
}: {
  inches: number;
  pxPerInch: number;
  vertical: boolean;
}) {
  const span = inches * pxPerInch;
  const ticks = Array.from({ length: inches + 1 }, (_, i) => i);
  return (
    <div
      className="absolute"
      style={
        vertical
          ? {
              height: span,
              width: 160,
              left: '50%',
              top: `calc(50% - ${span / 2}px)`,
              transform: 'translateX(-50%)',
            }
          : {
              width: span,
              height: 160,
              top: '50%',
              left: `calc(50% - ${span / 2}px)`,
              transform: 'translateY(-50%)',
            }
      }
    >
      {/* the baseline itself */}
      <div
        className="absolute bg-amber-400"
        style={
          vertical
            ? { left: 0, top: 0, width: 3, height: span }
            : { top: 0, left: 0, height: 3, width: span }
        }
      />
      {ticks.map((i) => {
        // Every fifth inch gets a long tick; the ends get the longest.
        const major = i % 5 === 0;
        const end = i === 0 || i === inches;
        const len = end ? 96 : major ? 64 : 32;
        const at = i * pxPerInch;
        return (
          <div key={i}>
            <div
              className="absolute"
              style={
                vertical
                  ? { top: at, left: 0, height: end ? 5 : 3, width: len, background: MARK }
                  : { left: at, top: 0, width: end ? 5 : 3, height: len, background: MARK }
              }
            />
            {major && (
              <span
                className="absolute font-mono text-lg text-amber-300"
                style={
                  vertical
                    ? { top: at + 6, left: len + 8 }
                    : { left: at + 6, top: len + 6 }
                }
              >
                {i}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Single true-inch squares, for a spot check against a card. */
function Verify({ ppi, ppiY }: { ppi: number; ppiY: number }) {
  const box = (style: React.CSSProperties) => (
    <div
      className="absolute border-4 border-amber-400"
      style={{ width: ppi, height: ppiY, ...style }}
    />
  );
  return (
    <>
      {box({ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' })}
      {box({ left: 40, top: 40 })}
      {box({ right: 40, bottom: 40 })}
      <p className="absolute inset-x-0 bottom-1/4 text-center text-xl text-stone-400">
        Each box is one true inch. Check them against your card.
      </p>
    </>
  );
}

export function CalibrationOverlay({ calibration }: { calibration: Calibration }) {
  const { step, ppi, ppiY, inches } = calibration;
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-stone-950">
      {step === 'corners' && <Corners />}
      {step === 'across' && (
        <Ruler inches={inches} pxPerInch={ppi} vertical={false} />
      )}
      {step === 'down' && <Ruler inches={inches} pxPerInch={ppiY} vertical />}
      {step === 'verify' && <Verify ppi={ppi} ppiY={ppiY} />}
    </div>
  );
}
