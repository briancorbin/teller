import type { ReactElement } from 'react';
import type { SeatLayout } from '../../lib/seat-layouts';
import { Classic } from './Classic';
import { Dials } from './Dials';
import { Focus } from './Focus';
import { Gauges } from './Gauges';
import { Ledger } from './Ledger';
import type { CounterViewProps } from './shared';

// id → renderer. The Record type is the enforcement: add a layout to
// `SEAT_LAYOUTS` without building it and this stops compiling, so the
// picker can never offer something that renders nothing.

export const COUNTER_VIEWS: Record<SeatLayout, (p: CounterViewProps) => ReactElement> = {
  gauges: Gauges,
  dials: Dials,
  ledger: Ledger,
  focus: Focus,
  classic: Classic,
};

export type { CounterViewProps };
