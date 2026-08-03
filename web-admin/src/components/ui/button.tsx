import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib";

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_[data-icon=inline-start]]:size-4 [&_[data-icon=inline-end]]:size-4 [&_[data-icon=tile]]:size-6 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        success: "bg-success text-success-foreground hover:bg-success/90",
        secondary: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: { default: "h-9 px-3", icon: "h-9 w-9 px-0", sm: "h-8 px-2.5" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    busy?: boolean;
  }>(({
    className,
    variant,
    size,
    busy,
    asChild = false,
    children,
    ...props
  }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={busy || props.disabled} {...props}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {children}
      </Comp>
    );
  });
Button.displayName = "Button";

export { Button, buttonVariants };
