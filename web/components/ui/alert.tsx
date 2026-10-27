import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-card text-foreground",
        destructive:
          "border-destructive/30 bg-destructive/[0.07] text-destructive [&>svg]:text-destructive",
        // Tones for the notification engine. In dark mode --card equals
        // --background, so a card-coloured tone had no fill, and a 7% wash over
        // an 18%-lightness surface is below the noise floor.
        info: "border-border bg-muted text-foreground dark:bg-muted",
        success:
          "border-success/30 bg-success/[0.07] text-foreground dark:border-success/40 dark:bg-success/[0.13]",
        warning:
          "border-warning/30 bg-warning/[0.08] text-foreground dark:border-warning/40 dark:bg-warning/[0.14]",
        critical:
          "border-destructive/30 bg-destructive/[0.07] text-foreground dark:border-destructive/40 dark:bg-destructive/[0.13]",
        promo:
          "border-primary/25 bg-primary/[0.06] text-foreground dark:border-primary/35 dark:bg-primary/[0.12]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
