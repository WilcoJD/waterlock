import { useEffect, useState } from 'react';
import { formatPence } from '@ripvault/shared';
import { MoneyText } from '../../components/index.ts';
import type { MoneyTextProps } from '../../components/index.ts';

export interface CountUpMoneyProps extends Omit<MoneyTextProps, 'pence' | 'accessibilityLabel'> {
  /** Final amount in integer pence. */
  pence: number;
  /** Count up from £0.00 when mounted / when `pence` changes (default true). False shows the value at once. */
  animate?: boolean;
  durationMs?: number;
  /** Called once the count reaches the final value. */
  onDone?: () => void;
}

/** A MoneyText that counts up to its value (ease-out). Screen readers get the final value only. */
export function CountUpMoney({ pence, animate = true, durationMs = 900, onDone, ...rest }: CountUpMoneyProps) {
  const [shown, setShown] = useState(animate ? 0 : pence);

  useEffect(() => {
    if (!animate || pence <= 0) {
      setShown(pence);
      onDone?.();
      return undefined;
    }
    let frame = 0;
    let cancelled = false;
    const start = Date.now();
    const tick = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(pence * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else onDone?.();
    };
    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    // onDone is a notification only; re-running the count when its identity changes would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pence, animate, durationMs]);

  return <MoneyText {...rest} pence={shown} accessibilityLabel={formatPence(pence)} />;
}
