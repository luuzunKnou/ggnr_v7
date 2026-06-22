"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { layerRowPanelButtonClass } from "./layerRowPanelButtonStyles";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "danger";
  loading?: boolean;
  children: ReactNode;
};

export function LayerRowPanelButton({
  variant = "default",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(layerRowPanelButtonClass(variant), "inline-flex items-center gap-1", className)}
      {...rest}
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />}
      {children}
    </button>
  );
}
