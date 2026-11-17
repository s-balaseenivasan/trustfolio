"use client";

import * as m from "motion/react-m";
import type { Variants } from "motion/react";
import { cn } from "@/lib/utils";
import { MOTION } from "@/components/motion/tokens";

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li" | "article";
};

/** Fades and lifts content in once it scrolls into view. */
export function Reveal({ children, className, delay = 0, y = 12, as = "div" }: RevealProps) {
  const Component = m[as];
  return (
    <Component
      className={cn("motion-reveal", className)}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: MOTION.duration.reveal, ease: MOTION.ease, delay }}
    >
      {children}
    </Component>
  );
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: MOTION.stagger, delayChildren: 0.03 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.duration.item, ease: MOTION.ease } },
};

/** Staggers direct `StaggerItem` children as the group enters the viewport. */
export function Stagger({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol";
}) {
  const Component = m[as];
  return (
    <Component
      className={className}
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.1 }}
    >
      {children}
    </Component>
  );
}

export function StaggerItem({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li" | "article";
}) {
  const Component = m[as];
  return (
    <Component className={cn("motion-stagger-item", className)} variants={item}>
      {children}
    </Component>
  );
}
