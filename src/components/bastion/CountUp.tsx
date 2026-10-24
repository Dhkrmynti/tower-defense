import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface CountUpProps {
  value: number;
  format: (n: number) => string;
  className?: string;
}

/**
 * Carved numeral that counts up the first time it scrolls into view and
 * glides to new live values afterwards. Renders the real value without JS.
 */
export function CountUp({ value, format, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef({ v: 0 });
  const entered = useRef(false);
  const armed = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const write = () => {
        el.textContent = format(shown.current.v);
      };

      if (reduced) {
        shown.current.v = value;
        write();
        return;
      }

      if (!entered.current) {
        if (armed.current) return;
        armed.current = true;
        shown.current.v = 0;
        write();
        ScrollTrigger.create({
          trigger: el,
          start: 'top 92%',
          once: true,
          onEnter: () => {
            entered.current = true;
            gsap.to(shown.current, { v: latest.current, duration: 1.6, ease: 'expo.out', onUpdate: write });
          },
        });
        return;
      }

      gsap.to(shown.current, { v: value, duration: 0.9, ease: 'expo.out', onUpdate: write, overwrite: true });
    },
    { dependencies: [value], scope: ref },
  );

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
