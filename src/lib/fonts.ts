import { GeistSans } from "geist/font/sans";
import { Newsreader, Noto_Sans_Tamil, Noto_Serif_Tamil } from "next/font/google";

/**
 * Type system:
 *  • Latin UI/body: Geist · Latin headings: Newsreader (editorial serif)
 *  • Tamil body: Noto Sans Tamil · Tamil headings: Noto Serif Tamil
 * Tamil families follow the Latin ones in each stack, so mixed-script text
 * renders each glyph with the right face.
 *
 * Only the two Latin faces are preloaded. The Tamil files are large (~180 KB
 * together) and every page is dominated by Latin text, so preloading them
 * delayed first paint on slow connections. They still load on demand through
 * `display: swap` wherever Tamil glyphs actually appear.
 */
// No `opsz` axis: it tripled the font file (~129 KB) for an effect that is
// imperceptible at the sizes this site uses. Weight-only keeps it near 50 KB.
const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const tamilSans = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-tamil-sans",
  display: "swap",
  preload: false,
});

const tamilSerif = Noto_Serif_Tamil({
  subsets: ["tamil"],
  variable: "--font-tamil-serif",
  display: "swap",
  preload: false,
});

export const fontVariables = [
  GeistSans.variable,
  serif.variable,
  tamilSans.variable,
  tamilSerif.variable,
].join(" ");
