"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useFieldId } from "./field"

function Textarea({ className, id, ...props }: React.ComponentProps<"textarea">) {
  const fieldId = useFieldId()
  return (
    <textarea
      id={id ?? fieldId}
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
