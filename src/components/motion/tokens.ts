/** Shared Motion timings in seconds. CSS equivalents live in globals.css. */
export const MOTION = {
  ease: [0.22, 1, 0.36, 1] as const,
  duration: {
    fast: 0.2,
    filter: 0.22,
    slide: 0.35,
    item: 0.46,
    reveal: 0.52,
  },
  stagger: 0.06,
} as const;
