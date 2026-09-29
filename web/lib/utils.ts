import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Custom name first, hardware in brackets: "Office phone (Samsung SM-A515F)".
export function formatDeviceName(device: {
  brand?: string
  model?: string
  name?: string | null
}): string {
  const baseName = `${device.brand ?? ''} ${device.model ?? ''}`.trim()
  const customName = device.name?.trim()

  if (customName && customName !== baseName) {
    return baseName ? `${customName} (${baseName})` : customName
  }

  return baseName
}
