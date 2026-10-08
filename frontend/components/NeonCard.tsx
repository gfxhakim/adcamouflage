/**
 * Every card in the app is a GradientBlobCard: a white surface whose rim is lit
 * by a blurred Meta-blue blob travelling around the edge. NeonCard keeps the
 * name the rest of the codebase already imports.
 */
export {
  GradientBlobCard as NeonCard,
  GradientBlobCard as default,
  type BlobTone as NeonTone,
  type GradientBlobCardProps as NeonCardProps,
} from "@/components/ui/gradient-bold-card";
