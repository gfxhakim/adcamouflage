/**
 * Every card in the app is a GradientBlobCard. Most are plain white cards that
 * glow blue on hover; pass `glow` on the one important card of a screen to
 * light its animated Meta-blue rim. NeonCard keeps the name the rest of the
 * codebase already imports.
 */
export {
  GradientBlobCard as NeonCard,
  GradientBlobCard as default,
  type BlobTone as NeonTone,
  type GradientBlobCardProps as NeonCardProps,
} from "@/components/ui/gradient-bold-card";
