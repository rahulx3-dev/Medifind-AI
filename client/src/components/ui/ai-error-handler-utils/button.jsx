import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-xs font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-98",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary/90 shadow-xs",
        destructive:
          "bg-[#ba1a1a] text-white hover:bg-[#93000a] shadow-xs",
        outline:
          "border border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container hover:text-primary",
        secondary:
          "bg-surface-container text-primary hover:bg-surface-container-high shadow-xs",
        ghost: "hover:bg-surface-container hover:text-primary text-on-surface-variant",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3",
        lg: "h-11 rounded-xl px-8",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 min-h-[32px] min-w-[32px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
