import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { fontVariables } from "@/lib/fonts";
import { getSettings } from "@/server/queries/public";
import "../globals.css";

export const metadata: Metadata = { title: { default: "Volunteer portal", template: "%s · Volunteer portal" }, robots: { index: false, follow: false } };
export default async function VolunteerLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return <html lang="en" data-accent={settings.accentColor} className={fontVariables} suppressHydrationWarning><body className="min-h-dvh font-sans"><Providers defaultTheme="system">{children}</Providers></body></html>;
}
