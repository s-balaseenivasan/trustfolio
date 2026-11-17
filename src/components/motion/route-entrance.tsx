"use client";

import { usePathname } from "next/navigation";

/** A short page arrival cue without retaining outgoing content or changing history. */
export function RouteEntrance({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="route-enter">{children}</div>;
}
