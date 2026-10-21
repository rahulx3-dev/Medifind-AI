import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-2xl border p-4 text-sm [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground transition-all duration-200",
  {
    variants: {
      variant: {
        default: "bg-surface-container-lowest text-primary border-outline-variant/40 shadow-xs",
        destructive:
          "bg-[#fff8f7] text-[#ba1a1a] border-[#ffdad6] shadow-xs [&>svg]:text-[#ba1a1a]",
        success:
          "bg-[#f0faf6] text-[#00201b] border-[#a6cfc5]/50 shadow-xs [&>svg]:text-[#006a5c]",
        warning:
          "bg-[#fffbeb] text-[#854d0e] border-[#fde68a] shadow-xs [&>svg]:text-[#d97706]",
        info:
          "bg-[#f3f9fe] text-[#075985] border-[#bae6fd] shadow-xs [&>svg]:text-[#0284c7]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef(({ className, variant, live, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    aria-live={live || "polite"}
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-semibold leading-none tracking-tight text-inherit", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-xs sm:text-sm text-inherit/90 [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription, alertVariants };
